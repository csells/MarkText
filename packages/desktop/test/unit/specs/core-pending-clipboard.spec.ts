import { describe, expect, it } from 'vitest'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'

function setup(source = 'abc\n') {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'pending-paste.md', source })
  const view = binding.plainTextViewAtBarrier()
  if (view.type !== 'plain-text-view') throw new Error('Missing initial view')
  const reconcile = () => {
    const next = binding.plainTextViewAtBarrier()
    if (next.type !== 'plain-text-view') throw new Error('Missing next view')
    return next.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, binding)
  return {
    adapter,
    binding,
    reconcile,
    dispose: () => {
      adapter.dispose()
      binding.dispose()
    }
  }
}

describe('pending clipboard preparation belongs to its captured document', () => {
  it('retains a later omitted cell while input moves its table before paste completes', async() => {
    const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n'
    const app = setup(source)
    try {
      const preparation = app.adapter.prepareClipboard(
        {
          selection: {
            kind: 'table-cell',
            cell: { table: { start: 0, end: source.length - 1 }, row: 1, column: 2 },
            anchor: 0,
            focus: 0
          },
          tracked: false
        },
        { plainText: 'y' },
        app.reconcile
      )
      app.adapter.input(
        {
          selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 },
          range: { start: 0, end: 0 },
          inputType: 'insertText',
          data: 'before\n\n',
          options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
        },
        app.reconcile
      )
      expect(await preparation.complete('y', { plainText: 'y', pasteAsPlainText: true })).toEqual({
        accepted: true,
        changed: true
      })
      await app.adapter.settled()
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: 'before\n\n| a | b | c |\n| --- | --- | --- |\n| x |     |     y|\n'
      })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: `before\n\n${source}` })
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: 'before\n\n| a | b | c |\n| --- | --- | --- |\n| x |     |     y|\n'
      })
    } finally {
      app.dispose()
    }
  })

  it('rebases its source range through exact intervening input and holds settlement', async() => {
    const app = setup()
    try {
      const preparation = app.adapter.prepareClipboard(
        { selection: { ranges: [{ anchor: 1, focus: 2 }], primary: 0 }, tracked: false },
        { html: '<b>P</b>' },
        app.reconcile
      )
      expect(app.adapter.isSettled()).toBe(false)
      let settled = false
      const barrier = app.adapter.settled().then(() => {
        settled = true
      })
      app.adapter.input(
        {
          selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 },
          range: { start: 0, end: 0 },
          inputType: 'insertText',
          data: 'X',
          options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
        },
        app.reconcile
      )
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'Xabc\n' })
      expect(await preparation.complete('**P**')).toEqual({ accepted: true, changed: true })
      await barrier
      expect(app.adapter.isSettled()).toBe(true)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'Xa**P**c\n' })
    } finally {
      app.dispose()
    }
  })

  it('preserves prepared payload instead of overwriting intervening selected input', async() => {
    const app = setup()
    try {
      const preparation = app.adapter.prepareClipboard(
        { selection: { ranges: [{ anchor: 1, focus: 2 }], primary: 0 }, tracked: false },
        { html: '<b>P</b>' },
        app.reconcile
      )
      app.adapter.input(
        {
          selection: { ranges: [{ anchor: 1, focus: 2 }], primary: 0 },
          range: { start: 1, end: 2 },
          inputType: 'insertText',
          data: 'X',
          options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
        },
        app.reconcile
      )
      expect(await preparation.complete('**P**')).toEqual({ accepted: false, changed: false })
      await expect(app.adapter.settled()).rejects.toThrow('overlaps')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'aXc\n' })
      expect(JSON.stringify(app.adapter.recoveryDraft())).toContain('**P**')
    } finally {
      app.dispose()
    }
  })
})

it('keeps pending clipboard work attached to the outgoing lease until save and handoff drain', async() => {
  const { createCoreDocumentSessionManager } =
    await import('@/documentAuthority/coreDocumentSessionManager')
  const manager = createCoreDocumentSessionManager({
    createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
  })
  manager.open({ documentId: 'old.md', source: 'abc\n', lineEnding: '\n' })
  manager.open({ documentId: 'new.md', source: 'untouched\n', lineEnding: '\n' })
  const lease = manager.lease('old.md')
  const view = lease.projectAcknowledgedPlainTextView(lease.identity.revision)
  if (view.type !== 'plain-text-view') throw new Error('Missing initial view')
  const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, lease.binding)
  lease.settleView(() => adapter.settled())
  lease.onHandoff(() => adapter.dispose())
  const preparation = adapter.prepareClipboard(
    { selection: { ranges: [{ anchor: 1, focus: 2 }], primary: 0 }, tracked: false },
    { imageSource: '/original.png' },
    () => {
      const next = lease.projectAcknowledgedPlainTextView(lease.identity.revision)
      if (next.type !== 'plain-text-view') throw new Error('Missing resulting view')
      return next.view.bindings
    }
  )
  let handedOff = false
  const save = manager.saveBarrier('old.md')
  const handoff = manager.handoff(lease).then(() => {
    handedOff = true
  })
  await Promise.resolve()
  expect(handedOff).toBe(false)
  expect(await preparation.complete('![](/final.png)')).toEqual({ accepted: true, changed: true })
  await expect(save).resolves.toMatchObject({ source: 'a![](/final.png)c\n' })
  await handoff
  expect(await manager.saveBarrier('new.md')).toMatchObject({ source: 'untouched\n' })
  await manager.close('old.md')
  await manager.close('new.md')
})

it('writes raw image bytes into the actual recovery store when a prepared upload fails', async() => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createCoreRecoveryDraftStore } = await import('../../../src/main/coreRecoveryDraftStore')
  const scratch = mkdtempSync(join(tmpdir(), 'marktext-clipboard-recovery-'))
  const app = setup()
  const imageSource = 'data:image/png;base64,AQIDBA=='
  try {
    const preparation = app.adapter.prepareClipboard(
      { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, tracked: false },
      { imageFile: {} },
      app.reconcile
    )
    preparation.capturePayload({ imageSource })
    preparation.fail(new Error('Image upload disconnected'))
    await expect(app.adapter.settled()).rejects.toThrow('Image upload disconnected')
    const store = createCoreRecoveryDraftStore(scratch)
    store.preserve({
      documentId: 'pending-paste.md',
      generation: 1,
      revision: 1,
      reason: 'Image upload disconnected',
      visibleText: 'abc',
      nativeState: [],
      acknowledgedView: {},
      nativeIntent: app.adapter.recoveryDraft()
    })
    const reopened = createCoreRecoveryDraftStore(scratch).list()
    expect(JSON.stringify(reopened[0].nativeIntent)).toContain(imageSource)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc\n' })
  } finally {
    app.dispose()
    rmSync(scratch, { recursive: true, force: true })
  }
})

it('keeps an earlier pending image before typing at its original caret', async() => {
  const app = setup()
  try {
    const preparation = app.adapter.prepareClipboard(
      { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, tracked: false },
      { imageSource: '/original.png' },
      app.reconcile
    )
    app.adapter.input(
      {
        selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 },
        range: { start: 1, end: 1 },
        inputType: 'insertText',
        data: 'X',
        options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
      },
      app.reconcile
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'aXbc\n' })
    expect(await preparation.complete('![](/final.png)')).toEqual({ accepted: true, changed: true })
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'a![](/final.png)Xbc\n' })
  } finally {
    app.dispose()
  }
})

it.each(['first', 'second'] as const)(
  'preserves clipboard command order when the %s upload completes first',
  async(firstToComplete) => {
    const app = setup()
    try {
      const first = app.adapter.prepareClipboard(
        { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, tracked: false },
        { imageSource: '/first.png' },
        app.reconcile
      )
      const second = app.adapter.prepareClipboard(
        { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, tracked: false },
        { imageSource: '/second.png' },
        app.reconcile
      )
      if (firstToComplete === 'first') {
        await first.complete('![](/first.png)')
        await second.complete('![](/second.png)')
      } else {
        await second.complete('![](/second.png)')
        await first.complete('![](/first.png)')
      }
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: 'a![](/first.png)![](/second.png)bc\n'
      })
    } finally {
      app.dispose()
    }
  }
)

it('finishes transient resource presentation on teardown while retaining recovery bytes', async() => {
  const app = setup()
  const preparation = app.adapter.prepareClipboard(
    { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, tracked: false },
    { imageSource: 'data:image/png;base64,AQIDBA==' },
    app.reconcile
  )
  let finished = false
  const presentation = preparation.finished.then(() => {
    finished = true
  })
  await Promise.resolve()
  expect(finished).toBe(false)
  app.adapter.dispose()
  await presentation
  expect(finished).toBe(true)
  expect(JSON.stringify(app.adapter.recoveryDraft())).toContain('data:image/png;base64,AQIDBA==')
  app.binding.dispose()
})

it('releases a cancelled resource without editing source or faulting the save barrier', async() => {
  const app = setup()
  try {
    const preparation = app.adapter.prepareClipboard(
      { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, tracked: false },
      { imageSource: '/cancelled.png' },
      app.reconcile
    )
    let settled = false
    const barrier = app.adapter.settled().then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    preparation.cancel()
    await barrier
    await preparation.finished
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc\n' })
    expect(app.adapter.state()).toMatchObject({ status: 'ready' })
  } finally {
    app.dispose()
  }
})

it('uses the same captured resource owner for image properties while later input continues', async() => {
  const source = '![a{++a++}a]()\n\nafter\n'
  const app = setup(source)
  try {
    const preparation = app.adapter.prepareImage(
      {
        format: 'image-properties',
        selection: { start: 0, end: source.indexOf('\n') },
        tracked: false,
        properties: { alt: 'aaa', src: '/chosen.png', title: '' }
      },
      { imageSource: '/chosen.png' },
      app.reconcile
    )
    let settled = false
    const barrier = app.adapter.settled().then(() => {
      settled = true
    })
    const at = source.length - 1
    app.adapter.input(
      {
        selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
        range: { start: at, end: at },
        inputType: 'insertText',
        data: 'X',
        options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
      },
      app.reconcile
    )
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '![a{++a++}a]()\n\nafterX\n' })
    expect(
      await preparation.complete({ alt: 'aaa', src: '/uploaded.png', title: '' }, () => ({
        ranges: [{ anchor: at + 1, focus: at + 1 }],
        primary: 0
      }))
    ).toEqual({ accepted: true, changed: true })
    await barrier
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: '![a{++a++}a](/uploaded.png)\n\nafterX\n'
    })
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '![a{++a++}a]()\n\nafterX\n' })
    await app.adapter.history('redo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: '![a{++a++}a](/uploaded.png)\n\nafterX\n'
    })
  } finally {
    app.dispose()
  }
})

it('drains a prepared image property update on its captured lease before handoff', async() => {
  const { createCoreDocumentSessionManager } =
    await import('@/documentAuthority/coreDocumentSessionManager')
  const manager = createCoreDocumentSessionManager({
    createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
  })
  const source = '![a{++a++}a]()\n'
  manager.open({ documentId: 'image.md', source, lineEnding: '\n' })
  manager.open({ documentId: 'next.md', source: 'untouched\n', lineEnding: '\n' })
  const lease = manager.lease('image.md')
  const view = lease.projectAcknowledgedPlainTextView(lease.identity.revision)
  if (view.type !== 'plain-text-view') throw new Error('Missing initial view')
  const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, lease.binding)
  lease.settleView(() => adapter.settled())
  lease.onHandoff(() => adapter.dispose())
  const preparation = adapter.prepareImage(
    {
      format: 'image-properties',
      selection: { start: 0, end: source.length - 1 },
      tracked: false,
      properties: { alt: 'aaa', src: '/chosen.png', title: '' }
    },
    { imageSource: '/chosen.png' },
    () => {
      const next = lease.projectAcknowledgedPlainTextView(lease.identity.revision)
      if (next.type !== 'plain-text-view') throw new Error('Missing next view')
      return next.view.bindings
    }
  )
  let handedOff = false
  const save = manager.saveBarrier('image.md')
  const handoff = manager.handoff(lease).then(() => {
    handedOff = true
  })
  await Promise.resolve()
  expect(handedOff).toBe(false)
  expect(await preparation.complete({ alt: 'aaa', src: '/uploaded.png', title: '' })).toEqual({
    accepted: true,
    changed: true
  })
  await expect(save).resolves.toMatchObject({ source: '![a{++a++}a](/uploaded.png)\n' })
  await handoff
  expect(await manager.saveBarrier('next.md')).toMatchObject({ source: 'untouched\n' })
  await manager.close('image.md')
  await manager.close('next.md')
})

it('retains and completes a prepared paste whose resource resolves during native composition', async() => {
  const app = setup()
  try {
    const preparation = app.adapter.prepareClipboard(
      { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, tracked: false },
      { text: 'P' },
      app.reconcile
    )
    const operation = {
      selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 },
      range: { start: 1, end: 1 },
      inputType: 'insertCompositionText',
      data: null,
      options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
    }
    app.adapter.compositionStart(operation)
    app.adapter.compositionUpdate('X')
    let capturedCurrent = false
    const completion = preparation.complete('P', {
      currentSelection: () => {
        capturedCurrent = true
        return { ranges: [{ anchor: 2, focus: 2 }], primary: 0 }
      }
    })
    expect(capturedCurrent).toBe(false)
    expect(app.adapter.compositionEnd({ kind: 'commit', data: 'X' }, app.reconcile)).toMatchObject({
      accepted: true
    })
    expect(await completion).toMatchObject({ accepted: true })
    expect(capturedCurrent).toBe(true)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'aPXbc\n' })
    expect(app.adapter.state()).toMatchObject({ status: 'ready' })
    expect(app.adapter.hasPendingEdits()).toBe(false)
    await app.adapter.settled()
  } finally {
    app.dispose()
  }
})

it('does not resolve settlement after composition while a captured resource is still pending', async() => {
  const app = setup()
  try {
    const preparation = app.adapter.prepareClipboard(
      { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, tracked: false },
      { text: 'P' },
      app.reconcile
    )
    const operation = {
      selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 },
      range: { start: 1, end: 1 },
      inputType: 'insertCompositionText',
      data: null,
      options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
    }
    app.adapter.compositionStart(operation)
    let settled = false
    const barrier = app.adapter.settled().then(
      () => {
        settled = true
      },
      () => {}
    )
    expect(app.adapter.compositionEnd({ kind: 'commit', data: 'X' }, app.reconcile)).toMatchObject({
      accepted: true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(app.adapter.hasPendingEdits()).toBe(true)
    expect(await preparation.complete('P')).toMatchObject({ accepted: true })
    await barrier
    expect(settled).toBe(true)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'aPXbc\n' })
  } finally {
    app.dispose()
  }
})

it('retains original resource bytes after accepted paste fails to render without replaying it', async() => {
  const app = setup()
  const imageSource = 'data:image/png;base64,AQIDBA=='
  try {
    const preparation = app.adapter.prepareClipboard(
      { selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, tracked: false },
      { imageSource },
      () => {
        throw new Error('Rendering failed')
      }
    )
    expect(await preparation.complete('![](/uploaded.png)')).toEqual({
      accepted: true,
      changed: true
    })
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'a![](/uploaded.png)bc\n' })
    await expect(app.adapter.settled()).rejects.toThrow('Rendering failed')
    expect(JSON.stringify(app.adapter.recoveryDraft())).toContain(imageSource)
  } finally {
    app.dispose()
  }
})

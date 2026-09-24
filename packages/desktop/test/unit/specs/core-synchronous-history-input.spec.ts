// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import CodeMirror from '@/codeMirror'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import type { CoreRequest } from '@/documentAuthority/coreProtocol'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// History is admitted by the same synchronous model owner as native input, so
// no native edit can be captured against the view the model already replaced.
// These cases try each way native work could still be in flight at that moment.

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

const recordingBinding = (documentId: string, source: string) => {
  const owner = createLocalCoreOwner()
  const requests: CoreRequest['type'][] = []
  const binding = createEditorCoreBinding({
    request(request) {
      requests.push(request.type)
      return owner.request(request)
    },
    dispose: () => owner.dispose()
  })
  binding.open({ documentId, source })
  return { binding, requests }
}

describe('Source history against native CodeMirror work', () => {
  const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  beforeEach(() =>
    Object.defineProperties(Range.prototype, {
      getBoundingClientRect: { configurable: true, value: () => new DOMRect(0, 0, 10, 20) },
      getClientRects: { configurable: true, value: () => [new DOMRect(0, 0, 10, 20)] }
    })
  )
  afterEach(() => {
    for (const [name, descriptor] of [
      ['getBoundingClientRect', rect],
      ['getClientRects', rects]
    ] as const) {
      if (descriptor === undefined) Reflect.deleteProperty(Range.prototype, name)
      else Object.defineProperty(Range.prototype, name, descriptor)
    }
  })

  const boot = (source: string) => {
    const host = document.body.appendChild(document.createElement('div'))
    const editor = CodeMirror(host, { value: source, mode: null })
    const { binding, requests } = recordingBinding('source-history-order.md', source)
    const adapter = createCodeMirrorCoreAdapter(editor.getDoc(), binding, {
      canonicalSource: source,
      canonicalRevision: 1,
      insertedLineEnding: '\n'
    })
    return {
      editor,
      binding,
      adapter,
      requests,
      dispose() {
        adapter.dispose()
        binding.dispose()
        host.remove()
      }
    }
  }

  it('presents undo before the call returns, so the next keystroke edits the admitted document at the model selection', async() => {
    const app = boot('abc\ndef')
    try {
      app.editor.setCursor({ line: 0, ch: 0 })
      app.editor.replaceSelection('!', 'end', '+input')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '!abc\ndef' })
      app.editor.setCursor({ line: 1, ch: 3 })

      const undoing = app.adapter.history('undo')
      expect(app.editor.getValue()).toBe('abc\ndef')
      expect(app.editor.getCursor()).toMatchObject({ line: 0, ch: 0 })
      expect(app.adapter.isSettled()).toBe(true)
      app.editor.replaceSelection('X', 'end', '+input')

      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'Xabc\ndef' })
      await expect(undoing).resolves.toMatchObject({ type: 'applied', revision: 3 })
      expect(app.requests).toEqual([
        'open',
        'source-input',
        'source-at-barrier',
        'undo',
        'source-input',
        'source-at-barrier'
      ])
      expect(app.adapter.state()).toEqual({ status: 'ready', lastAcceptedRevision: 4 })
    } finally {
      app.dispose()
    }
  })

  it('admits edits of a CodeMirror operation still in progress before history', async() => {
    const app = boot('abc\ndef')
    try {
      app.editor.replaceRange('!', { line: 0, ch: 0 }, undefined, '+input')
      let undoing: Promise<unknown> | undefined
      app.editor.operation(() => {
        app.editor.replaceRange('E', { line: 0, ch: 4 }, undefined, '+input')
        undoing = app.adapter.history('undo')
      })
      await expect(undoing).resolves.toMatchObject({ type: 'applied', revision: 4 })

      expect(app.requests).toEqual(['open', 'source-input', 'source-input', 'undo'])
      expect(app.editor.getValue()).toBe('!abc\ndef')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '!abc\ndef' })
      // The model restores the selection that preceded the undone operation.
      expect(app.editor.getCursor()).toMatchObject({ line: 0, ch: 1 })
    } finally {
      app.dispose()
    }
  })

  it('admits a composition before the history requested during it', async() => {
    const app = boot('abc\ndef')
    try {
      app.editor.setCursor({ line: 0, ch: 3 })
      app.adapter.compositionStart()
      app.editor.replaceSelection('日', 'end', '+input')
      const undoing = app.adapter.history('undo')
      expect(app.requests).toEqual(['open'])
      await app.adapter.compositionEnd()
      await expect(undoing).resolves.toMatchObject({ type: 'applied', revision: 3 })

      expect(app.requests).toEqual(['open', 'source-input', 'undo'])
      expect(app.editor.getValue()).toBe('abc\ndef')
      expect(app.editor.getCursor()).toMatchObject({ line: 0, ch: 3 })
    } finally {
      app.dispose()
    }
  })
})

describe('WYSIWYG history against native Muya work', () => {
  const setup = (source = 'abc\n') => {
    const { binding, requests } = recordingBinding('muya-history-order.md', source)
    const initial = binding.plainTextViewAtBarrier()
    if (initial.type !== 'plain-text-view') throw new Error('Missing initial view')
    const reconcile = () => {
      const next = binding.plainTextViewAtBarrier()
      if (next.type !== 'plain-text-view') throw new Error('Missing next view')
      return next.view.bindings
    }
    const adapter = createMuyaPlainTextCoreAdapter(initial.view.bindings, binding)
    return {
      adapter,
      binding,
      requests,
      reconcile,
      dispose() {
        adapter.dispose()
        binding.dispose()
      }
    }
  }
  const insert = (at: number, data: string) =>
    Object.freeze({
      selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
      range: { start: at, end: at },
      inputType: 'insertText',
      data,
      options
    })

  it('completes undo in the calling task and returns the model selection for the next input', async() => {
    const app = setup()
    try {
      expect(app.adapter.input(insert(3, 'X'), app.reconcile)).toMatchObject({ accepted: true })
      const undoing = app.adapter.history('undo', app.reconcile)
      expect(app.adapter.isSettled()).toBe(true)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc\n' })
      const undone = await undoing
      expect(undone?.historyResult?.selection).toEqual({
        ranges: [{ anchor: 3, focus: 3 }],
        primary: 0
      })

      expect(app.adapter.input(insert(3, 'Y'), app.reconcile)).toMatchObject({ accepted: true })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abcY\n' })
      expect(
        app.requests.filter(
          (type) => type !== 'source-at-barrier' && type !== 'plain-text-view-at-barrier'
        )
      ).toEqual(['open', 'input', 'undo', 'input'])
    } finally {
      app.dispose()
    }
  })

  it('refuses history during composition, then undoes the committed composition', async() => {
    const app = setup()
    try {
      app.adapter.compositionStart({
        ...insert(3, ''),
        inputType: 'insertCompositionText',
        data: null
      })
      app.adapter.compositionUpdate('日')
      await expect(app.adapter.history('undo', app.reconcile)).rejects.toThrow(
        'cannot run during composition'
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc\n' })
      expect(
        app.adapter.compositionEnd({ kind: 'commit', data: '日' }, app.reconcile)
      ).toMatchObject({ accepted: true })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc日\n' })

      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc\n' })
      expect(app.adapter.state()).toMatchObject({ status: 'ready' })
    } finally {
      app.dispose()
    }
  })

  it('applies history while a prepared paste is pending and lands the paste at its model-retained target', async() => {
    const app = setup()
    try {
      app.adapter.input(insert(0, 'X'), app.reconcile)
      const preparation = app.adapter.prepareClipboard(
        { selection: { ranges: [{ anchor: 4, focus: 4 }], primary: 0 }, tracked: false },
        { text: 'P' },
        app.reconcile
      )
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc\n' })
      expect(app.adapter.hasPendingEdits()).toBe(false)

      expect(await preparation.complete('P')).toMatchObject({ accepted: true })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abcP\n' })
      await app.adapter.settled()
      expect(app.adapter.state()).toMatchObject({ status: 'ready' })
    } finally {
      app.dispose()
    }
  })

  it('delivers typed Muya input to the model before an undo in the same task', async() => {
    const app = bootBoundMuya('abc\n')
    try {
      const paragraph = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
      if (!paragraph?.isContent()) throw new Error('Missing paragraph')
      paragraph.setCursor(3, 3, true)
      paragraph.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abcX\n' })
      const undoing = app.adapter.history('undo', app.reconcile)
      expect(app.adapter.isSettled()).toBe(true)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc\n' })
      await undoing
      expect(app.muya.getMarkdown()).toBe('abc\n')
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  })
})

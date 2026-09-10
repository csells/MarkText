import type { DocumentInputAction } from '@marktext/document-core'
// @vitest-environment jsdom
import CodeMirror from '@/codeMirror'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

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
const boot = (bound: boolean) => {
  const host = document.body.appendChild(document.createElement('div'))
  const editor = CodeMirror(host, { value: 'abc\ndef', mode: null })
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'source-history.md', source: 'abc\ndef' })
  const adapter = bound
    ? createCodeMirrorCoreAdapter(editor.getDoc(), binding, {
      canonicalSource: 'abc\ndef',
      insertedLineEnding: '\n'
    })
    : undefined
  return {
    editor,
    binding,
    adapter,
    dispose() {
      adapter?.dispose()
      binding.dispose()
      host.remove()
    }
  }
}

const requiredAdapter = (app: ReturnType<typeof boot>) => {
  if (app.adapter === undefined) throw new Error('This Source control requires the bound model')
  return app.adapter
}

describe('native Source transaction selection history', () => {
  it('rebases pending native selection through an earlier undo before publishing the next source transaction', async() => {
    const app = boot(true)
    try {
      app.editor.setCursor({ line: 0, ch: 0 })
      app.editor.replaceSelection('!', 'end', '+input')
      await requiredAdapter(app).settled()
      app.editor.setCursor({ line: 1, ch: 3 })
      const stop = app.binding.observe(() => {
        stop()
        queueMicrotask(() => app.editor.replaceSelection('X', 'end', '+input'))
      })
      await requiredAdapter(app).history('undo')
      await requiredAdapter(app).settled()
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc\ndefX' })
      await requiredAdapter(app).history('undo')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc\ndef' })
      expect(app.editor.getCursor()).toMatchObject({ line: 1, ch: 3 })
      await requiredAdapter(app).history('redo')
      expect(app.editor.getCursor()).toMatchObject({ line: 1, ch: 4 })
    } finally {
      app.dispose()
    }
  })

  it('commits a selected composition as one source transaction and restores the selection on undo', async() => {
    const app = boot(true)
    try {
      app.editor.setSelection({ line: 0, ch: 3 }, { line: 0, ch: 0 })
      requiredAdapter(app).compositionStart()
      expect(requiredAdapter(app).isSettled()).toBe(false)
      app.editor.replaceSelection('日', 'end', '+input')
      app.editor.replaceRange('日本', { line: 0, ch: 0 }, { line: 0, ch: 1 }, '+input')
      await requiredAdapter(app).compositionEnd()
      expect(requiredAdapter(app).isSettled()).toBe(true)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '日本\ndef' })
      await requiredAdapter(app).history('undo')
      expect(app.editor.listSelections()).toMatchObject([
        { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 0 } }
      ])
      app.editor.replaceSelection('X', 'end', '+input')
      await requiredAdapter(app).settled()
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'X\ndef' })
    } finally {
      app.dispose()
    }
  })

  it.each([false, true])(
    'restores multiple backwards selections and primary cursor, bound=%s',
    async(bound) => {
      const app = boot(bound)
      try {
        const selection = [
          { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 0 } },
          { anchor: { line: 1, ch: 3 }, head: { line: 1, ch: 0 } }
        ]
        app.editor.setSelections(selection, 0)
        app.editor.replaceSelections(['X', 'Y'], 'end', '+input')
        await app.adapter?.settled()
        expect(app.editor.getValue()).toBe('X\nY')
        if (bound) await requiredAdapter(app).history('undo')
        else app.editor.undo()
        expect(app.editor.getValue()).toBe('abc\ndef')
        expect(app.editor.listSelections()).toMatchObject(selection)
        expect(app.editor.getCursor()).toMatchObject({ line: 0, ch: 0 })
        app.editor.replaceSelections(['P', 'Q'], 'end', '+input')
        await app.adapter?.settled()
        expect(app.editor.getValue()).toBe('P\nQ')
        if (bound) expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'P\nQ' })
      } finally {
        app.dispose()
      }
    }
  )
})

it('presents restored table-cell identity in Source and uses its actual raw caret for the next input', async() => {
  const source = '| a | b | c |\r\n| --- | --- | --- |\r\n| x |\r\n'
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'table-source-history.md', source })
  const selection = {
    kind: 'table' as const,
    table: { start: 0, end: source.length - 2 },
    anchor: { row: 0, column: 1 },
    focus: { row: 0, column: 1 }
  }
  const deletion = binding.submit({
    kind: 'clipboard',
    action: { kind: 'table', operation: 'cut', selection, tracked: false },
    projections: []
  }).acknowledged
  expect(deletion.type).toBe('applied')
  const saved = binding.sourceAtBarrier()
  if (saved.type !== 'source') throw new Error('Table Source control requires acknowledged source')
  const host = document.body.appendChild(document.createElement('div'))
  const editor = CodeMirror(host, { value: saved.source, mode: null })
  const adapter = createCodeMirrorCoreAdapter(editor.getDoc(), binding, {
    canonicalSource: saved.source,
    insertedLineEnding: '\r\n'
  })
  try {
    const undo = await adapter.history('undo')
    expect(undo?.historyResult?.selection).toEqual(selection)
    expect(editor.listSelections()).toMatchObject([
      { anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 7 } }
    ])
    const redo = await adapter.history('redo')
    expect(redo?.historyResult?.selection).toMatchObject({
      kind: 'table-cell',
      cell: { row: 0, column: 1 },
      anchor: 0,
      focus: 0
    })
    expect(editor.getValue()).toBe('| a |  | c |\n| --- | --- | --- |\n| x |\n')
    expect(editor.getCursor()).toEqual({ line: 0, ch: 7 })
    await adapter.history('undo')
    editor.replaceSelection('Q', 'end', '+input')
    await adapter.settled()
    expect(binding.sourceAtBarrier()).toMatchObject({
      source: '| a | Q | c |\r\n| --- | --- | --- |\r\n| x |\r\n'
    })
    await adapter.history('undo')
    expect(binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
    host.remove()
  }
})

it('copies the intrinsic cell address before native input enters the model', () => {
  const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n'
  const owner = createLocalCoreOwner()
  const captured: DocumentInputAction[] = []
  const binding = createEditorCoreBinding({
    request: (request) => {
      if (request.type === 'input') captured.push(request.action)
      return owner.request(request)
    },
    dispose: () => owner.dispose()
  })
  binding.open({ documentId: 'cell-copy.md', source })
  const position = () => ({
    kind: 'table-cell' as const,
    cell: { table: { start: 0, end: source.length - 1 }, row: 1, column: 2 },
    anchor: 0,
    focus: 0
  })
  const action = {
    selection: position(),
    range: position(),
    inputType: 'insertText',
    data: 'Q',
    options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  }
  try {
    expect(
      binding.submit({ kind: 'input', action, tracked: false, projections: [] }).acknowledged.type
    ).toBe('applied')
    action.selection.cell.table.start = 1
    action.range.cell.column = 0
    expect(captured[0]).toMatchObject({ selection: position(), range: position() })
    const submitted = captured[0]
    if (submitted === undefined || submitted.selection.kind !== 'table-cell') { throw new Error('Expected intrinsic cell input') }
    expect(Object.isFrozen(submitted.selection.cell.table)).toBe(true)
  } finally {
    binding.dispose()
  }
})

it('projects restored normalized Markup history into Source without replacing its model selection', async() => {
  const source = '  ```\n\tbody\n  ```\n'
  const typed = '  ```\n   x body\n  ```\n'
  const markup = bootBoundMuya(source)
  const host = document.body.appendChild(document.createElement('div'))
  let adapter: ReturnType<typeof createCodeMirrorCoreAdapter> | undefined
  try {
    const block = markup.muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!block?.isContent()) throw new Error('Expected normalized code body')
    block.setCursor(1, 1, true)
    block.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    await markup.adapter.settled()
    const saved = markup.binding.sourceAtBarrier()
    if (saved.type !== 'source') throw new Error('Expected acknowledged Markup input')
    expect(saved.source).toBe(typed)
    markup.adapter.dispose()
    const editor = CodeMirror(host, { value: saved.source, mode: null })
    adapter = createCodeMirrorCoreAdapter(editor.getDoc(), markup.binding, {
      canonicalSource: saved.source,
      insertedLineEnding: '\n'
    })
    const handedOff = markup.binding.sourceAtBarrier()
    expect(handedOff).toMatchObject({ type: 'source', source: typed, revision: saved.revision })
    if (handedOff.type !== 'source') throw new Error('Expected acknowledged Source handoff')
    expect(handedOff.recoveryHistory).toEqual(saved.recoveryHistory)
    const undo = await adapter.history('undo')
    const point = { text: { start: 6, end: 7 }, offset: 1 }
    expect(undo?.historyResult?.selection).toEqual({
      kind: 'model-text',
      anchor: point,
      focus: point
    })
    expect(markup.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(editor.getValue()).toBe(source)
    expect(editor.listSelections()).toMatchObject([
      { anchor: { line: 1, ch: 0 }, head: { line: 1, ch: 1 } }
    ])
    await adapter.history('redo')
    expect(markup.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(editor.getValue()).toBe(typed)
    expect(editor.getCursor()).toEqual({ line: 1, ch: 4 })
  } finally {
    adapter?.dispose()
    markup.dispose()
    host.remove()
  }
})

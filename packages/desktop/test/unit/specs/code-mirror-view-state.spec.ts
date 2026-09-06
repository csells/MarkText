import { describe, expect, it, vi } from 'vitest'
import { isProxy, reactive } from 'vue'
import codeMirror from '@/codeMirror'
import type CodeMirror from 'codemirror'
import { captureCodeMirrorViewState, restoreCodeMirrorViewState } from '@/documentAuthority/codeMirrorViewState'

const fixture = () => {
  const doc = new codeMirror.Doc('hello world\n')
  // jsdom has no layout; selection behavior belongs to the real CodeMirror Doc.
  const editor = {
    setSelections: doc.setSelections.bind(doc),
    listSelections: doc.listSelections.bind(doc),
    getScrollInfo: () => ({ left: 0, top: 0 }),
    scrollTo: vi.fn()
  } as unknown as CodeMirror.Editor
  return { doc, editor }
}

describe('CodeMirror selection ownership', () => {
  it('restores reactive view state as independently owned native positions that recovery can copy', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const { doc, editor } = fixture()
    const state = reactive({
      selections: [{ anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 7 } }],
      editorScroll: { left: 0, top: 0 },
      containerScroll: { left: 0, top: 0 }
    })
    try {
      restoreCodeMirrorViewState(editor, container, state)
      const selection = editor.listSelections()[0]
      expect(isProxy(selection.anchor)).toBe(false)
      expect(isProxy(selection.head)).toBe(false)
      expect(() => structuredClone(editor.listSelections())).not.toThrow()
      state.selections[0].anchor.ch = 0
      expect(doc.getCursor('anchor')).toMatchObject({ line: 0, ch: 2 })
      expect(doc.getSelection()).toBe('llo w')
    } finally {
      container.remove()
    }
  })

  it('captures independent serializable positions from a native selection', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const { doc, editor } = fixture()
    try {
      doc.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 7 })
      const state = captureCodeMirrorViewState(editor, container)
      expect(structuredClone(state).selections).toEqual(state.selections)
      doc.setCursor({ line: 0, ch: 0 })
      expect(state.selections[0].anchor).toMatchObject({ line: 0, ch: 2 })
    } finally {
      container.remove()
    }
  })
})

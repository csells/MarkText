import type CodeMirror from 'codemirror'

export interface CodeMirrorViewState {
  readonly selections: readonly { anchor: CodeMirror.Position, head: CodeMirror.Position }[]
  readonly editorScroll: { left: number, top: number }
  readonly containerScroll: { left: number, top: number }
}

// Native positions must not retain reactive view-state objects. Copy the
// documented scalar coordinates both on admission and in durable snapshots.
export function copyCodeMirrorPosition(position: CodeMirror.Position): CodeMirror.Position {
  return {
    line: position.line,
    ch: position.ch,
    ...(position.sticky === undefined ? {} : { sticky: position.sticky })
  }
}

export function copyCodeMirrorSelections(selections: CodeMirrorViewState['selections']): CodeMirrorViewState['selections'] {
  return selections.map(({ anchor, head }) => ({
    anchor: copyCodeMirrorPosition(anchor), head: copyCodeMirrorPosition(head)
  }))
}

export function captureCodeMirrorViewState(editor: CodeMirror.Editor, container: HTMLElement): CodeMirrorViewState {
  const { left, top } = editor.getScrollInfo()
  return {
    selections: copyCodeMirrorSelections(editor.listSelections()),
    editorScroll: { left, top },
    containerScroll: { left: container.scrollLeft, top: container.scrollTop }
  }
}

export function restoreCodeMirrorViewState(editor: CodeMirror.Editor, container: HTMLElement, state: CodeMirrorViewState): void {
  editor.setSelections([...copyCodeMirrorSelections(state.selections)], undefined, { scroll: false })
  editor.scrollTo(state.editorScroll.left, state.editorScroll.top)
  container.scrollLeft = state.containerScroll.left
  container.scrollTop = state.containerScroll.top
}

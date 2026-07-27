// A source index cursor: `{ anchor, focus }` in `{ line, ch }`
// coordinates. Carried by folder-search jumps and the source -> WYSIWYG handoff.
// Both `line` AND `ch` must be present numbers — otherwise the engine clamps a
// missing `ch` to 0 and restores the caret to the wrong column.
interface IndexPosition {
  line: number
  ch: number
}

export interface IndexCursor {
  anchor: IndexPosition
  focus: IndexPosition
}

const isIndexPosition = (pos: unknown): pos is IndexPosition => {
  const p = pos as { line?: unknown; ch?: unknown } | null
  return !!p && typeof p.line === 'number' && typeof p.ch === 'number'
}

export const isIndexCursor = (cursor: unknown): cursor is IndexCursor => {
  const c = cursor as { anchor?: unknown; focus?: unknown } | null
  return !!c && isIndexPosition(c.anchor) && isIndexPosition(c.focus)
}

interface CursorEditor {
  setCursorByOffset: (cursor: IndexCursor | number) => void
}

const serializedFocusOffset = (cursor: unknown): number | null => {
  const value = cursor as { focus?: { offset?: unknown } } | null
  return typeof value?.focus?.offset === 'number' && Number.isFinite(value.focus.offset)
    ? value.focus.offset
    : null
}

// Both persisted cursor forms resolve through the document engine's one
// source-coordinate API. Browser block identities are deliberately not
// serialized or accepted by the desktop host.
export const applyCursor = (editor: CursorEditor, cursor: unknown): void => {
  if (isIndexCursor(cursor)) {
    editor.setCursorByOffset(cursor)
    return
  }
  const offset = serializedFocusOffset(cursor)
  if (offset !== null) editor.setCursorByOffset(offset)
}

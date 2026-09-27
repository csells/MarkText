// A source-mode (CodeMirror) index cursor: `{ anchor, focus }` in `{ line, ch }`
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

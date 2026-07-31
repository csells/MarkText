/**
 * The one presentation-command vocabulary for editor actions. Menu items,
 * accelerators, the command palette, and the `mt::editor-command` channel
 * name user actions with these ids; the renderer's command bindings are the
 * only place an id becomes a typed document-core intent. An id names what
 * the user asked for — never the intent's shape (G8).
 */
export const EDITOR_COMMAND_IDS = Object.freeze([
  'undo',
  'redo',
  'copy-as-rich',
  'copy-as-html',
  'paste-as-plain-text',
  'select-all',
  'duplicate-block',
  'insert-paragraph',
  'delete-block',
  'find',
  'find-next',
  'find-previous',
  'replace',
  'find-in-folder',
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4',
  'heading-5',
  'heading-6',
  'upgrade-heading',
  'degrade-heading',
  'insert-table',
  'code-fence',
  'quote-block',
  'math-block',
  'html-block',
  'ordered-list',
  'bullet-list',
  'task-list',
  'loose-list-item',
  'paragraph',
  'thematic-break',
  'front-matter',
  'format-strong',
  'format-emphasis',
  'format-underline',
  'format-highlight',
  'format-superscript',
  'format-subscript',
  'format-inline-code',
  'format-inline-math',
  'format-strikethrough',
  'format-link',
  'format-image',
  'format-clear'
] as const)

export type EditorCommandId = (typeof EDITOR_COMMAND_IDS)[number]

const EDITOR_COMMAND_ID_SET: ReadonlySet<string> = new Set(EDITOR_COMMAND_IDS)

export const decodeEditorCommandId = (value: unknown): EditorCommandId => {
  if (typeof value !== 'string' || !EDITOR_COMMAND_ID_SET.has(value)) {
    throw new TypeError(`Unknown editor command: ${String(value)}`)
  }
  return value as EditorCommandId
}

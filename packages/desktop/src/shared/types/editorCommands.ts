import type { EditorIntent } from '@marktext/document-core'

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

/**
 * The intent kind a presentation command resolves to, for availability: a
 * command is enabled exactly when the capability snapshot enables its
 * intent kind. UI-workflow commands — the find family, select-all, and the
 * clipboard trio — resolve to no single intent and are managed by their
 * own surfaces.
 */
export const EDITOR_COMMAND_INTENTS: Readonly<
  Partial<Record<EditorCommandId, EditorIntent['kind']>>
> = Object.freeze({
  undo: 'undo',
  redo: 'redo',
  'duplicate-block': 'duplicate-block',
  'insert-paragraph': 'insert-paragraph',
  'delete-block': 'delete-block',
  'heading-1': 'convert-block',
  'heading-2': 'convert-block',
  'heading-3': 'convert-block',
  'heading-4': 'convert-block',
  'heading-5': 'convert-block',
  'heading-6': 'convert-block',
  'upgrade-heading': 'convert-block',
  'degrade-heading': 'convert-block',
  'insert-table': 'create-table',
  'code-fence': 'convert-block',
  'quote-block': 'convert-block',
  'math-block': 'convert-block',
  'html-block': 'convert-block',
  'ordered-list': 'convert-block',
  'bullet-list': 'convert-block',
  'task-list': 'convert-block',
  'loose-list-item': 'convert-block',
  paragraph: 'convert-block',
  'thematic-break': 'convert-block',
  'front-matter': 'convert-block',
  'format-strong': 'format-text',
  'format-emphasis': 'format-text',
  'format-underline': 'format-text',
  'format-highlight': 'format-text',
  'format-superscript': 'format-text',
  'format-subscript': 'format-text',
  'format-inline-code': 'format-text',
  'format-inline-math': 'format-text',
  'format-strikethrough': 'format-text',
  'format-link': 'format-text',
  'format-image': 'insert-image',
  'format-clear': 'format-text'
})

import type {
  BlockConversion,
  InlineFormat
} from '@marktext/document-core'
import type { EditorCommandId } from '@shared/types/editorCommands'

// Presentation-command ids resolve to document-core payload literals here
// and nowhere else: the type annotations make vocabulary drift a compile
// error (G8).
export const BLOCK_CONVERSION_COMMANDS: Readonly<
  Partial<Record<EditorCommandId, BlockConversion>>
> = Object.freeze({
  'heading-1': { kind: 'heading', level: 1 },
  'heading-2': { kind: 'heading', level: 2 },
  'heading-3': { kind: 'heading', level: 3 },
  'heading-4': { kind: 'heading', level: 4 },
  'heading-5': { kind: 'heading', level: 5 },
  'heading-6': { kind: 'heading', level: 6 },
  'upgrade-heading': { kind: 'heading-shift', direction: 'promote' },
  'degrade-heading': { kind: 'heading-shift', direction: 'demote' },
  'code-fence': { kind: 'code-block' },
  'quote-block': { kind: 'blockquote' },
  'math-block': { kind: 'math-block' },
  'html-block': { kind: 'html-block' },
  'ordered-list': { kind: 'ordered-list' },
  'bullet-list': { kind: 'unordered-list' },
  'task-list': { kind: 'task-list' },
  'loose-list-item': { kind: 'loose-list-item' },
  paragraph: { kind: 'paragraph' },
  'thematic-break': { kind: 'thematic-break' },
  'front-matter': { kind: 'front-matter' }
})

export const INLINE_FORMAT_COMMANDS: Readonly<
  Partial<Record<EditorCommandId, InlineFormat>>
> = Object.freeze({
  'format-strong': 'strong',
  'format-emphasis': 'emphasis',
  'format-underline': 'underline',
  'format-highlight': 'highlight',
  'format-superscript': 'superscript',
  'format-subscript': 'subscript',
  'format-inline-code': 'inline-code',
  'format-inline-math': 'inline-math',
  'format-strikethrough': 'strikethrough',
  'format-link': 'link',
  'format-clear': 'clear'
})

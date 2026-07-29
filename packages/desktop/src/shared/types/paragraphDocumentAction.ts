import {
  closedRecord as decodeClosedRecord
} from './closedRecord'
import type { BlockConversion } from '@marktext/document-core'

export type ParagraphDocumentAction =
  | Readonly<{
    readonly kind: 'convert-block'
    readonly conversion: BlockConversion
  }>
  | Readonly<{ readonly kind: 'request-table' }>

const closedRecord = (
  value: unknown,
  label: string,
  fields: readonly string[]
): Readonly<Record<string, unknown>> =>
  decodeClosedRecord(value, label, { required: fields })

const decodeBlockConversion = (value: unknown): BlockConversion => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Block conversion must be a closed record')
  }
  const kind = (value as Readonly<{ kind?: unknown }>).kind
  switch (kind) {
    case 'heading': {
      const heading = closedRecord(value, 'Heading conversion', ['kind', 'level'])
      if (
        !Number.isInteger(heading.level) ||
        (heading.level as number) < 1 ||
        (heading.level as number) > 6
      ) {
        throw new TypeError('Heading conversion level must be an integer from 1 through 6')
      }
      return Object.freeze({
        kind: 'heading',
        level: heading.level as 1 | 2 | 3 | 4 | 5 | 6
      })
    }
    case 'heading-shift': {
      const shift = closedRecord(
        value,
        'Heading shift conversion',
        ['kind', 'direction']
      )
      if (shift.direction !== 'promote' && shift.direction !== 'demote') {
        throw new TypeError('Heading shift direction is invalid')
      }
      return Object.freeze({
        kind: 'heading-shift',
        direction: shift.direction
      })
    }
    case 'blockquote':
    case 'paragraph':
    case 'unordered-list':
    case 'ordered-list':
    case 'task-list':
    case 'loose-list-item':
    case 'code-block':
    case 'math-block':
    case 'html-block':
    case 'thematic-break':
    case 'front-matter':
      closedRecord(value, 'Block conversion', ['kind'])
      return Object.freeze({ kind })
    default:
      throw new TypeError(`Unknown block conversion: ${String(kind)}`)
  }
}

const convert = (conversion: BlockConversion): ParagraphDocumentAction =>
  Object.freeze({
    kind: 'convert-block',
    conversion: Object.freeze(conversion)
  })

export const PARAGRAPH_DOCUMENT_ACTIONS = Object.freeze({
  bulletList: convert({ kind: 'unordered-list' }),
  codeFence: convert({ kind: 'code-block' }),
  degradeHeading: convert({ kind: 'heading-shift', direction: 'demote' }),
  frontMatter: convert({ kind: 'front-matter' }),
  heading1: convert({ kind: 'heading', level: 1 }),
  heading2: convert({ kind: 'heading', level: 2 }),
  heading3: convert({ kind: 'heading', level: 3 }),
  heading4: convert({ kind: 'heading', level: 4 }),
  heading5: convert({ kind: 'heading', level: 5 }),
  heading6: convert({ kind: 'heading', level: 6 }),
  horizontalLine: convert({ kind: 'thematic-break' }),
  htmlBlock: convert({ kind: 'html-block' }),
  looseListItem: convert({ kind: 'loose-list-item' }),
  mathFormula: convert({ kind: 'math-block' }),
  orderedList: convert({ kind: 'ordered-list' }),
  paragraph: convert({ kind: 'paragraph' }),
  quoteBlock: convert({ kind: 'blockquote' }),
  table: Object.freeze({ kind: 'request-table' as const }),
  taskList: convert({ kind: 'task-list' }),
  upgradeHeading: convert({ kind: 'heading-shift', direction: 'promote' })
})

export const decodeParagraphDocumentAction = (
  value: unknown
): ParagraphDocumentAction => {
  const record = closedRecord(
    value,
    'Paragraph document action',
    value !== null && typeof value === 'object' &&
      (value as Readonly<{ kind?: unknown }>).kind === 'convert-block'
      ? ['kind', 'conversion']
      : ['kind']
  )
  if (record.kind === 'request-table') {
    return PARAGRAPH_DOCUMENT_ACTIONS.table
  }
  if (record.kind === 'convert-block') {
    return Object.freeze({
      kind: 'convert-block',
      conversion: decodeBlockConversion(record.conversion)
    })
  }
  throw new TypeError(`Unknown paragraph document action: ${String(record.kind)}`)
}

import type { IntentCapabilitySnapshot } from '@marktext/document-core'
import type { DocumentSelectionMenuState } from '@shared/types/documentSelection'
import {
  DOCUMENT_CAPABILITY_MENU_ROWS,
  type DocumentCapabilityMenuRow,
  type DocumentCapabilityMenuState
} from '@shared/types/documentSurface'

/**
 * G5: the one menu-row availability policy. Every capability-governed row
 * is computed here from the published capability snapshot, the selection
 * context, and the active surface; main projects the record and owns no
 * policy. The Edit rows (undo through deleteBlock) follow the snapshot
 * alone — their commands reject visibly in Source mode. The structure and
 * format rows fold the surface and the selection context that used to live
 * in main's selection-menu writer.
 */
const CONVERSION_ROWS = Object.freeze([
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'upgradeHeading',
  'degradeHeading',
  'codeFences',
  'quoteBlock',
  'mathBlock',
  'htmlBlock',
  'orderList',
  'bulletList',
  'taskList',
  'looseListItem',
  'paragraph',
  'horizontalLine',
  'frontMatter'
] as const)

type ConversionRow = (typeof CONVERSION_ROWS)[number]

const FORMAT_ROWS = Object.freeze([
  'strong',
  'emphasis',
  'underline',
  'superscript',
  'subscript',
  'highlight',
  'inlineCode',
  'inlineMath',
  'strike',
  'hyperlink',
  'clearFormat'
] as const)

type FormatRow = (typeof FORMAT_ROWS)[number]

// Conversions that have a defined action across a multi-block selection.
const CROSS_BLOCK_CONVERSIONS: ReadonlySet<ConversionRow> = new Set([
  'codeFences',
  'quoteBlock',
  'orderList',
  'bulletList',
  'taskList'
])

const conversionRowEnabled = (
  row: ConversionRow,
  selection: DocumentSelectionMenuState | null
): boolean => {
  if (selection === null) return true
  // A table selection converts nothing; its cell edits have their own rows.
  if (selection.isDisabled) return false
  if (selection.isCodeLike) {
    // Code-like content converts only through the code-fence toggle, and
    // only when the selection is a real code block.
    return row === 'codeFences' && selection.isCodeBlock
  }
  if (selection.isMultiblock && !CROSS_BLOCK_CONVERSIONS.has(row)) {
    return false
  }
  if (
    row === 'looseListItem' &&
    !selection.isUnorderedList &&
    !selection.isOrderedList &&
    !selection.isTaskList
  ) {
    return false
  }
  // Front matter may exist at most once per document.
  if (row === 'frontMatter' && selection.hasFrontMatter) return false
  return true
}

const formatRowEnabled = (
  row: FormatRow,
  selection: DocumentSelectionMenuState | null
): boolean => {
  if (selection === null) return true
  if (selection.isCodeLike) return false
  if (selection.isMultiblock && row === 'hyperlink') return false
  return true
}

export const documentCapabilityMenuState = (
  capabilities: IntentCapabilitySnapshot | null,
  selection: DocumentSelectionMenuState | null,
  surface: 'markup' | 'source'
): DocumentCapabilityMenuState => {
  const rows: Partial<Record<DocumentCapabilityMenuRow, boolean>> = {}
  for (const row of DOCUMENT_CAPABILITY_MENU_ROWS) {
    rows[row] = false
  }
  if (capabilities === null) {
    return Object.freeze(rows) as DocumentCapabilityMenuState
  }

  rows.undo = capabilities.undo.enabled
  rows.redo = capabilities.redo.enabled
  rows.duplicateBlock = capabilities['duplicate-block'].enabled
  rows.insertParagraph = capabilities['insert-paragraph'].enabled
  rows.deleteBlock = capabilities['delete-block'].enabled

  const structural = surface === 'markup'
  for (const row of CONVERSION_ROWS) {
    rows[row] = structural &&
      capabilities['convert-block'].enabled &&
      conversionRowEnabled(row, selection)
  }
  const tableContextBlocked = selection !== null && (
    selection.isDisabled || selection.isCodeLike || selection.isMultiblock
  )
  rows.table = structural &&
    capabilities['create-table'].enabled &&
    !tableContextBlocked
  for (const row of FORMAT_ROWS) {
    rows[row] = structural &&
      capabilities['format-text'].enabled &&
      formatRowEnabled(row, selection)
  }
  rows.image = structural &&
    capabilities['insert-image'].enabled &&
    formatRowEnabled('hyperlink', selection)

  return Object.freeze(rows) as DocumentCapabilityMenuState
}

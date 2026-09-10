export const BRACKET_HASH: Record<string, string> = {
  '{': '}',
  '[': ']',
  '(': ')',
  '*': '*',
  _: '_',
  '"': '"',
  '\'': '\'',
  $: '$',
  '~': '~',
}

export const BACK_HASH: Record<string, string> = {
  '}': '{',
  ']': '[',
  ')': '(',
  '*': '*',
  _: '_',
  '"': '"',
  '\'': '\'',
  $: '$',
  '~': '~',
}

export interface IInputPairingOptions {
  autoPairBracket: boolean;
  autoPairMarkdownSyntax: boolean;
  autoPairQuote: boolean;
}

export interface IInputPairingSyntaxContext {
  isInInlineMath: boolean;
  isInInlineCode: boolean;
  type: string;
}

export interface IInputPairingRequest {
  text: string;
  start: number;
  end: number;
  collapsed: boolean;
  offsetInBlock?: number;
  inputType: string;
  data: string | null;
  options: IInputPairingOptions;
  context: IInputPairingSyntaxContext | undefined;
}

interface IInputPairingEdit { start: number; end: number; text: string }

export type InputPairingResult = (
    | { kind: 'replace'; edit: IInputPairingEdit }
    | { kind: 'selection'; edit: null }
    | { kind: 'wrap'; edits: readonly [IInputPairingEdit, IInputPairingEdit] }
) & { selection: { start: number; end: number } }

export function pairedDeletionRange(text: string, start: number, end: number, inputType: string) {
  const deleted = text.slice(start, end)
  if (inputType === 'deleteContentBackward' && BRACKET_HASH[deleted] !== undefined && text[end] === BRACKET_HASH[deleted]) { return { start, end: end + 1 } }
  if (inputType === 'deleteContentForward' && BACK_HASH[deleted] !== undefined && text[start - 1] === BACK_HASH[deleted]) { return { start: start - 1, end } }
  return { start, end }
}

/** Decide pairing from the actual edit and the owning model's syntax context. */
export function applyInputPairing(request: IInputPairingRequest): InputPairingResult {
  const { text, start, end, collapsed, inputType, data, options, context } = request
  let insert = data ?? ''
  if (inputType.startsWith('delete')) {
    const range = collapsed ? pairedDeletionRange(text, start, end, inputType) : { start, end }
    return { kind: 'replace', edit: { ...range, text: '' }, selection: { start: range.start, end: range.start } }
  }
  const caret = start + insert.length
  const original: InputPairingResult = { kind: 'replace', edit: { start, end, text: insert }, selection: { start: caret, end: caret } }
  if (inputType !== 'insertText' || insert.length !== 1) { return original }
  if (!collapsed) {
    const pair = selectionPairForKey(insert, options, context?.type ?? '')
    if (!pair) { return original }
    const selectionStart = start + pair.open.length
    const selectionEnd = selectionStart + end - start
    return {
      kind: 'wrap',
      edits: [
        { start, end: start, text: pair.open },
        { start: end, end, text: pair.close },
      ],
      selection: { start: selectionStart, end: selectionEnd },
    }
  }
  const before = text.charAt(start - 1)
  const after = text.charAt(end)
  if (insert === after && shouldRemoveClosingChar(insert, before, options)) { return { kind: 'selection', edit: null, selection: { start: caret, end: caret } } }
  if (before !== '\\' && shouldInsertClosingPair(insert, before, !/\S/.test(after), { ...options, ...context })) { insert += BRACKET_HASH[insert] ?? '' }
    // Starting a bullet list from an automatically paired star consumes the
    // closing star, just as the native input policy does.
  if (context?.type === 'format' && /\s/.test(data ?? '') && (request.offsetInBlock ?? start) === 1 && before === '*' && after === '*') {
    return { kind: 'replace', edit: { start, end: end + 1, text: insert }, selection: { start: caret, end: caret } }
  }
  return { kind: 'replace', edit: { start, end, text: insert }, selection: { start: caret, end: caret } }
}

export function shouldRemoveClosingChar(
  inputChar: string,
  preInputChar: string,
  options: { autoPairBracket: boolean; autoPairMarkdownSyntax: boolean; autoPairQuote: boolean }
) {
  const { autoPairBracket, autoPairMarkdownSyntax, autoPairQuote } = options

  return (
    (autoPairQuote && /'/.test(inputChar)) ||
        (autoPairQuote && /"/.test(inputChar)) ||
        (autoPairBracket && /[}\])]/.test(inputChar)) ||
        (autoPairMarkdownSyntax && /\$/.test(inputChar)) ||
        (autoPairMarkdownSyntax &&
            /[*$`~_]/.test(inputChar) &&
            preInputChar !== inputChar)
  )
}

export function shouldInsertClosingPair(
  inputChar: string,
  preInputChar: string,
  postIsNotTouching: boolean,
  ctx: {
    autoPairBracket: boolean;
    autoPairMarkdownSyntax: boolean;
    autoPairQuote: boolean;
    isInInlineMath?: boolean;
    isInInlineCode?: boolean;
    type?: string;
  }
) {
  const {
    autoPairBracket,
    autoPairMarkdownSyntax,
    autoPairQuote,
    isInInlineMath,
    isInInlineCode,
    type,
  } = ctx

  return (
    (autoPairQuote &&
            /'/.test(inputChar) &&
            postIsNotTouching &&
            !/[a-z\d]/i.test(preInputChar)) ||
        (autoPairQuote && /"/.test(inputChar) && postIsNotTouching) ||
        (autoPairBracket && /[{[(]/.test(inputChar) && postIsNotTouching) ||
        (type === 'format' &&
            !isInInlineMath &&
            !isInInlineCode &&
            autoPairMarkdownSyntax &&
            !/[a-z0-9]/i.test(preInputChar) &&
            /[*$`~_]/.test(inputChar))
  )
}

export function selectionPairForKey(
  key: string,
  options: {
    autoPairBracket: boolean;
    autoPairMarkdownSyntax: boolean;
    autoPairQuote: boolean;
  },
  type: string
) {
  if (key.length !== 1) { return null }

  const close = key === '`' ? '`' : BRACKET_HASH[key]
  if (!close) { return null }

  const { autoPairBracket, autoPairMarkdownSyntax, autoPairQuote } = options
  if (autoPairQuote && /['"]/.test(key)) { return { open: key, close } }
  if (autoPairBracket && /[{[(]/.test(key)) { return { open: key, close } }
  if (type === 'format' && autoPairMarkdownSyntax && /[*$~_`]/.test(key)) { return { open: key, close } }

  return null
}

export { normalizeTableDimensions, toggleTableAlignment, tableDelimiter, tableDelimiterMarkers, tableToMarkdown, tableToMarkdownWithPositions, type TableMarkdownResult, type TableMarkdownCellPosition, emptyTableRow, emptyTableColumn, type ITableMarkdownState } from './tableMarkdown.js'
export { default as stringWidth } from './stringWidth.js'

export { codeEnter } from './codeEnter.js'
export { fencedCodeMarkdown } from './codeBlock.js'
export { FORMAT_MARKER_MAP, FORMAT_TAG_MAP, formatDelimiters, type HeadingChange } from './formatting.js'

export { tableCellPaste, headingPasteLines, plainHtmlPasteLines } from './clipboard.js'

export { encodeImageSrc, type ImagePropertyPatch } from './image.js'

export { listItemMarker, listTabAction, type ListKind, type ListChange, type ListMarkerOptions } from './listMarkdown.js'
export { taskCheckedChanges, taskListOrder, type TaskTree } from './taskList.js'

export { codeTabExpansion } from './codeTab.js'
export { frontMatterPolicy, type FrontMatterPolicy } from './frontMatter.js'

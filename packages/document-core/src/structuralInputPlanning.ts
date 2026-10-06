import { planParagraphTab } from './listTabPlanning.js'
import { planCodeLanguage } from './codeLanguagePlanning.js'
import { codeTabExpansion, frontMatterPolicy } from '@marktext/input-policy'
import { planListChange } from './listInputPlanning.js'
import { planTaskChecked } from './taskInputPlanning.js'
import { containerContinuationPrefix } from './clipboardMarkdown.js'
import { fenceDiagramType, fenceOpenerOwnIndent } from './fenceOpener.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'
import type { MarkdownLineIndex } from './revision.js'
import { normalizeTableDimensions, tableToMarkdownWithPositions, codeEnter, fencedCodeMarkdown, htmlBlockTemplate, htmlBlockTemplateTag, emptyTableColumn, emptyTableRow, toggleTableAlignment, tableDelimiterMarkers } from '@marktext/input-policy'
import type { ParagraphEnterConversion } from './internal/profile1/markdownParser.js'
import type { CriticMarkupAnnotation, DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import type { DocumentInputAction, DocumentSourceInputPlan } from './inputPlanning.js'
import { resolveTableCell } from './tableSelection.js'
import { positionAfter } from './sourcePosition.js'
import { materializeTableCellEdit, tableRowCompletion } from './tableCellEditing.js'
import { paragraphPrefixPosition, paragraphImageRange } from './paragraphBoundary.js'
import { literalJoinParagraphText, tableJoinParagraphText, emptyParagraphJoinContainer, paragraphJoinBlock, paragraphJoinAdjacent, paragraphJoinTrailingEdits, paragraphLeadingLineJoin } from './paragraphJoinPlanning.js'
import { syntaxPathAt } from './syntaxPath.js'
import { annotationsAround, annotationsOverlapping } from './internal/annotationsAround.js'
import { planEmptiedSetextReset } from './setextTrailingLine.js'
import { mergeAdjacentEdits, planEmptiedParagraph } from './emptiedParagraphPlanning.js'
import { blockCommandTarget, planBlockCommand } from './blockCommandPlanning.js'
import { isLiteralBlock, literalParagraphSpelling } from './literalBlock.js'

/** Shared sparse removal for native table commands and rectangular selections. */
export function planTableRemoval(
  core: DocumentCore,
  revision: DocumentRevision,
  syntax: MarkupSyntax,
  table: MarkdownAstNode,
  range: { readonly axis: 'row' | 'column', readonly first: number, readonly last: number }
): { edits: DocumentSourceEdit[], selection: SourceRange, selectionBeforeEdits: SourceRange } {
  const { first, last, axis } = range
  const header = table.children[0]
  const count = axis === 'row' ? table.children.length : header?.children.length ?? 0
  if (table.kind !== 'table' || !Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= count || header === undefined) {
    throw new RangeError('Invalid table removal range')
  }
  const sourceAt = (offset: number) => syntax.coordinates.toSource(offset, 'next')
  const sourceEnd = (offset: number) => syntax.coordinates.toSource(offset, 'previous')
  const finish = (edits: DocumentSourceEdit[], target: number) => {
    edits.sort((left, right) => left.start - right.start)
    const caret = positionAfter(edits, target, false)
    return { edits, selection: { start: caret, end: caret }, selectionBeforeEdits: { start: target, end: target } }
  }
  if (first === 0 && last === count - 1) {
    const from = sourceAt(table.range.start)
    const exteriorStart = sourceEnd(table.range.start)
    const to = sourceEnd(table.range.end)
    const outside: MarkdownAstNode[] = []
    const visit = (node: MarkdownAstNode): void => {
      if (node === table) return
      if (['paragraph', 'heading', 'table-cell', 'code-block', 'math-block', 'diagram', 'front-matter'].includes(node.kind)) outside.push(node)
      else for (const child of node.children) visit(child)
    }
    visit(syntax.ast.root)
    const target = outside.find(node => node.range.start >= table.range.end) ?? [...outside].reverse().find(node => node.range.end <= table.range.start)
    const targetStart = target === undefined ? exteriorStart : sourceAt(typeof target.attributes.contentStart === 'number' ? target.attributes.contentStart : target.children[0]?.range.start ?? target.range.start)
    return finish([{ start: from, end: to, insert: '' }], targetStart)
  }
  if (axis === 'row') {
    const selected = table.children[first]
    const final = table.children[last]
    const previous = table.children[first - 1]
    const next = table.children[last + 1]
    const survivor = next ?? previous
    const cell = survivor?.children[0]
    if (selected === undefined || final === undefined || survivor === undefined || cell === undefined) throw new RangeError('Table row removal has no surviving cell')
    const target = sourceAt(cell.range.start)
    if (previous === undefined) {
      const delimiterStart = sourceAt(Number(table.attributes.delimiterStart))
      const delimiterEnd = sourceEnd(Number(table.attributes.delimiterEnd))
      const separator = core.sourceSlice(revision, { start: sourceEnd(header.range.end), end: delimiterStart })
      const materialized = tableRowCompletion(syntax, survivor, header.children.length).insert
      // Retain the surviving row's original annotation bytes; only the existing
      // alignment delimiter moves beneath the promoted header.
      return finish([
        { start: sourceEnd(selected.range.start), end: sourceEnd(survivor.range.start), insert: '' },
        { start: sourceEnd(survivor.range.end), end: sourceEnd(survivor.range.end), insert: materialized + separator + core.sourceSlice(revision, { start: delimiterStart, end: delimiterEnd }) }
      ], target)
    }
    const from = sourceEnd(previous === header ? Number(table.attributes.delimiterEnd) : previous.range.end)
    return finish([{ start: from, end: sourceEnd(final.range.end), insert: '' }], target)
  }
  const slot = (node: MarkdownAstNode | undefined, delimiter: boolean): SourceRange | undefined => {
    const start = node?.attributes[delimiter ? 'delimiterStart' : 'cellStart']
    const end = node?.attributes[delimiter ? 'delimiterEnd' : 'cellEnd']
    return typeof start === 'number' && typeof end === 'number' ? { start: sourceAt(start), end: sourceEnd(end) } : undefined
  }
  const edits: DocumentSourceEdit[] = []
  const editRow = (row: MarkdownAstNode, delimiter: boolean): void => {
    const selected = slot(row.children[first], delimiter)
    if (selected === undefined) {
      if (row === header || delimiter) throw new RangeError('Table header has no physical source slot')
      return
    }
    let final = selected
    for (let column = first + 1; column <= last; column++) final = slot(row.children[column], delimiter) ?? final
    const next = slot(row.children[last + 1], delimiter)
    const previous = slot(row.children[first - 1], delimiter)
    if (next !== undefined) edits.push({ start: selected.start, end: next.start, insert: '' })
    else if (previous !== undefined) edits.push({ start: previous.end, end: final.end, insert: '' })
    else {
      // Missing source slots still represent empty cells in the owned table.
      // Keep a physical empty row when only implicit surviving cells remain.
      const from = sourceEnd(row.range.start)
      const to = sourceEnd(row.range.end)
      edits.push(selected.start > from && final.end < to
        ? { start: selected.start, end: final.end, insert: '' }
        : { start: from, end: to, insert: emptyTableRow(1).markdown })
    }
  }
  for (const row of table.children) {
    editRow(row, false)
    if (row === header) editRow(row, true)
  }
  const survivor = header.children[last + 1] ?? header.children[first - 1]
  if (survivor === undefined) throw new RangeError('Table column removal has no surviving cell')
  return finish(edits, sourceAt(survivor.range.start))
}

/** Structural input uses the same source action and compiler as ordinary typing. */
/**
 * A collapsed caret beside hidden CriticMarkup delimiters has one visible
 * position. A break there belongs outside the annotation edge, as beside
 * visible `**` markers: past closers ending at the caret and any comment that
 * follows them, or else before openers starting there. Splitting inside would
 * leave an annotation with an empty payload on one side of the break.
 */
function annotationExteriorBreak(rootsAround: (position: number) => readonly CriticMarkupAnnotation[], syntax: MarkupSyntax, caret: number): number {
  // Each step moves to an edge of an annotation holding or touching the
  // current position, so the roots around that position hold every candidate.
  const around = (position: number): CriticMarkupAnnotation[] => {
    const all: CriticMarkupAnnotation[] = []
    const collect = (items: readonly CriticMarkupAnnotation[]): void => {
      for (const item of items) {
        all.push(item)
        for (const arm of item.arms) collect(arm.annotations)
      }
    }
    collect(rootsAround(position))
    return all
  }
  let after = caret
  for (;;) {
    const exited = around(after).find(item => item.range.end > after &&
      (item.arms.at(-1)?.range.end === after || item.kind === 'comment' && item.range.start === after))
    if (exited === undefined) break
    after = exited.range.end
  }
  let before = caret
  for (;;) {
    if (after !== caret) break
    const entered = around(before).find(item => item.kind !== 'comment' && item.range.start < before && item.arms[0]?.range.start === before)
    if (entered === undefined) break
    before = entered.range.start
  }
  const target = after === caret ? before : after
  return syntax.coordinates.toProjected(target, 'next') === syntax.coordinates.toProjected(caret, 'next') ? target : caret
}

function softBreakBeforeBlankLine(core: DocumentCore, revision: DocumentRevision, projection: MarkupSyntax, lines: MarkdownLineIndex, caret: number): SourceRange | undefined {
  const projected = projection.coordinates.toProjected(caret, 'next')
  const sourceAt = (offset: number) => projection.coordinates.toSource(offset, 'next')
  const contentStartOf = (line: ReturnType<MarkdownLineIndex['at']>) =>
    Math.max(line.start, ...line.listIndentations.map(part => part.end), ...line.blockquoteMarkers.map(part => part.end))
  let index = -1
  for (let candidate = 0; candidate < lines.count; candidate++) {
    if (lines.at(candidate).start > projected) break
    index = candidate
  }
  if (index < 1) return undefined
  const line = lines.at(index)
  // Annotation delimiters around the break keep the ordinary soft break.
  const around = { start: sourceAt(lines.at(index - 1).start), end: projection.coordinates.toSource(line.end, 'previous') }
  if (annotationsOverlapping(core, revision, around).some(annotation => annotation.range.start <= around.end && around.start <= annotation.range.end)) return undefined
  const contentStart = contentStartOf(line)
  if (contentStart > projected || !/^[ \t]*$/u.test(core.sourceSlice(revision, { start: sourceAt(contentStart), end: caret }))) return undefined
  const previous = lines.at(index - 1)
  if (previous.blank || previous.contentEnd <= contentStartOf(previous)) return undefined
  // The line before belongs to the paragraph (or setext heading text) the
  // caret continues, possibly as its trailing soft break.
  const block = [...syntaxPathAt(projection.ast.root, previous.contentEnd - 1)].reverse()
    .find(node => node.kind === 'paragraph' || (node.kind === 'heading' && node.attributes.style === 'setext'))
  if (block === undefined) return undefined
  const blockEnd = block.kind === 'heading' ? Number(block.attributes.contentEnd) : block.range.end
  if (blockEnd < previous.contentEnd) return undefined
  // The caret's line continues that block, or is the blank line its trailing
  // soft break presents.
  if (!line.blank && (block.range.start > projected || blockEnd < projected)) return undefined
  let start = sourceAt(previous.contentEnd)
  const previousText = core.sourceSlice(revision, { start: sourceAt(contentStartOf(previous)), end: start })
  const spaces = /[ \t]+$/u.exec(previousText)?.[0].length ?? 0
  const backslashes = /\\*$/u.exec(previousText)?.[0].length ?? 0
  start -= spaces > 0 ? spaces : backslashes % 2
  let end = caret
  const next = index + 1 < lines.count ? lines.at(index + 1) : undefined
  if (next !== undefined && next.start < blockEnd &&
      /^[ \t]*$/u.test(core.sourceSlice(revision, { start: caret, end: sourceAt(line.contentEnd) }))) {
    end = sourceAt(contentStartOf(next))
  }
  return { start, end }
}

/** `syntax`, when given, is the revision's syntax or a regional window of it that `physicalLines` and `enterConversion` also read. */
/**
 * The canonical source of a literal block's content. An empty projected
 * content beside elided markers maps its start forward and its end back
 * across them, past each other; its source is then the empty range at its
 * start.
 */
function literalContentSource(
  projection: MarkupSyntax,
  sourceAt: (offset: number) => number,
  literal: MarkdownAstNode
): Readonly<{ from: number, to: number }> {
  const from = sourceAt(Number(literal.attributes.contentStart))
  const to = projection.coordinates.toSource(Number(literal.attributes.contentEnd), 'previous')
  return { from, to: Math.max(from, to) }
}

export function planStructuralInput(core: DocumentCore, revision: DocumentRevision, action: DocumentInputAction<SourceRange>, enterConversion: (range: SourceRange) => ParagraphEnterConversion | undefined, physicalLines: () => MarkdownLineIndex, selectedCell?: ReturnType<typeof resolveTableCell>, syntax?: MarkupSyntax): DocumentSourceInputPlan {
  const inputType = 'inputType' in action ? action.inputType : undefined
  const projection = syntax ?? core.project(revision, 'markup').syntax
  const breakAt = action.selection.start === action.selection.end && (inputType === 'insertParagraph' || inputType === 'insertLineBreak')
    ? annotationExteriorBreak(position => annotationsAround(core, revision, position), projection, action.selection.start)
    : undefined
  const { start, end } = breakAt === undefined ? action.selection : { start: breakAt, end: breakAt }
  // A soft break that would leave an empty line ends the paragraph instead:
  // the break goes, with a hard-break marker before it, and Enter splits
  // there (#5300).
  if (inputType === 'insertLineBreak' && start === end && selectedCell === undefined) {
    const dropped = softBreakBeforeBlankLine(core, revision, projection, physicalLines(), start)
    if (dropped !== undefined) {
      return planStructuralInput(core, revision, { ...action, inputType: 'insertParagraph', data: '\n', selection: dropped, range: dropped } as DocumentInputAction<SourceRange>, enterConversion, physicalLines, selectedCell, syntax)
    }
  }
  const rawRange = 'range' in action ? action.range : { start, end: start }
  const preceding = core.sourceSlice(revision, { start: 0, end: start })
  const lineEnding = preceding.match(/\r\n|\r|\n/u)?.[0] ?? core.sourceSlice(revision, { start, end: revision.sourceLength }).match(/\r\n|\r|\n/u)?.[0] ?? '\n'
  if (start === end && ('kind' in action ? action.command === 'changeBlock' && action.change.type === 'reset' && action.change.at === undefined : inputType === 'insertParagraph')) {
    const reset = planEmptiedSetextReset(core, revision, projection, start)
    if (reset !== undefined) return reset
  }
  const targetPosition = 'kind' in action && action.command === 'changeBlock' ? action.change.at ?? start : start
  const projected = projection.coordinates.toProjected(targetPosition, 'next')
  const ancestors: MarkdownAstNode[] = []
  const ownsTrailingMarker = (node: MarkdownAstNode): boolean => {
    const emptyContainer = ['list', 'list-item', 'blockquote'].includes(node.kind) &&
      (node.children.length === 0 || node.children.every(child => child.kind === 'list-item' && child.children.length === 0))
    return emptyContainer && projected > node.range.end &&
      /^[ \t]*$/u.test(core.sourceSlice(revision, { start: projection.coordinates.toSource(node.range.end, 'previous'), end: start }))
  }
  if (selectedCell === undefined || 'kind' in action && action.command === 'changeBlock' && action.change.at !== undefined) ancestors.push(...syntaxPathAt(projection.ast.root, projected, ownsTrailingMarker))
  else {
    const visit = (node: MarkdownAstNode): boolean => {
      if (node === selectedCell.table) { ancestors.push(node); return true }
      for (const child of node.children) if (visit(child)) { ancestors.unshift(node); return true }
      return false
    }
    visit(projection.ast.root)
    const row = selectedCell.table.children[selectedCell.row]
    if (row === undefined) throw new RangeError('Selected table cell has no row')
    ancestors.push(row, selectedCell.cell)
  }
  const block = [...ancestors].reverse().find(node => node.kind === 'paragraph' || node.kind === 'heading')
  // Upstream's soft break in an ATX heading starts a paragraph, as Enter does.
  // Upstream's soft break after a thematic break, or at the end of an HTML
  // block, starts a paragraph as Enter does.
  const htmlBlock = ancestors.find(node => node.kind === 'html-block')
  const paragraphBreak = inputType === 'insertParagraph' ||
    (inputType === 'insertLineBreak' && block?.kind === 'heading' && block.attributes.style !== 'setext') ||
    (inputType === 'insertLineBreak' && start === end && (ancestors.some(node => node.kind === 'thematic-break') ||
      (htmlBlock !== undefined && start === projection.coordinates.toSource(htmlBlock.children.at(-1)?.range.end ?? htmlBlock.range.end, 'previous'))))
  const item = [...ancestors].reverse().find(node => node.kind === 'list-item')
  const quote = ancestors.find(node => node.kind === 'blockquote')
  const result = (edits: DocumentSourceEdit[], selection: SourceRange): DocumentSourceInputPlan => {
    const raw = 'data' in action ? action.data ?? '' : ''
    const firstEdit = edits.length === 1 ? edits[0] : undefined
    const sameOperation = firstEdit !== undefined && firstEdit.start === rawRange.start && firstEdit.end === rawRange.end && firstEdit.insert === raw
    const from = Math.min(rawRange.start, ...edits.map(edit => edit.start))
    const to = Math.max(rawRange.end, ...edits.map(edit => edit.end))
    let insert = core.sourceSlice(revision, { start: from, end: to })
    for (const edit of [...edits].reverse()) insert = insert.slice(0, edit.start - from) + edit.insert + insert.slice(edit.end - from)
    return {
      edits,
      selection,
      reconciliation: sameOperation ? [] : [{ start: from, end: to + raw.length - (rawRange.end - rawRange.start), insert }]
    }
  }
  const sourceAt = (offset: number) => projection.coordinates.toSource(offset, 'next')
  // An empty paragraph written at the document's end ends its line, as
  // upstream writes it; a document's single final blank line is no block.
  const finalLine = (at: number, continuation: string) => continuation === '' && at === revision.sourceLength ? lineEnding : ''
  const moveAfter = (boundary: MarkdownAstNode): DocumentSourceInputPlan => {
    let following: MarkdownAstNode | undefined
    const findFollowing = (node: MarkdownAstNode): void => {
      if (following !== undefined || node === boundary) return
      if (node.range.start >= boundary.range.end && ['paragraph', 'heading', 'table-cell', 'code-block', 'math-block', 'diagram', 'front-matter'].includes(node.kind)) {
        following = node
        return
      }
      for (const child of node.children) findFollowing(child)
    }
    findFollowing(projection.ast.root)
    if (following !== undefined) {
      const contentStart = typeof following.attributes.contentStart === 'number' ? following.attributes.contentStart : following.children[0]?.range.start ?? following.range.start
      const caret = sourceAt(contentStart)
      return result([], { start: caret, end: caret })
    }
    // The new empty paragraph is spelled as Enter at a final paragraph's end
    // spells it: the final line after a blank separator line.
    const ending = core.sourceSlice(revision, { start: Math.max(0, revision.sourceLength - lineEnding.length * 2), end: revision.sourceLength })
    const insert = ending.endsWith(lineEnding + lineEnding) ? lineEnding : ending.endsWith(lineEnding) ? lineEnding + lineEnding : lineEnding.repeat(3)
    const caret = revision.sourceLength + insert.length - lineEnding.length
    return result([{ start: revision.sourceLength, end: revision.sourceLength, insert }], { start: caret, end: caret })
  }
  const insertionTarget = () => {
    // A table cell inserts after its whole table, as upstream does (#4944).
    const target = [...ancestors].reverse().find(node => ['paragraph', 'heading', 'code-block', 'math-block', 'diagram', 'html-block', 'front-matter', 'table'].includes(node.kind))
    if (target === undefined && projection.ast.root.children.length !== 0) {
      const lines = physicalLines()
      let emptyLine = false
      for (let index = 0; index < lines.count; index++) {
        const line = lines.at(index)
        if (line.start <= projected && projected <= line.contentEnd) {
          emptyLine = line.blank && line.listMarkers.length === 0 && line.listIndentations.length === 0 && line.blockquoteMarkers.length === 0
          break
        }
      }
      if (start !== end || !emptyLine) throw new RangeError('Block insertion requires an editable block')
    }
    const continuation = target === undefined ? '' : containerContinuationPrefix(core, revision, projection, target, ancestors)
    // Replacing a block owns its zero-width leading comments as well as text.
    const from = target === undefined ? start : projection.coordinates.toSource(target.range.start, 'previous')
    let targetEnd = target?.range.end
    // A zero-width paragraph is an owned insertion point, not the ending of
    // the previous physical line. Trimming it would invert the replacement.
    if (targetEnd !== undefined && target !== undefined && target.range.start < targetEnd) {
      const lines = physicalLines()
      for (let index = 0; index < lines.count; index++) {
        const line = lines.at(index)
        if (line.end === targetEnd) { targetEnd = line.contentEnd; break }
        if (line.end > targetEnd) break
      }
    }
    const to = targetEnd === undefined ? end : projection.coordinates.toSource(targetEnd, 'next')
    return { target, continuation, from, to }
  }
  if ('kind' in action) {
    switch (action.command) {
      case 'createFootnote': {
        if (action.identifier === '' || /[[\]\r\n]/u.test(action.identifier)) throw new RangeError('Footnote creation requires a valid identifier')
        const tail = core.sourceSlice(revision, { start: Math.max(0, revision.sourceLength - lineEnding.length * 2), end: revision.sourceLength })
        const separator = revision.sourceLength === 0 || tail.endsWith(lineEnding + lineEnding) ? '' : tail.endsWith(lineEnding) ? lineEnding : lineEnding + lineEnding
        const insert = separator + '[^' + action.identifier + ']: '
        const caret = revision.sourceLength + insert.length
        return result([{ start: revision.sourceLength, end: revision.sourceLength, insert }], { start: caret, end: caret })
      }
      case 'setCodeLanguage': {
        const planned = planCodeLanguage(core, revision, action.selection, action.language, action.infoOffset)
        return result(planned.edits, planned.selection)
      }
      case 'changeBlock': {
        const target = blockCommandTarget(ancestors, action.change.scope)
        if (action.change.type !== 'reset') {
          const plan = planBlockCommand(core, revision, projection, physicalLines(), target, action.change, lineEnding)
          return result(plan.edits, plan.selection)
        }
        if (target.kind === 'table') return result([], { start, end })
        if (target.kind === 'paragraph') {
          const caret = projection.coordinates.toSource(action.change.selectionMode === 'end' ? target.range.end : target.range.start, action.change.selectionMode === 'end' ? 'previous' : 'next')
          return result([], action.change.selectionMode === 'preserve' ? { start, end } : { start: caret, end: caret })
        }
        const converted: DocumentInputAction<SourceRange> = target.kind === 'list'
          ? { ...action, command: 'changeList', change: { type: 'reset' }, listOptions: { bulletListMarker: '-', orderListDelimiter: '.' } }
          : target.kind === 'blockquote'
            ? { ...action, command: 'changeBlockquote', change: { type: 'reset' } }
            : target.kind === 'heading'
              ? { ...action, command: 'changeHeading', change: { type: 'paragraph' } }
              : target.kind === 'thematic-break'
                ? { ...action, command: 'changeThematicBreak', change: { type: 'reset' } }
                : { ...action, command: 'resetCodeBlock', selectionMode: action.change.selectionMode === 'preserve' ? 'preserve' : 'end' }
        const targetSelection = action.change.at === undefined ? action.selection : { start: action.change.at, end: action.change.at }
        const plan = planStructuralInput(core, revision, { ...converted, selection: targetSelection }, enterConversion, physicalLines)
        if (action.change.selectionMode !== 'end' || isLiteralBlock(target.kind)) return result([...plan.edits], plan.selection)
        let lastContent = target
        for (let child = lastContent.children.at(-1); child !== undefined; child = lastContent.children.at(-1)) lastContent = child
        const caret = positionAfter(plan.edits, projection.coordinates.toSource(lastContent.range.end, 'previous'), false)
        return result([...plan.edits], { start: caret, end: caret })
      }
      case 'joinParagraphBackward':
      case 'joinParagraphForward': {
        const forward = action.command === 'joinParagraphForward'
        const emptyContainer = emptyParagraphJoinContainer
        const paragraphLike = paragraphJoinBlock
        // Delete at the end of a table's last cell joins the next paragraph
        // into that cell, as Backspace at the paragraph's start does.
        const cell = forward && selectedCell !== undefined && selectedCell.slotStart !== undefined ? selectedCell.cell : undefined
        const current = cell ?? [...ancestors].reverse().find(node => paragraphLike(node) || node.kind === 'heading')
        const contentEnd = (node: MarkdownAstNode): number => {
          const image = paragraphImageRange(node)
          if (image !== undefined) return image.end
          if (node.kind !== 'definition' && !emptyContainer(node)) return node.range.end
          const lines = physicalLines()
          for (let index = 0; index < lines.count; index++) {
            const line = lines.at(index)
            if (emptyContainer(node) && line.start <= node.range.start && line.contentEnd >= node.range.end) return line.contentEnd
            if (line.end === node.range.end) return line.contentEnd
            if (line.end > node.range.end) break
          }
          return node.range.end
        }
        const leadingJoin = forward || start !== end ? undefined : paragraphLeadingLineJoin(core, revision, projection, start)
        if (leadingJoin !== undefined) return result([{ ...leadingJoin, insert: '' }], { start: leadingJoin.start, end: leadingJoin.start })
        if (current === undefined || start !== end) throw new RangeError('Paragraph join requires a block-boundary caret')
        const boundary = forward && current.attributes.style === 'setext' ? Number(current.attributes.contentEnd) : forward ? contentEnd(current) : emptyContainer(current) ? contentEnd(current) : paragraphImageRange(current)?.start ?? current.range.start
        if (projected !== boundary && !(forward && current.kind === 'definition' && projected === current.range.end)) throw new RangeError('Paragraph join requires a block-boundary caret')
        // Backspace at the start of a footnote definition removes the
        // definition, not its text: its blocks take its place (#5343).
        const footnote = ancestors.find(node => node.kind === 'footnote-definition' && node.children[0] === current)
        if (!forward && footnote !== undefined) {
          const edits: DocumentSourceEdit[] = [{ start: sourceAt(footnote.range.start), end: sourceAt(current.range.start), insert: '' }]
          const lines = physicalLines()
          for (let index = 0; index < lines.count; index++) {
            const line = lines.at(index)
            if (line.start <= footnote.range.start || line.start >= footnote.range.end || line.blank) continue
            const outer = Math.max(line.start, ...line.listIndentations.map(part => part.end), ...line.blockquoteMarkers.map(part => part.end))
            const text = core.sourceSlice(revision, { start: sourceAt(outer), end: sourceAt(Math.min(line.contentEnd, outer + 4)) })
            const indentation = /^ {0,4}/u.exec(text)?.[0].length ?? 0
            if (indentation > 0) edits.push({ start: sourceAt(outer), end: sourceAt(outer) + indentation, insert: '' })
          }
          const caret = positionAfter(edits, start, true)
          return result(edits, { start: caret, end: caret })
        }
        const containers = ancestors.filter(node => node.kind === 'blockquote' || node.kind === 'list-item')
        const container = containers.at(-1)
        if (!forward && container?.kind === 'blockquote' && (container.children[0] === current || container === current)) {
          const edits: DocumentSourceEdit[] = []
          const lines = physicalLines()
          const next = container.children[1]
          let limit = container.range.end
          if (next !== undefined) {
            for (let index = 0; index < lines.count; index++) {
              const line = lines.at(index)
              if (line.start <= next.range.start && line.end > next.range.start) { limit = line.start; break }
            }
          }
          for (let index = 0; index < lines.count; index++) {
            const line = lines.at(index)
            for (const marker of line.blockquoteMarkers) {
              if (marker.depth === containers.length - 1 && marker.start >= container.range.start && marker.end <= limit) {
                edits.push({ start: sourceAt(marker.start), end: projection.coordinates.toSource(marker.end, 'previous'), insert: '' })
              }
            }
          }
          const caret = positionAfter(edits, start, true)
          return result(edits, { start: caret, end: caret })
        }
        const adjacent = paragraphJoinAdjacent(projection, current, forward)
        if (adjacent === undefined || cell !== undefined && !paragraphLike(adjacent)) return result([], { start, end })
        // Delete on a template's middle line joins it to the following HTML
        // line, as in the HTML widget; its container prefix goes with it.
        if (forward && adjacent.kind === 'html-block' && current.kind === 'paragraph' && current.range.start === current.range.end &&
            paragraphJoinAdjacent(projection, current, false)?.kind === 'html-block') {
          return result([{ start, end: sourceAt(adjacent.range.start), insert: '' }], { start, end: start })
        }
        const previous = forward ? current : adjacent
        const paragraph = forward ? adjacent : current
        if (previous.kind === 'table-cell' && paragraphLike(paragraph)) {
          const path = syntaxPathAt(projection.ast.root, previous.range.start)
          const table = path.find(node => node.kind === 'table')
          const row = path.find(node => node.kind === 'table-row')
          if (table === undefined || row === undefined) throw new RangeError('Paragraph join requires an owned table cell')
          const address = { table: { start: projection.coordinates.toSource(table.range.start, 'previous'), end: projection.coordinates.toSource(table.range.end, 'next') }, row: table.children.indexOf(row), column: row.children.indexOf(previous) }
          const cell = resolveTableCell(core, revision, address)
          const target = cell.end
          const donor = paragraphImageRange(paragraph) ?? paragraph.range
          const text = tableJoinParagraphText(core, revision, projection, paragraph)
          const spelled = tableToMarkdownWithPositions({ children: [{ children: [{ text, meta: { align: 'none' } }] }] })
          const spelledCell = spelled.rows[0]?.cells[0]
          if (spelledCell === undefined) throw new RangeError('Joined table text has no cell spelling')
          const materialized = materializeTableCellEdit(cell, { start: target, end: target, insert: spelled.markdown.slice(spelledCell.start, spelledCell.end) })
          const from = address.table.start
          const tableEnd = projection.coordinates.toSource(table.range.end, 'previous')
          const insert = core.sourceSlice(revision, { start: from, end: target }) + materialized.edit.insert + core.sourceSlice(revision, { start: target, end: tableEnd })
          const caret = target + materialized.prefixLength
          return result([{ start: from, end: projection.coordinates.toSource(donor.end, 'next'), insert }], { start: caret, end: caret })
        }
        if (!forward && isLiteralBlock(previous.kind) && paragraphImageRange(previous) === undefined && paragraphLike(paragraph)) {
          const payloadEnd = previous.children.at(-1)?.range.end
          if (payloadEnd === undefined) throw new RangeError('Code join requires its owned literal payload')
          const target = projection.coordinates.toSource(payloadEnd, 'previous')
          let removedEnd = contentEnd(paragraph)
          const lines = physicalLines()
          for (let index = 0; index < lines.count; index++) {
            const line = lines.at(index)
            if (line.contentEnd === removedEnd) { removedEnd = line.end; break }
            if (line.start > paragraph.range.end) break
          }
          const from = sourceAt(previous.range.start)
          let literalEnd = previous.range.end
          for (let index = 0; index < lines.count; index++) {
            const line = lines.at(index)
            if (line.start < literalEnd && line.contentEnd === literalEnd) { literalEnd = line.end; break }
            if (line.start > literalEnd) break
          }
          const codeEnd = projection.coordinates.toSource(literalEnd, 'previous')
          const donor = literalJoinParagraphText(core, revision, projection, lines, previous, paragraph)
          let insert = core.sourceSlice(revision, { start: from, end: target }) +
            donor.text +
            core.sourceSlice(revision, { start: target, end: codeEnd })
          if (previous.kind === 'html-block' && previous.attributes.termination === 'blank-line') {
            for (let index = 0; index < lines.count; index++) {
              const line = lines.at(index)
              if (line.start === removedEnd && line.blank) {
                insert += core.sourceSlice(revision, { start: sourceAt(line.start), end: projection.coordinates.toSource(line.end, 'previous') })
                removedEnd = line.end
                break
              }
            }
          }
          const caret = target + donor.emptyPrefix.length
          return result([{ start: from, end: projection.coordinates.toSource(removedEnd, 'next'), insert }], { start: caret, end: caret })
        }
        if (!paragraphLike(previous) && previous.kind !== 'heading' && previous.kind !== 'thematic-break' || !paragraphLike(paragraph)) throw new RangeError('Paragraph join requires an adjacent paragraph or heading')
        const from = sourceAt(contentEnd(previous))
        // A task item's paragraph begins at the space after its checkbox, which
        // belongs to the marker and goes with it (#5423).
        const taskItem = syntaxPathAt(projection.ast.root, paragraph.range.start)
          .find(node => node.kind === 'list-item' && node.children[0] === paragraph && typeof node.attributes.taskMarkerEnd === 'number')
        const donorStart = taskItem === undefined ? paragraph.range.start : Math.max(paragraph.range.start, Math.min(paragraph.range.end, Number(taskItem.attributes.taskMarkerEnd) + 1))
        const to = projection.coordinates.toSource(emptyContainer(paragraph) ? contentEnd(paragraph) : paragraphImageRange(paragraph)?.start ?? donorStart, 'previous')
        const trailing = forward ? paragraphJoinTrailingEdits(core, revision, projection, physicalLines(), previous, paragraph) : []
        if (previous.kind === 'heading' && previous.attributes.style === 'setext') {
          const target = sourceAt(Number(previous.attributes.contentEnd))
          const removedEnd = sourceAt(contentEnd(paragraph))
          let text = core.sourceSlice(revision, { start: to, end: removedEnd })
          for (const edit of [...trailing].reverse()) {
            if (edit.start >= to && edit.end <= removedEnd) text = text.slice(0, edit.start - to) + edit.insert + text.slice(edit.end - to)
          }
          return result([{ start: target, end: target, insert: text }, { start: from, end: removedEnd, insert: '' }, ...trailing.filter(edit => edit.start >= removedEnd)], { start: target, end: target })
        }
        return result([{ start: from, end: to, insert: '' }, ...trailing], { start: from, end: from })
      }
      case 'tab': {
        const literal = ancestors.find(node => ['code-block', 'diagram', 'math-block', 'html-block', 'front-matter'].includes(node.kind))
        if (literal !== undefined && typeof literal.attributes.contentStart === 'number') {
          const { from, to } = literalContentSource(projection, sourceAt, literal)
          const body = core.sourceSlice(revision, { start: from, end: to })
          const language = literal.kind === 'html-block' ? 'html' : String(literal.attributes.semanticInfo ?? literal.attributes.info ?? '').trim().split(/\s+/u)[0] ?? ''
          const expansion = codeTabExpansion(body, start - from, end - from, language)
          if (expansion !== undefined) return result([{ start: from + expansion.start, end: from + expansion.end, insert: expansion.insert }], { start: from + expansion.selection.start, end: from + expansion.selection.end })
          if (start !== end) return result([], { start, end })
          const insert = ' '.repeat(action.options.tabSize ?? 4)
          return result([{ start, end, insert }], { start: start + insert.length, end: start + insert.length })
        }
        const planned = planParagraphTab(core, revision, projection, ancestors, physicalLines(), { start, end }, action.shift, action.options.tabSize ?? 4)
        return result(planned.edits, planned.selection)
      }
      case 'setTaskChecked': {
        const planned = planTaskChecked(core, revision, projection, ancestors, start, action.checked, action.autoCheck, action.autoMoveCheckedToEnd)
        return result(planned.edits, planned.selection)
      }
      case 'changeList': {
        const planned = planListChange(core, revision, projection, ancestors, physicalLines(), { start, end }, action.change, action.listOptions)
        return result(planned.edits, planned.selection)
      }
      case 'exitTable': {
        const table = ancestors.find(node => node.kind === 'table')
        if (table === undefined) throw new RangeError('Table exit requires a cell selection')
        return moveAfter(table)
      }
      case 'tableBoundaryBackspace': {
        const table = ancestors.find(node => node.kind === 'table')
        if (table === undefined || selectedCell === undefined) throw new RangeError('Table boundary Backspace requires a cell selection')
        const from = sourceAt(table.range.start)
        const to = projection.coordinates.toSource(table.range.end, 'previous')
        const empty = table.children.every(row => row.children.every(cell => cell.children.length === 0)) &&
          !annotationsOverlapping(core, revision, { start: from, end: to }).some(annotation => annotation.range.start < to && annotation.range.end > from)
        if (empty) return result([{ start: from, end: to, insert: '' }], { start: from, end: from })
        let previous: MarkdownAstNode | undefined
        const visit = (node: MarkdownAstNode): void => {
          if (node.range.end > table.range.start) {
            for (const child of node.children) visit(child)
          } else if (['paragraph', 'heading', 'table-cell', 'code-block', 'math-block', 'diagram', 'front-matter'].includes(node.kind)) previous = node
          else for (const child of node.children) visit(child)
        }
        visit(projection.ast.root)
        if (previous === undefined) return result([], { start, end })
        const at = projection.coordinates.toSource(typeof previous.attributes.contentEnd === 'number' ? previous.attributes.contentEnd : previous.children.at(-1)?.range.end ?? previous.range.end, 'previous')
        return result([], { start: at, end: at })
      }
      case 'createFrontMatter': {
        if (projection.ast.root.children[0]?.kind === 'front-matter') return result([], { start, end })
        const spelling = frontMatterPolicy(action.style)
        const insert = spelling.open + lineEnding + lineEnding + spelling.close + lineEnding + lineEnding
        const caret = spelling.open.length + lineEnding.length
        const edits: DocumentSourceEdit[] = [{ start: 0, end: 0, insert }]
        if (action.replace) {
          const { target, from, to } = insertionTarget()
          if (target !== undefined && target.kind !== 'paragraph') throw new RangeError('Front matter Quick Insert requires a paragraph')
          if (from === 0) edits[0] = { start: 0, end: to, insert }
          else if (to > from) edits.push({ start: from, end: to, insert: '' })
        }
        return result(edits, { start: caret, end: caret })
      }
      case 'resetCodeBlock': {
        if (action.selectionMode !== 'preserve' && action.selectionMode !== 'end') throw new RangeError('Invalid code reset selection mode')
        const code = [...ancestors].reverse().find(node => isLiteralBlock(node.kind))
        if (code === undefined || typeof code.attributes.contentStart !== 'number' || typeof code.attributes.contentEnd !== 'number') throw new RangeError('Code reset requires an owned code block')
        const payload = code.children
        const first = payload[0]
        const last = payload.at(-1)
        if (first === undefined || last === undefined || payload.some(node => node.kind !== 'text' && node.kind !== 'soft-break')) throw new RangeError('Code reset requires its owned literal payload')
        const lines = physicalLines()
        const lineAt = (offset: number) => {
          let low = 0
          let high = lines.count
          while (low < high) {
            const middle = low + Math.floor((high - low) / 2)
            if (lines.at(middle).start <= offset) low = middle + 1
            else high = middle
          }
          return lines.at(Math.max(0, low - 1))
        }
        const prefixEnd = (line: ReturnType<typeof lineAt>) => Math.max(line.start,
          ...line.listMarkers.map(marker => marker.contentOffset),
          ...line.listIndentations.map(marker => marker.end),
          ...line.blockquoteMarkers.map(marker => marker.end))
        const opener = lineAt(code.range.start)
        const closer = lineAt(Math.max(code.range.start, code.range.end - 1))
        const from = sourceAt(prefixEnd(opener))
        const payloadStart = sourceAt(first.range.start)
        const payloadEnd = projection.coordinates.toSource(last.range.end, 'previous')
        const to = projection.coordinates.toSource(closer.contentEnd, 'previous')
        const edits: DocumentSourceEdit[] = []
        const remove = (from: number, to: number) => {
          if (to > from) edits.push({ start: from, end: to, insert: '' })
        }
        remove(from, payloadStart)
        let previousLine = lineAt(first.range.start).start
        for (const child of payload) {
          if (child.kind === 'soft-break') continue
          const line = lineAt(child.range.start)
          const range = { start: sourceAt(child.range.start), end: projection.coordinates.toSource(child.range.end, 'previous') }
          if (line.start !== previousLine) {
            remove(sourceAt(prefixEnd(line)), range.start)
            previousLine = line.start
          }
          const value = child.attributes.semanticText
          if (typeof value !== 'string') throw new RangeError('Code reset requires literal payload text')
          const text = code.kind === 'html-block' ? literalParagraphSpelling(value) : value
          if (core.sourceSlice(revision, range) !== text) edits.push({ ...range, insert: text })
        }
        remove(payloadEnd, to)
        const map = (position: number) => positionAfter(edits, Math.max(payloadStart, Math.min(payloadEnd, position)), false)
        return result(edits, action.selectionMode === 'end'
          ? { start: map(payloadEnd), end: map(payloadEnd) }
          : { start: map(start), end: map(end) })
      }
      case 'wrapCodeBlocks': {
        const projectedEnd = projection.coordinates.toProjected(end, 'previous')
        const blocks = projection.ast.root.children
        const outmostAt = (position: number) => blocks.find(node => node.range.start === position) ??
          blocks.find(node => node.range.start < position && position < node.range.end) ??
          blocks.find(node => node.range.end === position)
        const first = outmostAt(projected)
        const last = outmostAt(projectedEnd)
        if (first === undefined || last === undefined) throw new RangeError('Code wrapping requires selected outmost blocks')
        let from = first.range.start
        let to = last.range.end
        const lines = physicalLines()
        for (let index = 0; index < lines.count; index++) {
          const line = lines.at(index)
          if (line.start <= first.range.start && first.range.start <= line.contentEnd) from = line.start
          if (line.end === last.range.end) to = line.contentEnd
          if (line.start > last.range.end) break
        }
        const sourceStart = projection.coordinates.toSource(from, 'previous')
        const sourceEnd = projection.coordinates.toSource(to, 'next')
        const body = core.sourceSlice(revision, { start: sourceStart, end: sourceEnd })
        // The serializer chooses collision-safe fences. Existing block bytes
        // remain literal payload; only the new fence lines use the document EOL.
        const spelling = fencedCodeMarkdown(body.replace(/\r\n|\r/gu, '\n'), '', '', undefined, lineEnding)
        const opening = spelling.markdown.slice(0, spelling.contentStart)
        const insert = opening + body + lineEnding + opening.slice(0, -lineEnding.length)
        const caret = sourceStart + opening.length
        return result([{ start: sourceStart, end: sourceEnd, insert }], { start: caret, end: caret })
      }
      case 'createCodeBlock': {
        if (typeof action.replace !== 'boolean') throw new RangeError('Code insertion requires its replacement intent')
        const { target, continuation, from, to } = insertionTarget()
        const replace = action.replace || target === undefined
        const prefix = replace ? '' : lineEnding + continuation.trimEnd() + lineEnding + continuation
        const spelling = fencedCodeMarkdown('', '', continuation, undefined, lineEnding)
        const insert = prefix + spelling.markdown.slice(continuation.length, -lineEnding.length)
        const at = replace ? from : to
        const caret = at + prefix.length + spelling.contentStart - continuation.length
        return result([{ start: at, end: replace ? to : at, insert }], { start: caret, end: caret })
      }
      case 'changeThematicBreak': {
        const rule = ancestors.find(node => node.kind === 'thematic-break')
        if (action.change.type === 'enter') {
          if (rule === undefined) throw new RangeError('Horizontal rule Enter requires the selected rule')
          const before = start === end && projected === rule.range.start
          const at = projection.coordinates.toSource(before ? rule.range.start : rule.range.end, before ? 'previous' : 'next')
          const continuation = containerContinuationPrefix(core, revision, projection, rule, ancestors)
          const insert = lineEnding + continuation.trimEnd() + lineEnding + continuation
          // Native Enter at the start leaves the caret on the original rule;
          // other rule selections move into the new following paragraph.
          const caret = at + insert.length
          return result([{ start: at, end: at, insert: insert + finalLine(at, continuation) }], { start: caret, end: caret })
        }
        if (action.change.type === 'reset' || action.change.type === 'toggle' && rule !== undefined) {
          if (rule === undefined) throw new RangeError('Horizontal rule reset requires the selected rule')
          const from = projection.coordinates.toSource(rule.range.start, 'previous')
          const to = projection.coordinates.toSource(rule.range.end, 'next')
          // The rule's line becomes the empty paragraph upstream leaves there.
          const removal = { start: from, end: to, insert: '' }
          const separators = planEmptiedParagraph(core, revision, projection, rule, [removal]) ?? []
          const before = separators.filter(edit => edit.end <= from)
          const caret = from + before.reduce((length, edit) => length + edit.insert.length, 0)
          return result(mergeAdjacentEdits([...before, removal, ...separators.filter(edit => edit.start >= to)]), { start: caret, end: caret })
        }
        const { target, continuation, from, to } = insertionTarget()
        const empty = target?.kind === 'paragraph' && target.range.start === target.range.end &&
          !revision.annotations.some(annotation => annotation.range.start < to && annotation.range.end > from)
        const replace = action.change.type === 'replace' || target === undefined || empty
        const prefix = replace ? '' : lineEnding + continuation.trimEnd() + lineEnding + continuation
        // `- ---` is a root thematic break, not a rule inside a dash-list item.
        // Underscores cannot merge with a list marker into one thematic break.
        const marker = replace && ancestors.some(node => node.kind === 'list-item') ? '___' : '---'
        const insert = prefix + marker + lineEnding + continuation.trimEnd() + lineEnding + continuation
        const at = replace ? from : to
        const caret = at + insert.length
        return result([{ start: at, end: replace ? to : at, insert: insert + finalLine(to, continuation) }], { start: caret, end: caret })
      }
      case 'createMathBlock': {
        if (typeof action.replace !== 'boolean') throw new RangeError('Math insertion requires its replacement intent')
        const { target, continuation, from, to } = insertionTarget()
        const replace = action.replace || target === undefined
        const prefix = replace ? '' : lineEnding + continuation.trimEnd() + lineEnding + continuation
        const insert = prefix + '$$' + lineEnding + continuation + lineEnding + continuation + '$$'
        const at = replace ? from : to
        const caret = at + prefix.length + 2 + lineEnding.length + continuation.length
        return result([{ start: at, end: replace ? to : at, insert }], { start: caret, end: caret })
      }
      case 'createHtmlBlock': {
        if (typeof action.replace !== 'boolean' || !['content', 'end'].includes(action.selectionMode)) throw new RangeError('HTML block insertion requires its replacement and selection intent')
        const { target, continuation, from, to } = insertionTarget()
        const replace = action.replace || target === undefined
        const prefix = replace ? '' : lineEnding + continuation.trimEnd() + lineEnding + continuation
        const template = htmlBlockTemplate('div', lineEnding, continuation)
        const at = replace ? from : to
        const caret = at + prefix.length + (action.selectionMode === 'end' ? template.markdown.length : template.caret)
        return result([{ start: at, end: replace ? to : at, insert: prefix + template.markdown }], { start: caret, end: caret })
      }
      case 'createTable': {
        const dimensions = normalizeTableDimensions(action.rows, action.columns)
        if (dimensions.rows * dimensions.columns > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits / 6) throw new RangeError('Created table exceeds the source budget')
        const { target, continuation, from, to } = insertionTarget()
        const table = tableToMarkdownWithPositions({ children: Array.from({ length: dimensions.rows }, () => ({ children: Array.from({ length: dimensions.columns }, () => ({ text: '', meta: { align: 'none' } })) })) }, continuation, DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits)
        if (table === undefined) throw new RangeError('Created table exceeds the source budget')
        const first = table.rows[0]?.cells[0]
        if (first === undefined) throw new RangeError('Created table has no first cell')
        const emptyHeading = target?.kind === 'heading' && target.attributes.contentStart === target.attributes.contentEnd
        const ownsAnnotation = revision.annotations.some(annotation => annotation.range.start < to && annotation.range.end > from)
        const replace = action.replace || target === undefined || !ownsAnnotation && (target.range.start === target.range.end || emptyHeading)
        const prefix = replace ? '' : lineEnding + continuation.trimEnd() + lineEnding
        const spelling = table.markdown.replace(/\n/gu, lineEnding)
        const insert = prefix + (replace ? spelling.slice(continuation.length) : spelling)
        const at = replace ? from : to
        const caret = at + prefix.length + first.start - (replace ? continuation.length : 0)
        return result([{ start: at, end: replace ? to : at, insert }], { start: caret, end: caret })
      }
      case 'moveText':
      case 'moveBlock':
      case 'moveTableColumn':
      case 'moveTableRow':
        throw new RangeError('Table moves require the directed model input boundary')
      case 'alignTableColumn': {
        if (!['left', 'center', 'right'].includes(action.alignment)) throw new RangeError('Invalid table alignment')
        const target = resolveTableCell(core, revision, action.target)
        const header = target.table.children[0]?.children[target.column]
        const from = header?.attributes.delimiterContentStart
        const to = header?.attributes.delimiterContentEnd
        if (header === undefined || typeof from !== 'number' || typeof to !== 'number') throw new RangeError('Table alignment target has no owned delimiter')
        const current = typeof header.attributes.alignment === 'string' ? header.attributes.alignment : 'none'
        const next = toggleTableAlignment(current, action.alignment)
        const oldMarkers = tableDelimiterMarkers(current)
        const newMarkers = tableDelimiterMarkers(next)
        const edits: DocumentSourceEdit[] = []
        if (oldMarkers.start !== newMarkers.start) {
          edits.push({
            start: sourceAt(from),
            end: oldMarkers.start === '' ? sourceAt(from) : projection.coordinates.toSource(from + oldMarkers.start.length, 'previous'),
            insert: newMarkers.start
          })
        }
        if (oldMarkers.end !== newMarkers.end) {
          edits.push({
            start: oldMarkers.end === '' ? projection.coordinates.toSource(to, 'previous') : sourceAt(to - oldMarkers.end.length),
            end: projection.coordinates.toSource(to, 'previous'),
            insert: newMarkers.end
          })
        }
        return result(edits, { start: positionAfter(edits, start, true), end: positionAfter(edits, end, true) })
      }
      case 'changeBlockquote': {
        if (!['set', 'quick-insert', 'toggle', 'reset'].includes(action.change.type)) throw new RangeError('Invalid blockquote change')
        if (action.change.type === 'toggle' || action.change.type === 'reset') {
          const lines = physicalLines()
          const finish = (edits: DocumentSourceEdit[], before: SourceRange) => result(edits, {
            start: positionAfter(edits, before.start, true), end: positionAfter(edits, before.end, true)
          })
          if (quote !== undefined) {
            const edits: DocumentSourceEdit[] = []
            const containers = ancestors.filter(node => node.kind === 'blockquote' || node.kind === 'list-item')
            for (let index = 0; index < lines.count; index++) {
              const line = lines.at(index)
              for (const marker of line.blockquoteMarkers) {
                const owner = containers[marker.depth]
                if (owner?.kind !== 'blockquote' || marker.start < owner.range.start || marker.end > owner.range.end) continue
                if (action.change.type === 'reset' && owner !== quote) continue
                edits.push({ start: sourceAt(marker.start), end: projection.coordinates.toSource(marker.end, 'previous'), insert: '' })
              }
            }
            return finish(edits, { start, end })
          }
          if (action.change.type === 'reset') return result([], { start, end })
          const projectedEnd = projection.coordinates.toProjected(end, 'previous')
          const first = projection.ast.root.children.find(node => node.range.start <= projected && node.range.end >= projected)
          const last = projection.ast.root.children.find(node => node.range.start <= projectedEnd && node.range.end >= projectedEnd)
          if (first === undefined || last === undefined) throw new RangeError('Blockquote command has no selected blocks')
          const edits: DocumentSourceEdit[] = []
          const paragraphStarts = new Map(projection.ast.root.children
            .filter(node => node.kind === 'paragraph' && node.range.start >= first.range.start && node.range.end <= last.range.end)
            .map(node => {
              const from = sourceAt(node.range.start)
              const to = projection.coordinates.toSource(node.range.end, 'previous')
              return [node.range.start, paragraphPrefixPosition(revision.annotations, { start: from, end: to }) ?? from]
            }))
          for (let index = 0; index < lines.count; index++) {
            const line = lines.at(index)
            if (line.start < first.range.start || line.start >= last.range.end) continue
            const at = paragraphStarts.get(line.start) ?? sourceAt(line.start)
            edits.push({ start: at, end: at, insert: line.blank ? '>' : '> ' })
          }
          return finish(edits, first === last ? { start, end } : { start: sourceAt(first.range.start), end: projection.coordinates.toSource(last.range.end, 'previous') })
        }
        if (block === undefined && projection.ast.root.children.length === 0 && start === end) return result([{ start, end, insert: '> ' }], { start: start + 2, end: start + 2 })
        if (block === undefined || block.kind !== 'paragraph') throw new RangeError('Blockquote menu requires a paragraph')
        const paragraphStart = sourceAt(block.range.start)
        const to = projection.coordinates.toSource(block.range.end, 'previous')
        const from = action.change.type === 'quick-insert'
          ? paragraphStart
          : paragraphPrefixPosition(revision.annotations, { start: paragraphStart, end: to }) ?? paragraphStart
        if (action.change.type === 'quick-insert') return result([{ start: from, end: to, insert: '> ' }], { start: from + 2, end: from + 2 })
        const positions = new Set([from])
        // Quote the actual lines contributed by this owned paragraph. Hidden
        // comment bytes are not paragraph text and must remain untouched.
        for (const event of core.project(revision, 'markup').events) {
          if (event.kind !== 'text') continue
          for (const match of event.text.matchAll(/\r\n|\r|\n/gu)) {
            const at = event.sourceRange.start + match.index + match[0].length
            if (at > from && at < to) positions.add(at)
          }
        }
        const edits = [...positions].sort((left, right) => left - right).map(at => ({ start: at, end: at, insert: '> ' }))
        return result(edits, { start: positionAfter(edits, start, true), end: positionAfter(edits, end, true) })
      }
      case 'changeHeading': {
        const currentLevel = block?.kind === 'heading' ? Number(block.attributes.level) : 0
        const change = action.change
        if ('level' in change && (!Number.isInteger(change.level) || change.level < 1 || change.level > 6)) throw new RangeError('Heading level must be from one to six')
        let level: number
        switch (change.type) {
          case 'toggle': level = currentLevel === change.level ? 0 : change.level; break
          case 'set':
          case 'quick-insert': level = change.level; break
          case 'upgrade': level = currentLevel === 0 ? 6 : Math.max(1, currentLevel - 1); break
          case 'degrade': level = currentLevel === 0 || currentLevel === 6 ? 0 : currentLevel + 1; break
          case 'paragraph': level = 0; break
          default: throw new RangeError('Invalid heading change')
        }
        if (level === currentLevel) return result([], { start, end })
        if (block === undefined) {
          if (projection.ast.root.children.length !== 0 || start !== end) throw new RangeError('Heading command requires a paragraph or heading')
          const insert = '#'.repeat(level) + ' '
          return result([{ start, end, insert }], { start: start + insert.length, end: start + insert.length })
        }
        const contentStart = typeof block.attributes.contentStart === 'number' ? block.attributes.contentStart : block.range.start
        const contentEnd = typeof block.attributes.contentEnd === 'number' ? block.attributes.contentEnd : block.range.end
        const to = projection.coordinates.toSource(block.range.end, 'previous')
        const paragraphStart = sourceAt(block.range.start)
        const from = block.kind === 'paragraph' && change.type !== 'quick-insert'
          ? paragraphPrefixPosition(revision.annotations, { start: paragraphStart, end: to }) ?? paragraphStart
          : paragraphStart
        const payloadStart = block.kind === 'paragraph' ? from : sourceAt(contentStart)
        const marker = level === 0 ? '' : '#'.repeat(level) + ' '
        if (change.type === 'quick-insert') {
          if (block.kind !== 'paragraph') throw new RangeError('Quick insertion requires a paragraph')
          return result([{ start: from, end: to, insert: marker }], { start: from + marker.length, end: from + marker.length })
        }
        const edits: DocumentSourceEdit[] = []
        const removeMarkers = (start: number, end: number) => {
          for (const segment of projection.coordinates.sourceSegments ?? []) {
            const left = Math.max(start, segment.projected.start)
            const right = Math.min(end, segment.projected.end)
            if (right <= left) continue
            edits.push({ start: segment.source.start + left - segment.projected.start, end: segment.source.start + right - segment.projected.start, insert: '' })
          }
        }
        // Prefixes and closing markers own their visible spelling, not any
        // zero-width comments or annotations between those delimiter spans.
        if (block.kind === 'heading') {
          removeMarkers(block.range.start, contentStart)
          const first = edits[0]
          if (first?.start === from) edits[0] = { ...first, insert: marker }
          else if (marker !== '') edits.unshift({ start: from, end: from, insert: marker })
          removeMarkers(contentEnd, block.range.end)
        } else edits.push({ start: from, end: payloadStart, insert: marker })
        // An ATX heading is one line, so the text's other lines join it with a
        // space rather than being left behind as a paragraph (#5366).
        if (level > 0) {
          const lines = physicalLines()
          let previous: ReturnType<MarkdownLineIndex['at']> | undefined
          for (let index = 0; index < lines.count; index++) {
            const line = lines.at(index)
            if (line.start >= contentEnd) break
            if (line.end <= contentStart) continue
            if (previous !== undefined && line.start > contentStart) {
              const lineContent = Math.max(line.start, ...line.listIndentations.map(part => part.end), ...line.blockquoteMarkers.map(part => part.end))
              edits.push({ start: sourceAt(previous.contentEnd), end: sourceAt(lineContent), insert: ' ' })
            }
            previous = line
          }
          edits.sort((left, right) => left.start - right.start)
        }
        return result(edits, {
          start: positionAfter(edits, Math.max(start, payloadStart), true),
          end: positionAfter(edits, Math.max(end, payloadStart), true)
        })
      }
      case 'insertTableColumn':
      case 'removeTableColumn': {
        const table = ancestors.find(node => node.kind === 'table')
        const row = ancestors.find(node => node.kind === 'table-row')
        const cell = ancestors.find(node => node.kind === 'table-cell')
        if (table === undefined || row === undefined || cell === undefined) throw new RangeError('Table column command requires a cell selection')
        const column = selectedCell?.column ?? row.children.indexOf(cell)
        const header = table.children[0]
        if (header === undefined || column < 0) throw new RangeError('Table column command requires a header')
        if (action.command === 'insertTableColumn' && action.placement !== 'before' && action.placement !== 'after') throw new RangeError('Invalid table column placement')
        if (action.command === 'removeTableColumn') {
          const removal = planTableRemoval(core, revision, projection, table, { axis: 'column', first: column, last: column })
          return result(removal.edits, removal.selection)
        }
        const spelling = emptyTableColumn()
        const edits: DocumentSourceEdit[] = []
        let caret: number | undefined
        const slot = (node: MarkdownAstNode | undefined, delimiter: boolean): SourceRange | undefined => {
          const start = node?.attributes[delimiter ? 'delimiterStart' : 'cellStart']
          const end = node?.attributes[delimiter ? 'delimiterEnd' : 'cellEnd']
          if (typeof start !== 'number' || typeof end !== 'number') return undefined
          return { start: sourceAt(start), end: projection.coordinates.toSource(end, 'previous') }
        }
        const editRow = (current: MarkdownAstNode, delimiter: boolean): void => {
          const selected = slot(current.children[column], delimiter)
          if (selected === undefined) {
            if (delimiter || current === header) throw new RangeError('Table header has no physical source slot')
            if (action.command !== 'insertTableColumn') return
            const physical = current.children.map(node => slot(node, false)).filter((range): range is SourceRange => range !== undefined)
            const last = physical[physical.length - 1]
            if (last === undefined) throw new RangeError('Table body has no physical source slot')
            const at = projection.coordinates.toSource(current.range.end, 'previous')
            const count = column + (action.placement === 'after' ? 1 : 0) - physical.length + 1
            const insert = (last.end === at ? '|' : '') + `${spelling.cell}|`.repeat(count)
            edits.push({ start: at, end: at, insert })
            return
          }
          if (action.command === 'insertTableColumn') {
            const text = delimiter ? spelling.delimiter : spelling.cell
            const before = action.placement === 'before'
            const at = before ? selected.start : selected.end
            edits.push({ start: at, end: at, insert: before ? `${text}|` : `|${text}` })
            if (current === header && !delimiter) caret = at + text.length + (before ? 0 : 1)
          }
        }
        for (const current of table.children) {
          editRow(current, false)
          if (current === header) editRow(current, true)
        }
        if (caret === undefined) throw new RangeError('Table column command has no resulting selection')
        return result(edits.sort((left, right) => left.start - right.start), { start: caret, end: caret })
      }
      case 'removeTableRow': {
        const table = ancestors.find(node => node.kind === 'table')
        const row = ancestors.find(node => node.kind === 'table-row')
        if (table === undefined || row === undefined) throw new RangeError('Table row command requires a table selection')
        const index = table.children.indexOf(row)
        const removal = planTableRemoval(core, revision, projection, table, { axis: 'row', first: index, last: index })
        return result(removal.edits, removal.selection)
      }
      case 'insertTableRow': {
        const table = ancestors.find(node => node.kind === 'table')
        const row = ancestors.find(node => node.kind === 'table-row')
        if (table === undefined || row === undefined) throw new RangeError('Table row command requires a table selection')
        const header = table.children[0]
        if (header === undefined) throw new RangeError('Table row command requires a header')
        const newRow = emptyTableRow(header.children.length)
        const continuation = containerContinuationPrefix(core, revision, projection, row, ancestors)
        if (action.placement === 'before') {
          const at = projection.coordinates.toSource(row.range.start, 'previous')
          if (row !== header) {
            return result([{ start: at, end: at, insert: newRow.markdown + lineEnding + continuation }], {
              start: at + newRow.firstCellText, end: at + newRow.firstCellText
            })
          }
          // The first Markdown row is the header. Moving it into the body also
          // moves its existing alignment delimiter beneath the new empty header.
          const headerEnd = projection.coordinates.toSource(header.range.end, 'previous')
          const delimiterStart = sourceAt(Number(table.attributes.delimiterStart))
          const delimiterEnd = projection.coordinates.toSource(Number(table.attributes.delimiterEnd), 'previous')
          const delimiterSource = core.sourceSlice(revision, { start: delimiterStart, end: delimiterEnd })
          const separator = core.sourceSlice(revision, { start: headerEnd, end: delimiterStart })
          return result([
            { start: at, end: at, insert: newRow.markdown + lineEnding + continuation + delimiterSource + separator },
            { start: headerEnd, end: delimiterEnd, insert: '' }
          ], {
            start: at + newRow.firstCellText, end: at + newRow.firstCellText
          })
        }
        if (action.placement !== 'after') throw new RangeError('Invalid table row placement')
        const projectedEnd = row === header ? Number(table.attributes.delimiterEnd) : row.range.end
        const at = projection.coordinates.toSource(projectedEnd, 'previous')
        const caret = at + lineEnding.length + continuation.length + newRow.firstCellText
        return result([{ start: at, end: at, insert: lineEnding + continuation + newRow.markdown }], { start: caret, end: caret })
      }
      default: {
        const unsupported: never = action
        throw new RangeError(`Unsupported document command: ${unsupported}`)
      }
    }
  }
  const isEmptyContainer = (node: MarkdownAstNode | undefined): boolean => {
    if (node === undefined || node.children.length > 1 || node.children.some(child =>
      child.kind !== 'paragraph' || child.range.start !== child.range.end || child.children.length !== 0
    )) return false
    return true
  }
  const empty = isEmptyContainer(item) ? item : isEmptyContainer(quote) ? quote : undefined
  if (empty !== undefined && inputType === 'insertParagraph' && start === end) {
    const from = sourceAt(empty.range.start)
    const trailingSpace = core.sourceSlice(revision, { start, end: revision.sourceLength }).match(/^[ \t]*/u)?.[0].length ?? 0
    // A root container emptied at the end of a document with earlier content
    // leaves a final empty paragraph, written as upstream writes it: a blank
    // separator line, then the paragraph's own line.
    const rest = core.sourceSlice(revision, { start: start + trailingSpace, end: revision.sourceLength })
    const before = core.sourceSlice(revision, { start: Math.max(0, from - 256), end: from })
    const blank = /(?:\r\n|\r|\n)(?:[ \t]*(?:\r\n|\r|\n))*$/u.exec(before)
    const contentEnd = blank === null ? 0 : from - blank[0].length
    if (from > 0 && blank !== null && contentEnd > 0 && /^(?:\r\n|\r|\n)?$/u.test(rest)) {
      return result([{ start: contentEnd, end: revision.sourceLength, insert: lineEnding.repeat(3) }], { start: contentEnd + lineEnding.length * 2, end: contentEnd + lineEnding.length * 2 })
    }
    return result([{ start: from, end: start + trailingSpace, insert: '' }], { start: from, end: from })
  }
  const fence = ancestors.find(node => node.kind === 'code-block' || node.kind === 'diagram' || node.kind === 'math-block' || node.kind === 'front-matter')
  if (fence !== undefined && inputType === 'insertLineBreak') return moveAfter(fence)
  // Upstream's paragraph Enter conversion (#5600) turns a whole fence opener
  // line into a block and writes it as its serializer does. An opener's own
  // indentation of one to three spaces inside its container is dropped.
  const openerOwnIndent = (node: MarkdownAstNode, openerStart: number): number =>
    fenceOpenerOwnIndent(core, revision, projection, ancestors.slice(0, ancestors.indexOf(node)), openerStart)
  if (fence?.kind === 'diagram' && inputType === 'insertParagraph' && start === end && fence.attributes.content === '' &&
      typeof fence.attributes.contentStart === 'number' && fence.range.end <= fence.attributes.contentStart) {
    // A diagram fence becomes a diagram block, which upstream writes with
    // backticks and its diagram type, whatever fence character was typed.
    // Upstream matches the type exactly; another spelling is a code fence.
    const openerStart = sourceAt(fence.range.start)
    const indent = openerOwnIndent(fence, openerStart)
    const rest = core.sourceSlice(revision, { start: openerStart, end: Math.min(revision.sourceLength, openerStart + 1024) })
    const lineEnd = openerStart + (rest.search(/[\r\n]/u) < 0 ? rest.length : rest.search(/[\r\n]/u))
    const [, run = '```', word = ''] = /^(`+|~+)[ \t]*(\S*)/u.exec(rest) ?? []
    const fenceText = fenceDiagramType(word) === undefined ? run.slice(0, 1).repeat(3) : '```'
    const prefix = containerContinuationPrefix(core, revision, projection, fence, ancestors.slice(0, ancestors.indexOf(fence)))
    const continuation = prefix.slice(0, prefix.length - indent)
    const opener = fenceText + word
    const insert = opener + lineEnding + continuation + lineEnding + continuation + fenceText
    const caret = openerStart - indent + opener.length + lineEnding.length + continuation.length
    return result([{ start: openerStart - indent, end: lineEnd, insert }], { start: caret, end: caret })
  }
  if (fence !== undefined && inputType === 'insertParagraph' && fence.attributes.content === '' &&
      typeof fence.attributes.contentStart === 'number' && fence.range.end <= fence.attributes.contentStart &&
      typeof fence.attributes.infoStart === 'number') {
    const openerStart = sourceAt(fence.range.start)
    const marker = core.sourceSlice(revision, { start: openerStart, end: sourceAt(fence.attributes.infoStart) })
    if (fence.kind === 'code-block' && start === end && typeof fence.attributes.infoEnd === 'number') {
      // Upstream (#5600) turns the whole opener line into a fenced block, as
      // it serializes one: the opener's fence character three times, the
      // info string's first word, an empty body line and a closer like the
      // opener. The caret's place on the line does not matter.
      const infoEnd = sourceAt(fence.attributes.infoEnd)
      const info = core.sourceSlice(revision, { start: sourceAt(fence.attributes.infoStart), end: infoEnd })
      const trailing = /^[ \t]*/u.exec(core.sourceSlice(revision, { start: infoEnd, end: Math.min(revision.sourceLength, infoEnd + 256) }))?.[0].length ?? 0
      const language = /^\S*/u.exec(info.trimStart())?.[0] ?? ''
      const fenceText = (marker.trimStart().startsWith('~') || language.includes('`') ? '~' : '`').repeat(3)
      const indent = openerOwnIndent(fence, openerStart)
      const prefix = containerContinuationPrefix(core, revision, projection, fence, ancestors.slice(0, ancestors.indexOf(fence)))
      const continuation = prefix.slice(0, prefix.length - indent)
      const opener = fenceText + language
      const insert = opener + lineEnding + continuation + lineEnding + continuation + fenceText
      const caret = openerStart - indent + opener.length + lineEnding.length + continuation.length
      return result([{ start: openerStart - indent, end: infoEnd + trailing, insert }], { start: caret, end: caret })
    }
    const insert = lineEnding + lineEnding + marker
    return result([{ start, end, insert }], { start: start + lineEnding.length, end: start + lineEnding.length })
  }
  if (fence !== undefined && typeof fence.attributes.contentStart === 'number' && inputType === 'insertParagraph') {
    const { from, to } = literalContentSource(projection, sourceAt, fence)
    const body = core.sourceSlice(revision, { start: from, end: to })
    if (fence.attributes.provider === 'indented-code') {
      // Each line of indented code repeats its line's indentation and containers.
      const line = core.sourceSlice(revision, { start: 0, end: start })
      const prefix = /^[ \t>]*/u.exec(line.slice(Math.max(line.lastIndexOf('\n'), line.lastIndexOf('\r')) + 1))?.[0] ?? ''
      const insert = lineEnding + prefix
      return result([{ start, end, insert }], { start: start + insert.length, end: start + insert.length })
    }
    // Each new body line continues the fence's quotes and list indentation.
    const prefix = containerContinuationPrefix(core, revision, projection, fence, ancestors.slice(0, ancestors.indexOf(fence)))
    if (body === '' && start === end) {
      // An empty body has no line; its text's first line break needs two.
      const line = prefix + lineEnding
      return result([{ start, end, insert: line + line }], { start: start + line.length + prefix.length, end: start + line.length + prefix.length })
    }
    // The policy reads the code's own line, after its container prefix.
    const offset = start - from
    const lineStart = Math.max(body.lastIndexOf('\n', offset - 1), body.lastIndexOf('\r', offset - 1)) + 1
    const lineEnd = body.slice(lineStart).search(/\r|\n/u)
    const sourceLine = body.slice(lineStart, lineEnd === -1 ? body.length : lineStart + lineEnd)
    const strip = prefix !== '' && sourceLine.startsWith(prefix) && offset - lineStart >= prefix.length ? prefix.length : 0
    const policy = codeEnter(sourceLine.slice(strip), offset - lineStart - strip, action.options.tabSize ?? 4, lineEnding)
    const continued = (text: string) => text.replaceAll(lineEnding, lineEnding + prefix)
    const insert = continued(policy.insert)
    const caret = start + continued(policy.insert.slice(0, policy.caret)).length
    return result([{ start, end, insert }], { start: caret, end: caret })
  }
  // A multi-line HTML block is MarkText's HTML code widget: Enter adds one line
  // within its containers, indented like the block's first line and opened
  // between a tag or bracket pair. A single-line block keeps paragraph Enter.
  const html = ancestors.find(node => node.kind === 'html-block')
  // A lone known opening tag becomes an empty element whose middle line holds
  // the caret, wherever the caret sits in the opener.
  if (html !== undefined && inputType === 'insertParagraph' && !html.children.some(child => child.kind === 'soft-break')) {
    const from = sourceAt(html.children[0]?.range.start ?? html.range.start)
    const to = projection.coordinates.toSource(html.children.at(-1)?.range.end ?? html.range.start, 'previous')
    const tagName = htmlBlockTemplateTag(core.sourceSlice(revision, { start: from, end: to }))
    if (tagName !== undefined && from <= start && end <= to) {
      const continuation = containerContinuationPrefix(core, revision, projection, html, ancestors.slice(0, ancestors.indexOf(html)))
      const template = htmlBlockTemplate(tagName, lineEnding, continuation)
      return result([{ start: from, end: to, insert: template.markdown }], { start: from + template.caret, end: from + template.caret })
    }
  }
  if (html !== undefined && inputType === 'insertParagraph' && html.children.some(child => child.kind === 'soft-break')) {
    const continuation = lineEnding + containerContinuationPrefix(core, revision, projection, html, ancestors.slice(0, ancestors.indexOf(html)))
    const indent = /^[ \t]*/u.exec(core.sourceSlice(revision, { start: sourceAt(html.range.start), end: sourceAt(html.range.end) }))?.[0] ?? ''
    const pair = start === end && /^(?:\{\}|\[\]|\(\)|><)$/u.test(core.sourceSlice(revision, { start: Math.max(0, start - 1), end: Math.min(revision.sourceLength, start + 1) }))
    const opened = pair ? indent + ' '.repeat(action.options.tabSize ?? 4) : ''
    const insert = continuation + (pair ? opened + continuation : '') + indent
    const caret = start + continuation.length + (pair ? opened.length : indent.length)
    return result([{ start, end, insert }], { start: caret, end: caret })
  }
  // Enter on a template's middle line adds a line there, as in the HTML widget.
  if (block?.kind === 'paragraph' && block.range.start === block.range.end && inputType === 'insertParagraph' && start === end) {
    const index = ancestors.indexOf(block)
    const siblings = (index > 0 ? ancestors[index - 1] : projection.ast.root)?.children ?? []
    const position = siblings.indexOf(block)
    if (siblings[position - 1]?.kind === 'html-block' && siblings[position + 1]?.kind === 'html-block') {
      const insert = lineEnding + containerContinuationPrefix(core, revision, projection, block, ancestors.slice(0, index))
      return result([{ start, end, insert }], { start: start + insert.length, end: start + insert.length })
    }
  }
  const cell = ancestors.find(node => node.kind === 'table-cell')
  const table = ancestors.find(node => node.kind === 'table')
  const row = ancestors.find(node => node.kind === 'table-row')
  if (cell !== undefined && table !== undefined && row !== undefined) {
    if (inputType === 'insertLineBreak') {
      const caret = start + 5
      return result([{ start, end, insert: '<br/>' }], { start: caret, end: caret })
    }
    const nextRow = table.children[table.children.indexOf(row) + 1]
    if (nextRow !== undefined) {
      const nextCell = nextRow.children[0]
      if (nextCell === undefined) throw new RangeError('Next table row has no cell')
      const caret = sourceAt(nextCell.children[0]?.range.start ?? nextCell.range.start)
      return result([], { start: caret, end: caret })
    }
    return moveAfter(table)
  }
  const conversion = block?.kind === 'paragraph' && inputType === 'insertParagraph' ? enterConversion(block.range) : undefined
  if (conversion?.kind === 'math' && block !== undefined) {
    const at = projection.coordinates.toSource(block.range.end, 'previous')
    return result([{ start: at, end: at, insert: lineEnding + lineEnding + '$$' }], { start: at + lineEnding.length, end: at + lineEnding.length })
  }
  if (block !== undefined && conversion?.kind === 'table') {
    const columns = conversion.columns
    const headerEnd = projection.coordinates.toSource(block.range.end, 'previous')
    const delimiter = `|${' --- |'.repeat(columns)}`
    const row = `|${' |'.repeat(columns)}`
    const insert = lineEnding + delimiter + lineEnding + row
    const caret = headerEnd + lineEnding.length + delimiter.length + lineEnding.length + 2
    return result([{ start: headerEnd, end: headerEnd, insert }], { start: caret, end: caret })
  }
  const blockIndex = block === undefined ? -1 : ancestors.indexOf(block)
  const blockContainers = ancestors.slice(0, Math.max(0, blockIndex))
  // A line inside quotes and list items continues them; a blank separator line
  // keeps only the quote markers, as upstream spells both.
  // A footnote definition keeps a new paragraph inside it too (#5340).
  const continuation = block !== undefined && blockContainers.some(node => node.kind === 'list-item' || node.kind === 'blockquote' || node.kind === 'footnote-definition')
    ? containerContinuationPrefix(core, revision, projection, block, blockContainers)
    : ''
  const newParagraph = lineEnding + continuation.trimEnd() + lineEnding + continuation
  const finalParagraph = (at: number) => newParagraph + finalLine(at, continuation)
  // Upstream separates every block by a blank line. A block written directly
  // after the broken one stays apart from the new paragraph, which is then
  // editable between blank lines.
  const siblings = blockContainers.at(-1)?.children ?? projection.ast.root.children
  const following = block === undefined ? undefined : siblings[siblings.indexOf(block) + 1]
  const blockEnd = block === undefined ? start : sourceAt(block.range.end)
  const adjacent = following !== undefined &&
    !/(?:\r\n|\r|\n)[ \t>]*(?:\r\n|\r|\n)/u.test(core.sourceSlice(revision, { start: blockEnd, end: sourceAt(following.range.start) }))
  const separated = (edits: DocumentSourceEdit[], caret: number): DocumentSourceInputPlan => {
    if (!adjacent) return result(edits, { start: caret, end: caret })
    const separator = lineEnding + continuation.trimEnd()
    const last = edits.at(-1)
    const all = last !== undefined && last.start === blockEnd && last.end === blockEnd
      ? [...edits.slice(0, -1), { ...last, insert: last.insert + separator }]
      : [...edits, { start: blockEnd, end: blockEnd, insert: separator }]
    return result(all, { start: caret, end: caret })
  }
  if (block?.kind === 'heading' && paragraphBreak) {
    const contentStart = block.children[0]?.range.start ?? block.range.start
    if (projected <= contentStart && start === end) {
      const from = sourceAt(block.range.start)
      return separated([{ start: from, end: from, insert: newParagraph }], start + newParagraph.length)
    }
    if (block.attributes.style === 'setext') {
      const contentEnd = block.children.at(-1)?.range.end
      if (contentEnd === undefined) throw new RangeError('Setext heading content is unavailable')
      const markerStart = sourceAt(contentEnd)
      const markerEnd = sourceAt(block.range.end)
      const marker = core.sourceSlice(revision, { start: markerStart, end: markerEnd })
      const insert = marker + (end === markerStart ? finalParagraph(markerEnd) : newParagraph)
      return separated([{ start, end, insert }, { start: markerStart, end: markerEnd, insert: '' }], start + marker.length + newParagraph.length)
    }
    return separated([{ start, end, insert: finalParagraph(end) }], start + newParagraph.length)
  }
  // A soft break continues the block's containers on its new line, as upstream spells it.
  let insert = inputType === 'insertLineBreak' && !paragraphBreak
    ? lineEnding + (block?.kind === 'paragraph' || block?.kind === 'heading' ? containerContinuationPrefix(core, revision, projection, block, blockContainers) : '')
    : newParagraph
  const list = [...ancestors].reverse().find(node => node.kind === 'list')
  const lineStartOf = (position: number): number => {
    for (let span = 256; ; span *= 4) {
      const from = Math.max(0, position - span)
      const text = core.sourceSlice(revision, { start: from, end: position })
      const found = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'))
      if (found >= 0) return from + found + 1
      if (from === 0) return 0
    }
  }
  const lineEndOf = (position: number): number => {
    for (let span = 256; ; span *= 4) {
      const to = Math.min(revision.sourceLength, position + span)
      const found = core.sourceSlice(revision, { start: position, end: to }).search(/[\r\n]/u)
      if (found >= 0) return position + found
      if (to === revision.sourceLength) return to
    }
  }
  // The marker line of an item split after `item`, continuing its containers.
  // Upstream continues a task item, bullet or ordered, as an unchecked one.
  const siblingMarker = (item: MarkdownAstNode): string => {
    const itemStart = sourceAt(item.range.start)
    const markerLineEnd = lineEndOf(itemStart)
    const firstStart = item.children[0] === undefined ? markerLineEnd : sourceAt(item.children[0].range.start)
    const task = item.attributes.task === true
    let marker = core.sourceSlice(revision, { start: itemStart, end: task ? sourceAt(Number(item.attributes.taskMarkerStart)) : Math.min(firstStart, markerLineEnd) })
    // A marker whose content begins on a later line is written as upstream
    // writes an empty item's: followed by one space.
    if (!task && firstStart > markerLineEnd) marker = marker.trimEnd() + ' '
    if (task) marker += '[ ] '
    if (list?.attributes.ordered === true) marker = marker.replace(/\d+/u, number => String(Number(number) + 1))
    return containerContinuationPrefix(core, revision, projection, item, ancestors.slice(0, ancestors.indexOf(item))) + marker
  }
  if (block?.kind === 'paragraph' && block.range.start === block.range.end && inputType === 'insertParagraph' && start === end &&
    item !== undefined && blockContainers.at(-1) === item && item.children.length > 1) {
    // Upstream splits the item: the empty paragraph and what follows move to
    // a new item, except that an empty first paragraph stays as the item.
    const index = item.children.indexOf(block)
    const moved = item.children[index === 0 ? 1 : index]
    if (moved === undefined) throw new RangeError('List item split has no moved block')
    const marker = siblingMarker(item)
    const movedStart = sourceAt(moved.range.start)
    const lineStart = lineStartOf(movedStart)
    let leaf = moved
    while (!['paragraph', 'heading'].includes(leaf.kind) && !isLiteralBlock(leaf.kind) && leaf.children[0] !== undefined) leaf = leaf.children[0]
    const leafFrom = sourceAt(typeof leaf.attributes.contentStart === 'number' ? leaf.attributes.contentStart : leaf.range.start)
    // A task paragraph's text begins after its checkbox's separating space.
    const leafStart = leafFrom + (leaf.kind === 'paragraph' ? core.sourceSlice(revision, { start: leafFrom, end: Math.min(lineEndOf(leafFrom), leafFrom + 8) }).search(/[^ \t]|$/u) : 0)
    // A task checkbox begins a paragraph, so another block moved into a new
    // task item keeps its own line beneath the new marker line.
    if (moved.kind !== 'paragraph' && marker.endsWith('[ ] ')) {
      const insert = marker + lineEnding
      return result([{ start: lineStart, end: lineStart, insert }], { start: leafStart + insert.length, end: leafStart + insert.length })
    }
    const caret = leafStart + marker.length - (movedStart - lineStart)
    return result([{ start: lineStart, end: movedStart, insert: marker }], { start: caret, end: caret })
  }
  if (block !== undefined && paragraphBreak && item !== undefined && blockContainers.at(-1) === item && item.children.length === 1) {
    const marker = siblingMarker(item)
    const contentStart = sourceAt(block.range.start)
    const lineStart = lineStartOf(contentStart)
    // Content written on the line after its marker is split at its start as
    // upstream writes both items: the new marker replaces that line's indent.
    if (start === end && start === contentStart && lineStart > sourceAt(item.range.start)) {
      return result([{ start: lineStart, end: contentStart, insert: marker }], { start: lineStart + marker.length, end: lineStart + marker.length })
    }
    insert = lineEnding + marker
  }
  const caret = start + insert.length
  if (insert === newParagraph) return separated([{ start, end, insert: finalParagraph(end) }], caret)
  return result([{ start, end, insert }], { start: caret, end: caret })
}

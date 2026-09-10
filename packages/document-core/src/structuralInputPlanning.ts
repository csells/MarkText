import { planParagraphTab } from './listTabPlanning.js'
import { codeTabExpansion, frontMatterPolicy } from '@marktext/input-policy'
import { planListChange } from './listInputPlanning.js'
import { planTaskChecked } from './taskInputPlanning.js'
import { containerContinuationPrefix } from './clipboardMarkdown.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'
import type { MarkdownLineIndex } from './revision.js'
import { normalizeTableDimensions, tableToMarkdownWithPositions, codeEnter, fencedCodeMarkdown, emptyTableColumn, emptyTableRow, toggleTableAlignment, tableDelimiterMarkers } from '@marktext/input-policy'
import type { ParagraphEnterConversion } from './internal/profile1/markdownParser.js'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import type { DocumentInputAction, DocumentSourceInputPlan } from './inputPlanning.js'
import { resolveTableCell } from './tableSelection.js'
import { positionAfter } from './sourcePosition.js'
import { tableRowCompletion } from './tableCellEditing.js'
import { paragraphPrefixPosition, paragraphImageRange } from './paragraphBoundary.js'
import { codeJoinParagraphText, emptyParagraphJoinContainer, paragraphJoinBlock, paragraphJoinAdjacent, paragraphJoinTrailingEdits } from './paragraphJoinPlanning.js'
import { syntaxPathAt } from './syntaxPath.js'

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
export function planStructuralInput(core: DocumentCore, revision: DocumentRevision, action: DocumentInputAction<SourceRange>, enterConversion: (range: SourceRange) => ParagraphEnterConversion | undefined, physicalLines: () => MarkdownLineIndex, selectedCell?: ReturnType<typeof resolveTableCell>): DocumentSourceInputPlan {
  const { start, end } = action.selection
  const inputType = 'inputType' in action ? action.inputType : undefined
  const rawRange = 'range' in action ? action.range : { start, end: start }
  const preceding = core.sourceSlice(revision, { start: 0, end: start })
  const lineEnding = preceding.match(/\r\n|\r|\n/u)?.[0] ?? core.sourceSlice(revision, { start, end: revision.sourceLength }).match(/\r\n|\r|\n/u)?.[0] ?? '\n'
  const projection = core.project(revision, 'markup').syntax
  const projected = projection.coordinates.toProjected(start, 'next')
  const ancestors: MarkdownAstNode[] = []
  const ownsTrailingMarker = (node: MarkdownAstNode): boolean => {
    const emptyContainer = ['list', 'list-item', 'blockquote'].includes(node.kind) &&
      (node.children.length === 0 || node.children.every(child => child.kind === 'list-item' && child.children.length === 0))
    return emptyContainer && projected > node.range.end &&
      /^[ \t]*$/u.test(core.sourceSlice(revision, { start: projection.coordinates.toSource(node.range.end, 'previous'), end: start }))
  }
  if (selectedCell === undefined) ancestors.push(...syntaxPathAt(projection.ast.root, projected, ownsTrailingMarker))
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
    const ending = core.sourceSlice(revision, { start: Math.max(0, revision.sourceLength - lineEnding.length * 2), end: revision.sourceLength })
    const insert = ending.endsWith(lineEnding + lineEnding) ? '' : ending.endsWith(lineEnding) ? lineEnding : lineEnding + lineEnding
    const caret = revision.sourceLength + insert.length
    return result(insert === '' ? [] : [{ start: revision.sourceLength, end: revision.sourceLength, insert }], { start: caret, end: caret })
  }
  const insertionTarget = () => {
    const target = [...ancestors].reverse().find(node => ['paragraph', 'heading', 'code-block', 'math-block', 'diagram', 'html-block', 'front-matter'].includes(node.kind))
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
      case 'joinParagraphBackward':
      case 'joinParagraphForward': {
        const forward = action.command === 'joinParagraphForward'
        const emptyContainer = emptyParagraphJoinContainer
        const paragraphLike = paragraphJoinBlock
        const current = [...ancestors].reverse().find(node => paragraphLike(node) || node.kind === 'heading')
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
        if (current === undefined || start !== end) throw new RangeError('Paragraph join requires a block-boundary caret')
        const boundary = forward && current.attributes.style === 'setext' ? Number(current.attributes.contentEnd) : forward ? contentEnd(current) : emptyContainer(current) ? contentEnd(current) : paragraphImageRange(current)?.start ?? current.range.start
        if (projected !== boundary && !(forward && current.kind === 'definition' && projected === current.range.end)) throw new RangeError('Paragraph join requires a block-boundary caret')
        const adjacent = paragraphJoinAdjacent(projection, current, forward)
        if (adjacent === undefined) return result([], { start, end })
        const previous = forward ? current : adjacent
        const paragraph = forward ? adjacent : current
        if (!forward && previous.kind === 'code-block' && paragraphLike(paragraph)) {
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
          const codeEnd = projection.coordinates.toSource(previous.range.end, 'previous')
          const donor = codeJoinParagraphText(core, revision, projection, lines, previous, paragraph)
          const insert = core.sourceSlice(revision, { start: from, end: target }) +
            donor.text +
            core.sourceSlice(revision, { start: target, end: codeEnd })
          const caret = target + donor.emptyPrefix.length
          return result([{ start: from, end: projection.coordinates.toSource(removedEnd, 'next'), insert }], { start: caret, end: caret })
        }
        if (!paragraphLike(previous) && previous.kind !== 'heading' || !paragraphLike(paragraph)) throw new RangeError('Paragraph join requires an adjacent paragraph or heading')
        const from = sourceAt(contentEnd(previous))
        const to = projection.coordinates.toSource(emptyContainer(paragraph) ? contentEnd(paragraph) : paragraphImageRange(paragraph)?.start ?? paragraph.range.start, 'previous')
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
          const from = sourceAt(literal.attributes.contentStart)
          const to = projection.coordinates.toSource(Number(literal.attributes.contentEnd), 'previous')
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
          !revision.annotations.some(annotation => annotation.range.start < to && annotation.range.end > from)
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
        const code = [...ancestors].reverse().find(node => node.kind === 'code-block')
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
          const text = child.attributes.semanticText
          if (typeof text !== 'string') throw new RangeError('Code reset requires literal payload text')
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
          return result([{ start: at, end: at, insert }], { start: caret, end: caret })
        }
        if (action.change.type === 'reset' || action.change.type === 'toggle' && rule !== undefined) {
          if (rule === undefined) throw new RangeError('Horizontal rule reset requires the selected rule')
          const from = projection.coordinates.toSource(rule.range.start, 'previous')
          const to = projection.coordinates.toSource(rule.range.end, 'next')
          return result([{ start: from, end: to, insert: '' }], { start: from, end: from })
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
        return result([{ start: at, end: replace ? to : at, insert }], { start: caret, end: caret })
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
          const exterior = first === last && first.kind === 'paragraph' ? paragraphStarts.get(first.range.start) : undefined
          if (exterior !== undefined && exterior < sourceAt(first.range.start)) {
            // This entire annotated paragraph already owns its continuation.
            // Quote its exterior without rewriting newlines inside that owner.
            return finish([{ start: exterior, end: exterior, insert: '> ' }], { start, end })
          }
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
        for (const event of from < paragraphStart ? [] : core.project(revision, 'markup').events) {
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
        const payloadEnd = projection.coordinates.toSource(contentEnd, 'previous')
        const marker = level === 0 ? '' : '#'.repeat(level) + ' '
        if (change.type === 'quick-insert') {
          if (block.kind !== 'paragraph') throw new RangeError('Quick insertion requires a paragraph')
          return result([{ start: from, end: to, insert: marker }], { start: from + marker.length, end: from + marker.length })
        }
        const edits: DocumentSourceEdit[] = [{ start: from, end: payloadStart, insert: marker }]
        if (payloadEnd < to) edits.push({ start: payloadEnd, end: to, insert: '' })
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
              start: at + newRow.firstCellEnd, end: at + newRow.firstCellEnd
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
            start: at + newRow.firstCellEnd, end: at + newRow.firstCellEnd
          })
        }
        if (action.placement !== 'after') throw new RangeError('Invalid table row placement')
        const projectedEnd = row === header ? Number(table.attributes.delimiterEnd) : row.range.end
        const at = projection.coordinates.toSource(projectedEnd, 'previous')
        const caret = at + lineEnding.length + continuation.length + newRow.firstCellEnd
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
    return result([{ start: from, end: start + trailingSpace, insert: '' }], { start: from, end: from })
  }
  const fence = ancestors.find(node => node.kind === 'code-block' || node.kind === 'diagram')
  if (fence !== undefined && inputType === 'insertLineBreak') return moveAfter(fence)
  if (fence !== undefined && inputType === 'insertParagraph' && fence.attributes.content === '' &&
      typeof fence.attributes.contentStart === 'number' && fence.range.end <= fence.attributes.contentStart &&
      typeof fence.attributes.infoStart === 'number') {
    const marker = core.sourceSlice(revision, { start: sourceAt(fence.range.start), end: sourceAt(fence.attributes.infoStart) })
    const insert = lineEnding + lineEnding + marker
    return result([{ start, end, insert }], { start: start + lineEnding.length, end: start + lineEnding.length })
  }
  if (fence !== undefined && typeof fence.attributes.contentStart === 'number' && inputType === 'insertParagraph') {
    const from = sourceAt(fence.attributes.contentStart)
    const to = projection.coordinates.toSource(Number(fence.attributes.contentEnd), 'previous')
    const body = core.sourceSlice(revision, { start: from, end: to })
    const policy = codeEnter(body, start - from, action.options.tabSize ?? 4, lineEnding)
    const caret = start + policy.caret
    return result([{ start, end, insert: policy.insert }], { start: caret, end: caret })
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
  if (block?.kind === 'heading' && inputType === 'insertParagraph') {
    const contentStart = block.children[0]?.range.start ?? block.range.start
    if (projected <= contentStart && start === end) {
      const from = sourceAt(block.range.start)
      return result([{ start: from, end: from, insert: lineEnding + lineEnding }], { start: start + lineEnding.length * 2, end: start + lineEnding.length * 2 })
    }
    if (block.attributes.style === 'setext') {
      const contentEnd = block.children.at(-1)?.range.end
      if (contentEnd === undefined) throw new RangeError('Setext heading content is unavailable')
      const markerStart = sourceAt(contentEnd)
      const markerEnd = sourceAt(block.range.end)
      const marker = core.sourceSlice(revision, { start: markerStart, end: markerEnd })
      const insert = marker + lineEnding + lineEnding
      return result([{ start, end, insert }, { start: markerStart, end: markerEnd, insert: '' }], { start: start + insert.length, end: start + insert.length })
    }
  }
  let insert = inputType === 'insertLineBreak' ? lineEnding : lineEnding + lineEnding
  if (block !== undefined && inputType === 'insertParagraph') {
    if (item !== undefined && item.children.length === 1) {
      const itemStart = projection.coordinates.toSource(item.range.start, 'next')
      const beforeItem = core.sourceSlice(revision, { start: 0, end: itemStart })
      const prefixStart = Math.max(beforeItem.lastIndexOf('\n'), beforeItem.lastIndexOf('\r')) + 1
      const contentStart = projection.coordinates.toSource(block.range.start, 'next')
      let prefix = core.sourceSlice(revision, { start: prefixStart, end: contentStart })
      if (item.attributes.task === true) prefix = prefix.slice(0, sourceAt(Number(item.attributes.taskMarkerStart)) - prefixStart) + '[ ] '
      const list = [...ancestors].reverse().find(node => node.kind === 'list')
      if (list?.attributes.ordered === true) prefix = prefix.replace(/\d+/u, number => String(Number(number) + 1))
      insert = lineEnding + prefix
    } else if (quote !== undefined) {
      const quoteStart = projection.coordinates.toSource(quote.range.start, 'next')
      let first = quote.children[0]
      while (first !== undefined && first.kind !== 'paragraph' && first.kind !== 'heading' && first.children.length > 0) first = first.children[0]
      const contentStart = projection.coordinates.toSource(first?.range.start ?? block.range.start, 'next')
      const prefix = core.sourceSlice(revision, { start: quoteStart, end: contentStart })
      insert = lineEnding + prefix + lineEnding + prefix
    }
  }
  const caret = start + insert.length
  return result([{ start, end, insert }], { start: caret, end: caret })
}

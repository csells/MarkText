import { resolveModelTextSelection, rebaseModelTextPoint } from './modelText.js'
import type { DocumentInputSelection, DocumentInputTarget } from './inputPlanning.js'
import { copyDocumentSelection, type DocumentModelTextSelection, type DocumentTextSelection } from './sourceInputPlanning.js'
import { positionAfter } from './sourcePosition.js'
import { formatDelimiters } from '@marktext/input-policy'
import type { CriticMarkupAnnotation, DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import { inlineHtmlFormatPairs } from './documentFormatContext.js'
import { createTrackedSourceEdit } from './trackedAuthoring.js'
import { planImageProperties, type DocumentImagePropertiesAction } from './imagePropertyPlanning.js'

export type DocumentFormatAction = DocumentImagePropertiesAction | {
  readonly format: 'strong' | 'em' | 'del' | 'inline_code' | 'inline_math' | 'u' | 'mark' | 'sub' | 'sup' | 'link' | 'image' | 'unlink' | 'clear'
  readonly selection: DocumentTextSelection | DocumentModelTextSelection
  readonly tracked: boolean
}

export interface DocumentFormatPlan {
  readonly edits: readonly DocumentSourceEdit[]
  readonly selection: DocumentInputSelection
}

const formats = { strong: 'strong', em: 'emphasis', del: 'strikethrough', inline_code: 'inline-code', inline_math: 'inline-math', u: 'inline-html', mark: 'inline-html', sub: 'subscript', sup: 'superscript', link: 'link', image: 'image', unlink: 'link' } as const
const clearKinds = new Set(['strong', 'emphasis', 'strikethrough', 'inline-code', 'inline-math', 'link', 'image', 'subscript', 'superscript'])
const htmlFormats = new Set(['u', 'mark', 'sub', 'sup'])
const contentKinds = new Set(['paragraph', 'heading', 'table-cell'])
const literalKinds = new Set(['code-block', 'math-block', 'diagram', 'html-block', 'front-matter'])

function allAnnotations(roots: readonly CriticMarkupAnnotation[]): CriticMarkupAnnotation[] {
  const result: CriticMarkupAnnotation[] = []
  const pending = [...roots]
  while (pending.length > 0) {
    const annotation = pending.pop()
    if (annotation === undefined) break
    result.push(annotation)
    for (const arm of annotation.arms) pending.push(...arm.annotations)
  }
  return result
}

function canonicalSelection(target: DocumentInputTarget, backward = false): DocumentInputSelection {
  return 'start' in target
    ? copyDocumentSelection({ ranges: [{ anchor: backward ? target.end : target.start, focus: backward ? target.start : target.end }], primary: 0 }, Number.MAX_SAFE_INTEGER)
    : copyDocumentSelection(target, Number.MAX_SAFE_INTEGER)
}

/** Plans one formatting action from the current syntax tree, never native text diffs. */
export function planFormat(
  core: DocumentCore,
  previous: DocumentRevision,
  action: DocumentFormatAction,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision,
  previewSyntax: (edits: readonly DocumentSourceEdit[]) => MarkupSyntax
): DocumentFormatPlan {
  if (action.format === 'image-properties') {
    const plan = planImageProperties(core, previous, action, preview, previewSyntax)
    return Object.freeze({ edits: plan.edits, selection: plan.selection })
  }
  if (action.selection.kind === 'model-text') {
    const resolved = resolveModelTextSelection(core, previous, action.selection)
    const primary = { anchor: resolved.backward ? resolved.bounds.end : resolved.bounds.start, focus: resolved.backward ? resolved.bounds.start : resolved.bounds.end }
    const planned = planFormat(core, previous, { ...action, selection: { ranges: [primary], primary: 0 } }, preview, previewSyntax)
    if (planned.edits.length === 0) return { edits: [], selection: resolved.selection }
    const selection = { kind: 'model-text' as const, anchor: rebaseModelTextPoint(resolved.selection.anchor, planned.edits), focus: rebaseModelTextPoint(resolved.selection.focus, planned.edits) }
    return { edits: planned.edits, selection }
  }
  const { format } = action
  const actualSelection = copyDocumentSelection(action.selection, previous.sourceLength)
  if (actualSelection.ranges.length !== 1) throw new RangeError('Native formatting requires exactly one selection')
  const primary = actualSelection.ranges[actualSelection.primary]
  if (primary === undefined) throw new RangeError('Formatting selection has no primary range')
  const backward = primary.anchor > primary.focus
  const selection = { start: Math.min(primary.anchor, primary.focus), end: Math.max(primary.anchor, primary.focus) }
  const result = (edits: readonly DocumentSourceEdit[], target: SourceRange): DocumentFormatPlan => Object.freeze({
    edits: Object.freeze(edits.map(edit => Object.freeze(edit))),
    selection: canonicalSelection(target, backward)
  })
  if ((format !== 'clear' && !Object.hasOwn(formats, format)) || !Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end) ||
      selection.start < 0 || selection.end < selection.start || selection.end > previous.sourceLength) {
    throw new RangeError('Formatting selection is outside the current document')
  }
  // Browser element edges can include an annotation opener/closer while the
  // selected visible text lies wholly inside its payload. Formatting owns the
  // payload, not a delimiter that only happened to share that DOM boundary.
  for (const annotation of allAnnotations(previous.annotations)) {
    if (annotation.kind === 'comment') continue
    for (const arm of annotation.arms) {
      if (selection.start >= annotation.range.start && selection.start < arm.range.start &&
          selection.end > arm.range.start && selection.end <= arm.range.end) selection.start = arm.range.start
      if (selection.end <= annotation.range.end && selection.end > arm.range.end &&
          selection.start >= arm.range.start && selection.start < arm.range.end) selection.end = arm.range.end
    }
  }
  const { syntax } = core.project(previous, 'markup')
  const { coordinates } = syntax
  const start = coordinates.toProjected(selection.start, 'next')
  const end = coordinates.toProjected(selection.end, 'previous')
  const collapsed = selection.start === selection.end
  const blocks: MarkdownAstNode[] = []
  const toggles: MarkdownAstNode[] = []
  const htmlDelimiters: SourceRange[] = []
  const intersects = (range: SourceRange): boolean => collapsed
    ? range.start < start && start < range.end
    : range.start < end && start < range.end
  const visit = (node: MarkdownAstNode): void => {
    if (node.range.end < start || node.range.start > end || literalKinds.has(node.kind)) return
    if (contentKinds.has(node.kind)) blocks.push(node)
    if ((format === 'clear' ? clearKinds.has(node.kind) : node.kind !== 'inline-html' && node.kind === formats[format]) && intersects(node.range)) toggles.push(node)
    if (format === 'clear' || htmlFormats.has(format)) {
      for (const { open, close } of inlineHtmlFormatPairs(node)) {
        if ((format === 'clear' || open.attributes.tagName === format) && intersects({ start: open.range.start, end: close.range.end })) htmlDelimiters.push(open.range, close.range)
      }
    }
    for (const child of node.children) visit(child)
  }
  visit(syntax.ast.root)
  const edits: DocumentSourceEdit[] = []
  let selectedPayload: SourceRange | undefined
  let emptyCaret: number | undefined
  let destinationEnd: number | undefined
  const eraseProjected = (from: number, to: number): void => {
    for (const segment of coordinates.sourceSegments ?? []) {
      const left = Math.max(from, segment.projected.start)
      const right = Math.min(to, segment.projected.end)
      if (right <= left) continue
      if (segment.projected.end - segment.projected.start !== segment.source.end - segment.source.start) {
        throw new RangeError('Formatting delimiter has no exact source range')
      }
      edits.push({ start: segment.source.start + left - segment.projected.start, end: segment.source.start + right - segment.projected.start, insert: '' })
    }
  }
  for (const range of htmlDelimiters) eraseProjected(range.start, range.end)
  if (toggles.length > 0) {
    for (const node of toggles) {
      let contentStart = typeof node.attributes.labelStart === 'number'
        ? node.attributes.labelStart
        : typeof node.attributes.contentStart === 'number' ? node.attributes.contentStart : node.children[0]?.range.start
      let contentEnd = typeof node.attributes.labelEnd === 'number'
        ? node.attributes.labelEnd
        : typeof node.attributes.contentEnd === 'number' ? node.attributes.contentEnd : node.children.at(-1)?.range.end
      if (contentStart === undefined || contentEnd === undefined) throw new Error('Formatting node has no owned delimiter ranges')
      if (node.kind === 'inline-code') {
        const payload = core.sourceSlice(previous, { start: coordinates.toSource(contentStart, 'next'), end: coordinates.toSource(contentEnd, 'previous') })
        if (payload.startsWith(' ') && payload.endsWith(' ') && payload.trim() !== '') {
          contentStart += 1
          contentEnd -= 1
        }
      }
      if (format === 'unlink') selectedPayload = { start: coordinates.toSource(contentStart, 'next'), end: coordinates.toSource(contentEnd, 'previous') }
      eraseProjected(node.range.start, contentStart)
      eraseProjected(contentEnd, node.range.end)
    }
  } else if (format !== 'clear' && format !== 'unlink' && htmlDelimiters.length === 0) {
    for (const block of blocks) {
      const contentStart = block.children[0]?.range.start ?? block.range.start
      const contentEnd = block.children.at(-1)?.range.end ?? block.range.end
      const from = Math.max(start, contentStart)
      const to = Math.min(end, contentEnd)
      if (to < from || (!collapsed && to === from)) continue
      let first = from === start ? selection.start : coordinates.toSource(from, 'next')
      let last = to === end ? selection.end : coordinates.toSource(to, 'previous')
      const selected = core.sourceSlice(previous, { start: first, end: last })
      if (selected.trim().length > 0) {
        first += selected.length - selected.trimStart().length
        last -= selected.length - selected.trimEnd().length
      }
      selectedPayload = selectedPayload === undefined
        ? { start: first, end: last }
        : { start: Math.min(selectedPayload.start, first), end: Math.max(selectedPayload.end, last) }
      const ranges: SourceRange[] = []
      if ((format === 'inline_code' || format === 'inline_math') && !collapsed) {
        // A literal inline span cannot enclose active annotations. Each parser-retained
        // source segment is formatted inside its own annotation arm.
        for (const segment of coordinates.sourceSegments ?? []) {
          const left = Math.max(first, segment.source.start)
          const right = Math.min(last, segment.source.end)
          if (left < right) {
            const prior = ranges.at(-1)
            if (prior?.end === left) ranges[ranges.length - 1] = { start: prior.start, end: right }
            else ranges.push({ start: left, end: right })
          }
        }
      } else ranges.push({ start: first, end: last })
      for (const range of ranges) {
        if (format === 'link' || format === 'image') destinationEnd = range.end
        const spelling = formatDelimiters(format)
        if (spelling === undefined) throw new RangeError('Unknown formatting action')
        let marker = spelling.open
        let closer = spelling.close
        let pad = ''
        if (format === 'inline_code') {
          const payload = core.sourceSlice(previous, range)
          const runs = payload.match(/`+/g) ?? []
          marker = '`'.repeat(Math.max(0, ...runs.map(run => run.length)) + 1)
          closer = marker
          if (payload.startsWith('`') || payload.endsWith('`') ||
              (payload.startsWith(' ') && payload.endsWith(' ') && payload.trim() !== '')) pad = ' '
        }
        if (range.start === range.end) {
          edits.push({ ...range, insert: marker + closer })
          emptyCaret = range.start + marker.length
        } else {
          edits.push({ start: range.start, end: range.start, insert: marker + pad })
          edits.push({ start: range.end, end: range.end, insert: pad + closer })
        }
      }
    }
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end)
  const unique = edits.filter((edit, index) => {
    const prior = edits[index - 1]
    return prior === undefined || edit.start !== prior.start || edit.end !== prior.end || edit.insert !== prior.insert
  })
  if (unique.some((edit, index) => {
    const prior = unique[index - 1]
    return prior !== undefined && edit.start < prior.end
  })) {
    throw new Error('Formatting edits overlap')
  }
  let nextSelection = {
    start: positionAfter(unique, selectedPayload?.start ?? selection.start, true),
    end: positionAfter(unique, selectedPayload?.end ?? selection.end, false)
  }
  const firstEdit = unique[0]
  const lastEdit = unique.at(-1)
  if (emptyCaret !== undefined) nextSelection = { start: emptyCaret, end: emptyCaret }
  if (destinationEnd !== undefined) {
    // Images use an atomic native widget and its existing destination picker.
    // Leave the document caret after the widget, never in its hidden raw text.
    const suffix = format === 'image' ? 3 : 2
    const caret = emptyCaret === undefined ? positionAfter(unique, destinationEnd, false) + suffix : emptyCaret + suffix
    nextSelection = { start: caret, end: caret }
  }
  if (format === 'unlink') nextSelection = { start: nextSelection.end, end: nextSelection.end }
  if (nextSelection.end < nextSelection.start) nextSelection.end = nextSelection.start
  if (firstEdit === undefined || lastEdit === undefined) return Object.freeze({ edits: Object.freeze([]), selection: actualSelection })
  const candidate = preview(unique)
  const retained = allAnnotations(previous.annotations)
  const actual = allAnnotations(candidate.annotations)
  const annotationKey = (kind: string, start: number, end: number) => `${kind}:${start}:${end}`
  const actualRanges = new Set(actual.map(annotation => annotationKey(annotation.kind, annotation.range.start, annotation.range.end)))
  if (retained.length !== actual.length || retained.some(annotation => !actualRanges.has(annotationKey(
    annotation.kind, positionAfter(unique, annotation.range.start, true), positionAfter(unique, annotation.range.end, false))))) {
    throw new RangeError('Formatting would change annotation ownership')
  }
  if (!action.tracked) return result(unique, nextSelection)
  const envelope = { start: firstEdit.start, end: lastEdit.end }
  let formatted = core.sourceSlice(previous, envelope)
  for (const edit of [...unique].reverse()) {
    formatted = formatted.slice(0, edit.start - envelope.start) + edit.insert + formatted.slice(edit.end - envelope.start)
  }
  const proposedArm = allAnnotations(previous.annotations).flatMap(annotation => annotation.arms.filter(arm =>
    (annotation.kind === 'addition' && arm.name === 'content') || (annotation.kind === 'substitution' && arm.name === 'new')
  )).some(arm => arm.range.start <= envelope.start && arm.range.end >= envelope.end)
  if (proposedArm) return result(unique, nextSelection)
  const tracked = createTrackedSourceEdit(core, previous, { ...envelope, insert: formatted }, preview, true)
  if (tracked === undefined) throw new RangeError('Formatting cannot preserve this tracked syntax range')
  if (tracked.start === envelope.start && tracked.end === envelope.end && tracked.insert === formatted) {
    return result([tracked], nextSelection)
  }
  const trackedCandidate = preview([tracked])
  const newArm = allAnnotations(trackedCandidate.annotations).flatMap(annotation => annotation.arms).find(arm =>
    arm.name === 'new' && arm.range.start >= tracked.start && arm.range.end <= tracked.start + tracked.insert.length &&
    trackedCandidate.source.slice(arm.range.start, arm.range.end) === formatted)
  if (newArm === undefined) throw new RangeError('Tracked formatting has no proven resulting selection')
  const delta = newArm.range.start - envelope.start
  return result([tracked], { start: nextSelection.start + delta, end: nextSelection.end + delta })
}

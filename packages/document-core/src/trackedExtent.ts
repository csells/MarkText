import type {
  CriticMarkupAnnotation, DocumentCore, DocumentRevision, DocumentSourceEdit,
  MarkdownAstNode, SourceRange
} from './documentCore.js'
import { markupAnnotations } from './markupEditOwnership.js'
import { positionAfter } from './sourcePosition.js'

type Preview = (edits: readonly DocumentSourceEdit[]) => DocumentRevision

/** Accept/Reject facts of an authoring candidate, read from its single parse. */
export interface TrackedProjectionFacts {
  readonly original: string
  readonly revised: string
  /** Revised view identity of the candidate itself, read from the same parse. */
  readonly revisedView: () => string
}

/** The document core registers the projection facts of each authoring preview. */
export const trackedPreviewFacts = new WeakMap<DocumentRevision, TrackedProjectionFacts>()

/** Revised view identity of Markdown text such as a projection: its tree without spelling or offsets. */
export const trackedMarkdownSignatures = new WeakMap<DocumentCore, (markdown: string) => string>()

export function projectionSignature(root: MarkdownAstNode): string {
  const parts: string[] = []
  const visit = (node: MarkdownAstNode): void => {
    const attributes = Object.entries(node.attributes)
      .filter(([name, value]) => !(typeof value === 'number' && /(?:Start|End)$/u.test(name)))
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    parts.push(`(${node.kind}${JSON.stringify(attributes)}`)
    for (const child of node.children) visit(child)
    parts.push(')')
  }
  visit(root)
  return parts.join('')
}

export type TrackedEquivalence = 'exact' | 'rendering'

const deferredCores = new WeakSet<DocumentCore>()

/**
 * One step of a multi-edit operation is not independently equivalent to its
 * untracked result; the caller validates the complete operation instead.
 */
export function withDeferredEquivalence<T>(core: DocumentCore, compile: () => T): T {
  if (deferredCores.has(core)) return compile()
  deferredCores.add(core)
  try {
    return compile()
  } finally {
    deferredCores.delete(core)
  }
}

export const equivalenceDeferred = (core: DocumentCore): boolean => deferredCores.has(core)

export function deferEquivalence(core: DocumentCore): void {
  deferredCores.add(core)
}

/** Whether a complete tracked operation reproduces its untracked result. */
export function trackedOperationEquivalent(
  core: DocumentCore,
  previous: DocumentRevision,
  untracked: readonly DocumentSourceEdit[] | undefined,
  tracked: readonly DocumentSourceEdit[],
  preview: Preview
): boolean {
  if (untracked === undefined) return true
  const oracle = createTrackedOracle(core, previous, untracked, memoizedPreview(preview))
  return oracle === undefined || oracle.accepts(tracked, 'exact') || oracle.accepts(tracked, 'rendering')
}

/**
 * Tracked authoring is correct when accepting everything yields the untracked
 * result and rejecting everything yields the previous Original projection.
 */
export interface TrackedOracle {
  /** Untracked compilation of the same operation, in previous source coordinates. */
  readonly untracked: readonly DocumentSourceEdit[]
  readonly untrackedSource: string
  /** An operation on hidden history alone has nothing to suggest. */
  readonly revisesVisibleText: boolean
  readonly accepts: (edits: readonly DocumentSourceEdit[], equivalence: TrackedEquivalence) => boolean
  readonly preview: Preview
}

/** One authoring operation previews each distinct candidate once. */
export function memoizedPreview(preview: Preview): Preview {
  const cache = new Map<string, DocumentRevision>()
  return edits => {
    const key = JSON.stringify(edits.map(edit => [edit.start, edit.end, edit.insert]))
    let result = cache.get(key)
    if (result === undefined) {
      result = preview(edits)
      cache.set(key, result)
    }
    return result
  }
}

export function createTrackedOracle(
  core: DocumentCore,
  previous: DocumentRevision,
  untracked: readonly DocumentSourceEdit[],
  preview: Preview,
  revisedTarget: readonly DocumentSourceEdit[] = untracked
): TrackedOracle | undefined {
  const cachedPreview = preview
  const target = cachedPreview(untracked)
  const targetFacts = trackedPreviewFacts.get(revisedTarget === untracked ? target : cachedPreview(revisedTarget))
  if (targetFacts === undefined) return undefined
  const original = core.project(previous, 'original').markdown
  const parse = trackedMarkdownSignatures.get(core)
  const signatures = new Map<string, string>()
  const signature = (markdown: string): string | undefined => {
    if (parse === undefined) return undefined
    let result = signatures.get(markdown)
    if (result === undefined) {
      result = parse(markdown)
      signatures.set(markdown, result)
    }
    return result
  }
  const previousSource = core.sourceSlice(previous, { start: 0, end: previous.sourceLength })
  const targetView = trackedPreviewFacts.get(target)?.revisedView()
  const accepts = (edits: readonly DocumentSourceEdit[], equivalence: TrackedEquivalence): boolean => {
    const candidate = cachedPreview(edits)
    const facts = trackedPreviewFacts.get(candidate)
    if (facts === undefined) return false
    const authored = authoredAnnotations(edits, candidate)
    if (!partiallyResolvable(edits, candidate, authored, cachedPreview)) return false
    // Resolution splices arm bytes, while a projection may also materialize the
    // closing fence of a literal an arm boundary ended (L2c). That projection
    // must still read as the untracked result.
    if (equivalence === 'exact' && (facts.revised !== targetFacts.revised || facts.original !== original) &&
        !(authored.length > 0 && resolveAuthored(candidate.source, authored, 'accept') === target.source &&
          resolveAuthored(candidate.source, authored, 'reject') === previousSource &&
          signature(facts.revised) === targetView && signature(facts.original) === signature(original))) return false
    // Equal materialized text can still mean something else inside an arm
    // (an arm-local literal or definition): the Revised view must agree too.
    if (facts.revisedView() !== targetView) return false
    return equivalence === 'exact' || signature(facts.original) === signature(original)
  }
  return Object.freeze({
    untracked,
    untrackedSource: target.source,
    revisesVisibleText: targetFacts.revised !== core.project(previous, 'revised').markdown,
    accepts,
    preview: cachedPreview
  })
}

interface AuthoredAnnotation {
  readonly annotation: CriticMarkupAnnotation
  readonly edit: number
  /** Annotation start within that edit's insert. */
  readonly offset: number
}

/** Top-level annotations of a candidate that lie wholly inside the text its edits insert. */
function authoredAnnotations(edits: readonly DocumentSourceEdit[], candidate: DocumentRevision): AuthoredAnnotation[] {
  const result: AuthoredAnnotation[] = []
  let delta = 0
  edits.forEach((edit, index) => {
    const start = edit.start + delta
    const end = start + edit.insert.length
    for (const annotation of candidate.annotations) {
      if (start <= annotation.range.start && annotation.range.end <= end) {
        result.push({ annotation, edit: index, offset: annotation.range.start - start })
      }
    }
    delta += edit.insert.length - (edit.end - edit.start)
  })
  return result
}

const resolvedArm = (annotation: CriticMarkupAnnotation, decision: 'accept' | 'reject'): CriticMarkupAnnotation['arms'][number]['name'] | undefined => {
  switch (annotation.kind) {
    case 'addition': return decision === 'accept' ? 'content' : undefined
    case 'deletion': return decision === 'accept' ? undefined : 'content'
    case 'substitution': return decision === 'accept' ? 'new' : 'old'
    case 'highlight': return 'content'
    case 'comment': return undefined
  }
}

function resolvedText(source: string, annotation: CriticMarkupAnnotation, decision: 'accept' | 'reject'): string {
  const name = resolvedArm(annotation, decision)
  const range = name === undefined ? undefined : annotation.arms.find(arm => arm.name === name)?.range
  return range === undefined ? '' : source.slice(range.start, range.end)
}

/** The source after resolving the authored annotations as review resolution does. */
function resolveAuthored(source: string, authored: readonly AuthoredAnnotation[], decision: 'accept' | 'reject'): string {
  let result = source
  for (const { annotation } of [...authored].sort((left, right) => right.annotation.range.start - left.annotation.range.start)) {
    result = result.slice(0, annotation.range.start) + resolvedText(source, annotation, decision) + result.slice(annotation.range.end)
  }
  return result
}

/**
 * Suggestions one edit authors together (a Deletion beside an Addition) are
 * reviewed one at a time: resolving either must leave the other formed.
 * Separate edits of one operation, such as a list marker and its continuation
 * indentation, stay coupled and are not checked pairwise.
 */
function partiallyResolvable(
  edits: readonly DocumentSourceEdit[],
  candidate: DocumentRevision,
  authored: readonly AuthoredAnnotation[],
  preview: Preview
): boolean {
  const shared = authored.filter(item => authored.some(other => other !== item && other.edit === item.edit))
  return shared.every(({ annotation, edit, offset }) => (['accept', 'reject'] as const).every(decision => {
    const owner = edits[edit]!
    const length = annotation.range.end - annotation.range.start
    const insert = owner.insert.slice(0, offset) + resolvedText(candidate.source, annotation, decision) + owner.insert.slice(offset + length)
    const partial = preview(edits.map((item, index) => index === edit ? Object.freeze({ ...item, insert }) : item))
    const kept = annotation.arms.find(arm => arm.name === resolvedArm(annotation, decision))
    return partial.annotations.length === candidate.annotations.length - 1 + (kept?.annotations.length ?? 0)
  }))
}

const EOL = /\r\n|\r|\n/u

const LITERAL_KINDS = new Set(['inline-code', 'code-block', 'inline-math', 'math-block', 'inline-html', 'html-block', 'front-matter', 'diagram', 'autolink'])

function lineStart(source: string, offset: number): number {
  let start = offset
  while (start > 0 && source[start - 1] !== '\n' && source[start - 1] !== '\r') start -= 1
  return start
}

function lineEnd(source: string, offset: number): number {
  let end = offset
  while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end += 1
  if (source.startsWith('\r\n', end)) return end + 2
  return end < source.length ? end + 1 : end
}

/** A retained span may enclose annotations whole or stay inside one arm. */
function annotationSafe(annotations: readonly CriticMarkupAnnotation[], span: SourceRange): SourceRange {
  let { start, end } = span
  for (let changed = true; changed;) {
    changed = false
    for (const annotation of annotations) {
      const { start: from, end: to } = annotation.range
      if (end <= from || start >= to || (start <= from && to <= end)) continue
      if (annotation.arms.some(arm => arm.range.start <= start && end <= arm.range.end)) continue
      start = Math.min(start, from)
      end = Math.max(end, to)
      changed = true
    }
  }
  return { start, end }
}

/** History arms cannot be widened into: their bytes are the retained Original. */
function insideHistory(annotations: readonly CriticMarkupAnnotation[], span: SourceRange): boolean {
  return annotations.some(annotation => annotation.arms.some(arm =>
    (annotation.kind === 'deletion' || arm.name === 'old' || arm.name === 'comment') &&
    arm.range.start <= span.start && span.end <= arm.range.end))
}

function trailingBackslashes(value: string): number {
  let count = 0
  while (count < value.length && value[value.length - 1 - count] === '\\') count += 1
  return count
}

type Variant = 'exact' | 'pair' | 'reversed' | 'padded' | 'shifted' | 'escaped'

/**
 * Widen an operation whose inline suggestion changes meaning into a
 * Substitution over the smallest retained span whose parse changes. Its old
 * arm is the retained source and its new arm the untracked result, so
 * Accept/Reject reproduce those exact bytes by construction.
 */
export function widenedTrackedSourceEdit(
  core: DocumentCore,
  previous: DocumentRevision,
  oracle: TrackedOracle
): DocumentSourceEdit | undefined {
  const untracked = oracle.untracked
  if (untracked.length === 0 || !oracle.revisesVisibleText) return undefined
  const source = core.sourceSlice(previous, { start: 0, end: previous.sourceLength })
  const target = oracle.untrackedSource
  const annotations = markupAnnotations(previous.annotations)
  const base = { start: untracked[0]!.start, end: untracked.at(-1)!.end }
  if (insideHistory(annotations, base)) return undefined
  const toTarget = (span: SourceRange): SourceRange => ({
    start: positionAfter(untracked, span.start, false),
    end: positionAfter(untracked, span.end, true)
  })
  const lineAligned = (span: SourceRange): SourceRange => ({
    start: lineStart(source, span.start),
    end: span.end > span.start && (source[span.end - 1] === '\n' || source[span.end - 1] === '\r') ? span.end : lineEnd(source, span.end)
  })
  const spans: SourceRange[] = [base]
  const syntax = core.project(previous, 'markup').syntax
  const nodes: SourceRange[] = []
  // A literal is retained or replaced whole; its markers are never split
  // between a suggestion arm and surrounding source.
  const literals: SourceRange[] = []
  const visit = (node: MarkdownAstNode): void => {
    const start = syntax.coordinates.toSource(node.range.start, 'next')
    const end = syntax.coordinates.toSource(node.range.end, 'previous')
    if (LITERAL_KINDS.has(node.kind)) literals.push({ start, end })
    if (start <= base.start && end >= base.end) nodes.push({ start, end })
    for (const child of node.children) visit(child)
  }
  visit(syntax.ast.root)
  const cuts = (start: number, end: number): boolean => literals.some(literal =>
    (literal.start < start && start < literal.end) || (literal.start < end && end < literal.end))
  nodes.reverse()
  spans.push(...nodes)
  spans.push(lineAligned(base))
  for (const node of nodes) spans.push(lineAligned(node))
  // A block literal can absorb the blocks after it; retain those as well.
  let following = lineAligned(base)
  for (let index = 0; index < 4 && following.end < source.length; index += 1) {
    let end = following.end
    while (end < source.length && lineEnd(source, end) - end > 0 && source.slice(end, lineEnd(source, end)).trim().length > 0) {
      end = lineEnd(source, end)
    }
    while (end < source.length && source.slice(end, lineEnd(source, end)).trim().length === 0) end = lineEnd(source, end)
    if (end === following.end) end = lineEnd(source, end)
    following = { start: following.start, end }
    spans.push(following)
  }
  spans.push({ start: lineAligned(base).start, end: source.length }, { start: 0, end: source.length })
  const seen = new Set<string>()
  const candidates: SourceRange[] = []
  for (const span of spans) {
    const safe = annotationSafe(annotations, span)
    if (insideHistory(annotations, safe)) continue
    const key = `${safe.start}:${safe.end}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(safe)
  }
  candidates.sort((left, right) => (left.end - left.start) - (right.end - right.start) || left.start - right.start)

  const spell = (old: string, next: string, variant: Variant, atLineEnd: boolean): string | undefined => {
    if (variant === 'escaped') {
      const oldEscape = trailingBackslashes(old) % 2 === 1 ? '\\' : ''
      const nextEscape = trailingBackslashes(next) % 2 === 1 ? '\\' : ''
      if (oldEscape === '' && nextEscape === '') return undefined
      old += oldEscape
      next += nextEscape
    }
    if (variant === 'padded' || variant === 'shifted') {
      // Block literals complete before the closer and divider when those
      // delimiters start their own lines.
      const eol = (next.match(EOL) ?? old.match(EOL) ?? source.match(EOL))?.[0] ?? '\n'
      const pad = (value: string): string => value.length === 0 || EOL.test(value.at(-1)!) ? value : value + eol
      if (variant === 'shifted') {
        // Last resort: the opener also starts a line, retaining the typed
        // line break before it.
        if (old.length > 0 || !atLineEnd || !next.startsWith(eol)) return undefined
        const body = pad(next.slice(eol.length))
        return body.length === 0 ? undefined : `${eol}{++${body}++}`
      }
      const paddedOld = pad(old)
      const paddedNext = pad(next)
      if (paddedOld === old && paddedNext === next) return undefined
      old = paddedOld
      next = paddedNext
    }
    if (variant === 'pair' || variant === 'reversed') {
      // A literal opener in one arm could pair across the divider; separate
      // annotations give each side its own closer, in either order.
      if (old.length === 0 || next.length === 0) return undefined
      return variant === 'pair' ? `{--${old}--}{++${next}++}` : `{++${next}++}{--${old}--}`
    }
    if (old.length === 0) return `{++${next}++}`
    // A retained `--}` would close a Deletion; a Substitution with an empty
    // new arm deletes it exactly.
    if (next.length === 0) return old.includes('--}') ? `{~~${old}~>~~}` : `{--${old}--}`
    return `{~~${old}~>${next}~~}`
  }
  const attempt = (span: SourceRange, prefix: number, suffix: number, variant: Variant, equivalence: TrackedEquivalence): DocumentSourceEdit | undefined => {
    const mapped = toTarget(span)
    const old = source.slice(span.start + prefix, span.end - suffix)
    const next = target.slice(mapped.start + prefix, mapped.end - suffix)
    if (old === next) return undefined
    const start = span.start + prefix
    const end = span.end - suffix
    if (cuts(start, end)) return undefined
    const atLineEnd = end === source.length || source[end] === '\n' || source[end] === '\r'
    const insert = spell(old, next, variant, atLineEnd)
    if (insert === undefined) return undefined
    const edit = Object.freeze({ start, end, insert })
    if (!oracle.accepts([edit], equivalence)) return undefined
    const candidate = oracle.preview([edit])
    const authored = markupAnnotations(candidate.annotations).find(annotation =>
      annotation.range.end === start + insert.length && annotation.range.start >= start)
    return authored === undefined ? undefined : edit
  }
  const trimmed = (span: SourceRange, variant: Variant, equivalence: TrackedEquivalence): DocumentSourceEdit | undefined => {
    const found = attempt(span, 0, 0, variant, equivalence)
    if (found === undefined) return undefined
    const mapped = toTarget(span)
    const old = source.slice(span.start, span.end)
    const next = target.slice(mapped.start, mapped.end)
    const limit = Math.min(old.length, next.length)
    let common = 0
    while (common < limit && old[common] === next[common]) common += 1
    // A change beginning a line (a block literal opener) keeps its arms and
    // closer on their own lines; a change within a line trims to characters.
    const byLine = lineStart(source, span.start) === span.start &&
      (span.end === source.length || /[\n\r]/u.test(source[span.end - 1] ?? '')) &&
      (common === 0 || /[\n\r]/u.test(old[common - 1] ?? ''))
    const boundaries = (length: number, value: (index: number) => string | undefined, fromEnd: boolean): number[] => {
      const result = [0]
      for (let index = 1; index <= length; index += 1) {
        if (!byLine) result.push(index)
        else {
          const at = value(fromEnd ? old.length - index : index - 1)
          if (at === '\n' || (at === '\r' && value(fromEnd ? old.length - index + 1 : index) !== '\n')) result.push(index)
        }
      }
      return result
    }
    const largest = (options: readonly number[], test: (value: number) => DocumentSourceEdit | undefined, fallback: DocumentSourceEdit): [number, DocumentSourceEdit] => {
      let low = 0
      let high = options.length - 1
      let best: [number, DocumentSourceEdit] = [0, fallback]
      while (low <= high) {
        const middle = (low + high) >> 1
        const edit = test(options[middle]!)
        if (edit !== undefined) {
          best = [options[middle]!, edit]
          low = middle + 1
        } else high = middle - 1
      }
      return best
    }
    const prefixes = boundaries(common, index => old[index], false)
    const [prefix, afterPrefix] = largest(prefixes, value => value === 0 ? found : attempt(span, value, 0, variant, equivalence), found)
    const rest = Math.min(old.length, next.length) - prefix
    let suffixCommon = 0
    while (suffixCommon < rest && old[old.length - 1 - suffixCommon] === next[next.length - 1 - suffixCommon]) suffixCommon += 1
    const suffixes = boundaries(suffixCommon, index => old[index], true)
    return largest(suffixes, value => value === 0 ? afterPrefix : attempt(span, prefix, value, variant, equivalence), afterPrefix)[1]
  }
  // A span enclosing an existing annotation repeats it in both arms; prefer
  // spans of plain source even at the cost of a rendering-identical spelling.
  const encloses = (span: SourceRange): boolean => annotations.some(annotation =>
    span.start <= annotation.range.start && annotation.range.end <= span.end)
  for (const enclosing of [false, true]) {
    const spans = candidates.filter(span => encloses(span) === enclosing)
    for (const variant of ['exact', 'pair', 'reversed'] as const) {
      for (const span of spans) {
        const edit = trimmed(span, variant, 'exact')
        if (edit !== undefined) return edit
      }
    }
    // Byte identity is impossible only where a delimiter would join the payload
    // (a final escape) or a block literal must end before its delimiter line.
    for (const variant of ['exact', 'pair', 'reversed', 'escaped', 'padded', 'shifted'] as const) {
      for (const span of spans) {
        const edit = trimmed(span, variant, 'rendering')
        if (edit !== undefined) return edit
      }
    }
  }
  return undefined
}

/**
 * Typing inside history splits it at the caret: the retained left and right
 * history keep their arms while the typed text becomes a new Addition.
 */
export function splitTrackedHistoryEdit(
  core: DocumentCore,
  previous: DocumentRevision,
  offset: number,
  text: string,
  preview: Preview
): DocumentSourceEdit | undefined {
  const annotations = markupAnnotations(previous.annotations)
  let owner: CriticMarkupAnnotation | undefined
  for (const annotation of annotations) {
    const arm = annotation.arms.find(arm => arm.name === (annotation.kind === 'deletion' ? 'content' : 'old'))
    if ((annotation.kind !== 'deletion' && annotation.kind !== 'substitution') || arm === undefined) continue
    if (arm.range.start < offset && offset < arm.range.end &&
        (owner === undefined || annotation.range.end - annotation.range.start < owner.range.end - owner.range.start)) owner = annotation
  }
  if (owner === undefined) return undefined
  const history = owner.arms.find(arm => arm.name === (owner.kind === 'deletion' ? 'content' : 'old'))!
  // A split point must not cut a nested annotation.
  const nested = markupAnnotations(history.annotations)
  const splittable = (position: number): boolean =>
    history.range.start < position && position < history.range.end &&
    !nested.some(annotation => annotation.range.start < position && position < annotation.range.end)
  const syntax = core.project(previous, 'markup').syntax
  const points = new Set<number>([offset])
  const visit = (node: MarkdownAstNode): void => {
    for (const edge of [syntax.coordinates.toSource(node.range.start, 'next'), syntax.coordinates.toSource(node.range.end, 'previous')]) {
      if (history.range.start < edge && edge < history.range.end) points.add(edge)
    }
    for (const child of node.children) visit(child)
  }
  visit(syntax.ast.root)
  const ordered = [...points].filter(splittable).sort((left, right) => Math.abs(left - offset) - Math.abs(right - offset) || left - right).slice(0, 12)
  const source = (range: SourceRange): string => core.sourceSlice(previous, range)
  const original = core.project(previous, 'original').markdown
  // A final backslash would escape the Addition's closer; its completed
  // escape renders the same single backslash.
  const payload = trailingBackslashes(text) % 2 === 1 ? `${text}\\` : text
  for (const point of ordered) {
    const left = source({ start: history.range.start, end: point })
    const edit = owner.kind === 'deletion'
      ? { start: point, end: point, insert: `--}{++${payload}++}{--` }
      : { start: owner.range.start, end: point, insert: `{--${left}--}{++${payload}++}{~~` }
    const plain = owner.kind === 'deletion'
      ? { start: point, end: point, insert: `--}${text}{--` }
      : { start: owner.range.start, end: point, insert: `{--${left}--}${text}{~~` }
    // The caret domain must contain the declared insertion for reconciliation.
    const from = Math.min(edit.start, offset)
    const to = Math.max(edit.end, offset)
    const widen = (value: DocumentSourceEdit): DocumentSourceEdit => Object.freeze({
      start: from,
      end: to,
      insert: source({ start: from, end: value.start }) + value.insert + source({ start: value.end, end: to })
    })
    const candidate = preview([widen(edit)])
    const expected = preview([widen(plain)])
    const facts = trackedPreviewFacts.get(candidate)
    const expectedFacts = trackedPreviewFacts.get(expected)
    if (facts === undefined || expectedFacts === undefined) return undefined
    const added = markupAnnotations(candidate.annotations).some(annotation => annotation.kind === 'addition' &&
      annotation.arms.some(arm => candidate.source.slice(arm.range.start, arm.range.end) === payload))
    if (added && candidate.diagnostics.length === previous.diagnostics.length && facts.original === original &&
        (payload !== text || facts.revised === expectedFacts.revised)) return widen(edit)
  }
  return undefined
}

/**
 * Removing the Addition that split a history arm rejoins the retained history
 * on both sides into its previous single annotation.
 */
export function rejoinedTrackedHistoryEdit(
  core: DocumentCore,
  previous: DocumentRevision,
  cancelled: CriticMarkupAnnotation,
  preview: Preview
): DocumentSourceEdit | undefined {
  const annotations = markupAnnotations(previous.annotations)
  const left = annotations.find(annotation => annotation.kind === 'deletion' && annotation.range.end === cancelled.range.start)
  const right = annotations.find(annotation =>
    (annotation.kind === 'deletion' || annotation.kind === 'substitution') && annotation.range.start === cancelled.range.end)
  if (left === undefined || right === undefined) return undefined
  const leftContent = left.arms.find(arm => arm.name === 'content')!
  const rightHistory = right.arms.find(arm => arm.name === (right.kind === 'deletion' ? 'content' : 'old'))!
  const edit = right.kind === 'deletion'
    ? Object.freeze({ start: leftContent.range.end, end: rightHistory.range.start, insert: '' })
    : Object.freeze({
      start: left.range.start,
      end: rightHistory.range.start,
      insert: `{~~${core.sourceSlice(previous, leftContent.range)}`
    })
  const candidate = preview([edit])
  const facts = trackedPreviewFacts.get(candidate)
  const expected = trackedPreviewFacts.get(preview([Object.freeze({ ...cancelled.range, insert: '' })]))
  if (facts === undefined || expected === undefined) return undefined
  const merged = markupAnnotations(candidate.annotations).some(annotation => annotation.kind === right.kind &&
    annotation.range.start === left.range.start)
  return merged && facts.original === expected.original && facts.revised === expected.revised ? edit : undefined
}

/**
 * An edit inside a pending draft arm that the arm cannot close around
 * (a block literal reaching the closer, a final escape) keeps the draft and
 * ends the arm on its own line or completes the escape.
 */
export function draftTrackedSourceEdit(
  core: DocumentCore,
  previous: DocumentRevision,
  edit: DocumentSourceEdit,
  preview: Preview
): DocumentSourceEdit | undefined {
  let owner: CriticMarkupAnnotation | undefined
  for (const annotation of markupAnnotations(previous.annotations)) {
    const arm = annotation.arms.find(arm => arm.name === (annotation.kind === 'addition' ? 'content' : annotation.kind === 'substitution' ? 'new' : ''))
    if (arm !== undefined && arm.range.start <= edit.start && edit.end <= arm.range.end &&
        (owner === undefined || annotation.range.end - annotation.range.start < owner.range.end - owner.range.start)) owner = annotation
  }
  if (owner === undefined) return undefined
  const arm = owner.arms.find(arm => arm.name === (owner.kind === 'addition' ? 'content' : 'new'))!
  if (markupAnnotations(arm.annotations).some(annotation => annotation.range.start < edit.end && edit.start < annotation.range.end)) return undefined
  const tail = core.sourceSlice(previous, { start: edit.end, end: arm.range.end })
  const content = core.sourceSlice(previous, { start: arm.range.start, end: edit.start }) + edit.insert + tail
  // Accepting the draft is the untracked result of the same operation.
  const accepted = [Object.freeze({ ...owner.range, insert: content })]
  const oracle = createTrackedOracle(core, previous, accepted, memoizedPreview(preview))
  if (oracle === undefined) return undefined
  const eol = (content.match(EOL) ?? core.sourceSlice(previous, { start: 0, end: previous.sourceLength }).match(EOL))?.[0] ?? '\n'
  const suffixes: string[] = []
  if (trailingBackslashes(content) % 2 === 1) suffixes.push('\\')
  if (!EOL.test(content.at(-1) ?? '\n')) suffixes.push(eol)
  for (const equivalence of ['exact', 'rendering'] as const) {
    for (const suffix of ['', ...suffixes]) {
      const candidate = suffix === '' ? Object.freeze({ ...edit }) : Object.freeze({ start: edit.start, end: arm.range.end, insert: edit.insert + tail + suffix })
      if (!oracle.accepts([candidate], equivalence)) continue
      const next = oracle.preview([candidate])
      const shift = candidate.insert.length - (candidate.end - candidate.start)
      if (markupAnnotations(next.annotations).some(annotation => annotation.kind === owner.kind &&
        annotation.range.start === owner.range.start && annotation.range.end === owner.range.end + shift)) return candidate
    }
  }
  // Text after the draft that the accepted draft would absorb (an unclosed
  // fence) joins one Substitution whose new arm is that accepted text.
  return widenedTrackedSourceEdit(core, previous, oracle)
}

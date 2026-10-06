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
  /**
   * For a candidate read regionally from `base`: it replaced `base`'s source
   * `[start, end)` with its own `[start, nextEnd)`, and reads as `base` does
   * everywhere else, so the oracle compares candidates there alone.
   */
  readonly region?: TrackedPreviewRegion
}

export interface TrackedPreviewRegion {
  readonly base: DocumentRevision
  readonly revision: DocumentRevision
  readonly start: number
  readonly end: number
  readonly nextEnd: number
}

/** The document core registers the projection facts of each authoring preview. */
export const trackedPreviewFacts = new WeakMap<DocumentRevision, TrackedProjectionFacts>()

/**
 * A revision's reading of a source range without a document parse: the text
 * the range projects to in Original and Revised, as `projectAround` spans it,
 * and the Revised view identity of the blocks read for it with their source.
 */
export interface TrackedRegionalReading {
  readonly original: string
  readonly revised: string
  readonly window: SourceRange
  readonly view: () => string
}

/** The document core reads ranges of its revisions regionally, or not at all (undefined). */
export const trackedRegionalReadings = new WeakMap<
  DocumentCore,
  (revision: DocumentRevision, range: SourceRange) => TrackedRegionalReading | undefined
>()

/** Revised view identity of Markdown text such as a projection: its tree without spelling or offsets. */
export const trackedMarkdownSignatures = new WeakMap<DocumentCore, (markdown: string) => string>()
/**
 * A source's Original and Revised views as a document holding annotations
 * reads them: whether an unfinished opener is escaped in the views depends
 * on whether the document has any annotation at all, which no edit means.
 */
export const trackedAnnotatedViews = new WeakMap<DocumentCore, (source: string) => Readonly<{
  original: string
  revised: string
  revisedView: string
}>>()

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

/**
 * Window cores, and those of them where an own-draft edit found no spelling
 * the window can show valid: the edit then stands as typed only on the whole
 * document, whose compile may need text the window does not hold.
 */
const windowCompileCores = new WeakSet<DocumentCore>()
const unresolvedDraftCores = new WeakSet<DocumentCore>()
export const markWindowCompileCore = (core: DocumentCore): void => {
  windowCompileCores.add(core)
}
export const isWindowCompileCore = (core: DocumentCore): boolean => windowCompileCores.has(core)
export const markUnresolvedDraft = (core: DocumentCore): void => {
  unresolvedDraftCores.add(core)
}
export const draftUnresolved = (core: DocumentCore): boolean => unresolvedDraftCores.has(core)

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
  let originalMarkdown: string | undefined
  const original = (): string => {
    originalMarkdown ??= core.project(previous, 'original').markdown
    return originalMarkdown
  }
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
  const regional = regionalComparisons(core, previous)
  const previousSource = core.sourceSlice(previous, { start: 0, end: previous.sourceLength })
  const viewFacts = trackedPreviewFacts.get(target)
  let targetView: string | undefined
  const sameView = (facts: TrackedProjectionFacts): boolean => {
    if (viewFacts === undefined) return false
    const compared = regional.sameView(facts, viewFacts)
    if (compared !== undefined) return compared
    targetView ??= viewFacts.revisedView()
    return facts.revisedView() === targetView
  }
  const annotatedViews = trackedAnnotatedViews.get(core)
  const annotatedBySource = new Map<string, ReturnType<NonNullable<typeof annotatedViews>>>()
  const annotated = (source: string) => {
    let views = annotatedBySource.get(source)
    if (views === undefined && annotatedViews !== undefined) {
      views = annotatedViews(source)
      annotatedBySource.set(source, views)
    }
    return views
  }
  // A candidate that gives the document its first annotation, or takes its
  // last away, changes how every unfinished opener outside the edit is
  // escaped in the views; it is weighed as if the document's annotation
  // presence were unchanged, all three read as a document with annotations.
  const acceptsAcrossPresence = (candidate: DocumentRevision, edits: readonly DocumentSourceEdit[],
    authored: AuthoredAnnotation[], equivalence: TrackedEquivalence): boolean => {
    const present = (revision: DocumentRevision): boolean => revision.annotations.length > 0
    if (present(candidate) === present(previous) && present(candidate) === present(target)) return false
    const candidateViews = annotated(candidate.source)
    const previousViews = annotated(previousSource)
    const targetViews = annotated(target.source)
    if (candidateViews === undefined || previousViews === undefined || targetViews === undefined) return false
    if (candidateViews.revisedView !== targetViews.revisedView) return false
    if (equivalence === 'exact'
      ? candidateViews.revised !== targetViews.revised || candidateViews.original !== previousViews.original
      : signature(candidateViews.original) !== signature(previousViews.original)) return false
    return partiallyResolvable(edits, candidate, authored, cachedPreview)
  }
  const accepts = (edits: readonly DocumentSourceEdit[], equivalence: TrackedEquivalence): boolean => {
    const candidate = cachedPreview(edits)
    const facts = trackedPreviewFacts.get(candidate)
    if (facts === undefined) return false
    const authored = authoredAnnotations(edits, candidate)
    return acceptsInPresence(candidate, facts, edits, authored, equivalence) ||
      acceptsAcrossPresence(candidate, edits, authored, equivalence)
  }
  const acceptsInPresence = (candidate: DocumentRevision, facts: TrackedProjectionFacts, edits: readonly DocumentSourceEdit[],
    authored: AuthoredAnnotation[], equivalence: TrackedEquivalence): boolean => {
    // Resolution splices arm bytes, while a projection may also materialize the
    // closing fence of a literal an arm boundary ended (L2c). That projection
    // must still read as the untracked result.
    if (equivalence === 'exact' &&
        !(regional.same(facts, targetFacts, 'revised') ?? facts.revised === targetFacts.revised) ||
        equivalence === 'exact' &&
        !(regional.sameAsPrevious(facts, 'original') ?? facts.original === original())) {
      if (!(authored.length > 0 && resolveAuthored(candidate.source, authored, 'accept') === target.source &&
          resolveAuthored(candidate.source, authored, 'reject') === previousSource &&
          viewFacts !== undefined && facts.revisedView() === (targetView ??= viewFacts.revisedView()) &&
          signature(facts.original) === signature(original()))) return false
    }
    // Equal materialized text can still mean something else inside an arm
    // (an arm-local literal or definition): the Revised view must agree too.
    if (!sameView(facts)) return false
    if (equivalence === 'rendering' && signature(facts.original) !== signature(original())) return false
    // Resolving each authored suggestion alone is a whole preview apiece,
    // several per candidate, so a candidate is resolved only once every
    // check above has accepted it.
    return partiallyResolvable(edits, candidate, authored, cachedPreview)
  }
  return Object.freeze({
    untracked,
    untrackedSource: target.source,
    revisesVisibleText: !(regional.sameAsPrevious(targetFacts, 'revised') ??
      targetFacts.revised === core.project(previous, 'revised').markdown),
    accepts,
    preview: cachedPreview
  })
}

/**
 * Projections of candidates read regionally from one revision, compared
 * where they can differ: each reads as that revision outside the source it
 * replaced, so two read alike where their readings of the source either
 * replaced agree. Undefined where a reading needs the whole projection.
 */
function regionalComparisons(core: DocumentCore, previous: DocumentRevision): Readonly<{
  same: (left: TrackedProjectionFacts, right: TrackedProjectionFacts, name: 'original' | 'revised') => boolean | undefined
  sameAsPrevious: (facts: TrackedProjectionFacts, name: 'original' | 'revised') => boolean | undefined
  sameView: (left: TrackedProjectionFacts, right: TrackedProjectionFacts) => boolean | undefined
}> {
  const read = trackedRegionalReadings.get(core)
  // `span` in the base revision's source, read in the candidate's.
  const readIn = (region: TrackedPreviewRegion, span: SourceRange): TrackedRegionalReading | undefined =>
    read?.(region.revision, { start: span.start, end: span.end + region.nextEnd - region.end })
  const pair = (left: TrackedProjectionFacts, right: TrackedProjectionFacts): readonly [TrackedPreviewRegion, TrackedPreviewRegion] | undefined => {
    const a = left.region
    const b = right.region
    return a === undefined || b === undefined || a.base !== previous || b.base !== previous ? undefined : [a, b]
  }
  const union = (a: SourceRange, b: SourceRange): SourceRange => ({ start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) })
  return Object.freeze({
    same: (left, right, name) => {
      const regions = pair(left, right)
      if (regions === undefined) return undefined
      if (regions[0].revision === regions[1].revision) return true
      const span = union(regions[0], regions[1])
      const a = readIn(regions[0], span)
      const b = a === undefined ? undefined : readIn(regions[1], span)
      return a === undefined || b === undefined ? undefined : a[name] === b[name]
    },
    sameAsPrevious: (facts, name) => {
      const region = facts.region
      if (region === undefined || region.base !== previous || read === undefined) return undefined
      const a = readIn(region, region)
      const b = a === undefined ? undefined : read(previous, region)
      return a === undefined || b === undefined ? undefined : a[name] === b[name]
    },
    // The blocks read for each candidate stand for its whole view where both
    // were read from the same source of the base revision.
    sameView: (left, right) => {
      const regions = pair(left, right)
      if (regions === undefined) return undefined
      if (regions[0].revision === regions[1].revision) return true
      let span = union(regions[0], regions[1])
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const a = readIn(regions[0], span)
        const b = a === undefined ? undefined : readIn(regions[1], span)
        if (a === undefined || b === undefined) return undefined
        const inBase = (window: SourceRange, region: TrackedPreviewRegion): SourceRange =>
          ({ start: window.start, end: window.end - region.nextEnd + region.end })
        const windowA = inBase(a.window, regions[0])
        const windowB = inBase(b.window, regions[1])
        if (windowA.start === windowB.start && windowA.end === windowB.end) return a.view() === b.view()
        span = union(windowA, windowB)
      }
      return undefined
    }
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
 * The text Accept All or Reject All leaves of the source `text` starting at
 * `offset`, which holds `annotations` whole: each suggestion resolved to the
 * arm the decision keeps, nested ones within it, Comments dropped.
 */
export function resolvedSuggestions(
  text: string,
  annotations: readonly CriticMarkupAnnotation[],
  decision: 'accept' | 'reject',
  offset = 0
): string {
  const resolve = (from: number, to: number, level: readonly CriticMarkupAnnotation[]): string => {
    let resolved = ''
    let cursor = from
    for (const annotation of level) {
      resolved += text.slice(cursor - offset, annotation.range.start - offset)
      const name = resolvedArm(annotation, decision)
      const kept = name === undefined ? undefined : annotation.arms.find(arm => arm.name === name)
      if (kept !== undefined) resolved += resolve(kept.range.start, kept.range.end, kept.annotations)
      cursor = annotation.range.end
    }
    return resolved + text.slice(cursor - offset, to - offset)
  }
  return resolve(offset, offset + text.length, annotations)
}

/** Whether a suggestion, at any depth, starts at an offset. */
function startsSuggestion(annotations: readonly CriticMarkupAnnotation[], at: number): boolean {
  return annotations.some(({ range, arms }) => range.start === at || arms.some(arm => startsSuggestion(arm.annotations, at)))
}

/** Whether `after` is `before` with `typed` inserted at one place. */
export function keepsTyping(after: string, before: string, typed: string): boolean {
  if (after.length !== before.length + typed.length) return false
  let prefix = 0
  while (prefix < before.length && after.charCodeAt(prefix) === before.charCodeAt(prefix)) prefix += 1
  let suffix = 0
  while (suffix < before.length && after.charCodeAt(after.length - 1 - suffix) === before.charCodeAt(before.length - 1 - suffix)) suffix += 1
  // The typing sits where the shared prefix and the shared suffix meet.
  for (let at = Math.max(0, before.length - suffix); at <= prefix; at += 1) {
    if (after.startsWith(typed, at)) return true
  }
  return false
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
const BLOCK_LITERAL_KINDS = new Set(['code-block', 'math-block', 'diagram'])

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
  // A span never ends between the CR and LF of one line ending.
  const whole = (span: SourceRange): SourceRange => ({
    start: span.start > 0 && source[span.start - 1] === '\r' && source[span.start] === '\n' ? span.start + 1 : span.start,
    end: span.end > 0 && source[span.end - 1] === '\r' && source[span.end] === '\n' ? span.end + 1 : span.end
  })
  for (const span of spans) {
    const safe = annotationSafe(annotations, whole(span))
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
    // A tracked edit spells only whole suggestions; one that leaves a marker
    // unpaired beyond those the untracked edit leaves is no spelling of it.
    if (candidate.diagnostics.length > Math.max(previous.diagnostics.length, oracle.preview(untracked).diagnostics.length)) return undefined
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

/** Whether `text` is one block whose content is literal: a fence, a math block, indented code or an HTML block. */
function literalBlockText(text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/u)
  while (lines.length > 1 && lines.at(-1)?.trim() === '') lines.pop()
  const first = lines[0] ?? ''
  if (/^ {0,3}(?:`{3,}|~{3,}|\$\$)/u.test(first) || /^ {0,3}</u.test(first)) return true
  return lines.every(line => line.trim() === '' || /^(?: {4}|\t)/u.test(line)) && first.trim() !== ''
}

/**
 * Where text typed at `offset`, inside the old arm of a Substitution of a
 * literal block, goes in its new arm. A literal block's text reads literally,
 * so the old arm cannot split around a new Addition; the typing edits the
 * proposed block instead, at the place the old block's text there kept.
 */
export function literalHistoryInsertionPoint(
  core: DocumentCore,
  previous: DocumentRevision,
  owner: CriticMarkupAnnotation,
  offset: number
): number | undefined {
  if (owner.kind !== 'substitution') return undefined
  const old = owner.arms.find(arm => arm.name === 'old')
  const next = owner.arms.find(arm => arm.name === 'new')
  if (old === undefined || next === undefined || !(old.range.start < offset && offset < old.range.end)) return undefined
  const oldText = core.sourceSlice(previous, old.range)
  const nextText = core.sourceSlice(previous, next.range)
  if (!literalBlockText(oldText) || !literalBlockText(nextText)) return undefined
  const at = offset - old.range.start
  const limit = Math.min(oldText.length, nextText.length)
  let prefix = 0
  while (prefix < limit && oldText[prefix] === nextText[prefix]) prefix += 1
  if (at <= prefix) return next.range.start + at
  let suffix = 0
  while (suffix < limit - prefix && oldText[oldText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]) suffix += 1
  return oldText.length - at <= suffix ? next.range.end - (oldText.length - at) : next.range.start + prefix
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
  preview: Preview,
  // Weigh a split by what Accept All and Reject All leave (G34) rather than
  // by the Original view, which a split block literal reads as two blocks.
  byResolution = false
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
  const literalBlocks: SourceRange[] = []
  const visit = (node: MarkdownAstNode): void => {
    const start = syntax.coordinates.toSource(node.range.start, 'next')
    const end = syntax.coordinates.toSource(node.range.end, 'previous')
    for (const edge of [start, end]) {
      if (history.range.start < edge && edge < history.range.end) points.add(edge)
    }
    if (BLOCK_LITERAL_KINDS.has(node.kind)) literalBlocks.push({ start, end })
    for (const child of node.children) visit(child)
  }
  visit(syntax.ast.root)
  const source = (range: SourceRange): string => core.sourceSlice(previous, range)
  // A marker in a block literal the arm opens is literal text unless only
  // indentation comes before it on its line or in the arm (Profile 2 L2c ends
  // an arm-opened literal only at a line start), so a split after other text
  // there never spells a suggestion and is not weighed.
  const withinLiteralLine = (position: number): boolean =>
    literalBlocks.some(block => history.range.start <= block.start && block.end <= history.range.end &&
      block.start < position && position < block.end) &&
    !/(?:^|[\n\r])[ \t]*$/u.test(source({ start: Math.max(history.range.start, position - 256), end: position }))
  const ordered = [...points].filter(splittable)
    .sort((left, right) => Math.abs(left - offset) - Math.abs(right - offset) || left - right).slice(0, 12)
    .filter(point => !withinLiteralLine(point))
  const original = core.project(previous, 'original').markdown
  const previousSource = source({ start: 0, end: previous.sourceLength })
  let rejectedBefore: string | undefined
  let acceptedBefore: string | undefined
  const rejected = (): string => {
    rejectedBefore ??= resolvedSuggestions(previousSource, previous.annotations, 'reject')
    return rejectedBefore
  }
  const accepted = (): string => {
    acceptedBefore ??= resolvedSuggestions(previousSource, previous.annotations, 'accept')
    return acceptedBefore
  }
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
    if (byResolution) {
      if (added && payload === text && candidate.diagnostics.length <= previous.diagnostics.length &&
          resolvedSuggestions(candidate.source, candidate.annotations, 'reject') === rejected() &&
          keepsTyping(resolvedSuggestions(candidate.source, candidate.annotations, 'accept'), accepted(), text)) return widen(edit)
      continue
    }
    if (added && candidate.diagnostics.length === previous.diagnostics.length && facts.original === original &&
        (payload !== text || facts.revised === expectedFacts.revised)) return widen(edit)
  }
  if (!byResolution || payload !== text) return undefined
  // No split spells it: the Substitution proposes the typing ahead of its
  // text, or a Deletion becomes a Substitution by it, or the typing is added
  // just before or after the suggestion.
  const kept = source(history.range)
  const proposal = owner.kind === 'substitution'
    ? source(owner.arms.find(arm => arm.name === 'new')?.range ?? { start: owner.range.end, end: owner.range.end })
    : ''
  for (const edit of [
    { start: owner.range.start, end: owner.range.end, insert: `{~~${kept}~>${text}${proposal}~~}` },
    { start: owner.range.start, end: owner.range.start, insert: `{++${text}++}` },
    { start: owner.range.end, end: owner.range.end, insert: `{++${text}++}` }
  ]) {
    const from = Math.min(edit.start, offset)
    const to = Math.max(edit.end, offset)
    const widened = Object.freeze({
      start: from,
      end: to,
      insert: source({ start: from, end: edit.start }) + edit.insert + source({ start: edit.end, end: to })
    })
    const candidate = preview([widened])
    if (candidate.diagnostics.length <= previous.diagnostics.length &&
        startsSuggestion(candidate.annotations, edit.start) &&
        resolvedSuggestions(candidate.source, candidate.annotations, 'reject') === rejected() &&
        keepsTyping(resolvedSuggestions(candidate.source, candidate.annotations, 'accept'), accepted(), text)) return widened
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
  preview = memoizedPreview(preview)
  // A delimiter typed inside one's own suggestion pairs as it would untracked,
  // so the Revised view shows the accepted reading (see below). Where the edit
  // is on a line that is or becomes a fence or `$$` line, or text before the
  // suggestion joins the arm's opening fence line once accepted, keeping that
  // reading would re-spell every later block up to where the fences agree
  // again. An arm boundary ends a block literal its arm opened (Profile 2 L2c,
  // ADR-0016), so the edit is then the edit in the arm, as typed, as in Google
  // Docs: Accept gives the untracked source byte for byte, Reject leaves the
  // Original. One that ends the suggestion elsewhere is spelled otherwise.
  const armText = core.sourceSlice(previous, arm.range)
  const local = { start: edit.start - arm.range.start, end: edit.end - arm.range.start }
  const editedLines = (text: string, start: number, end: number): string[] => {
    let from = start
    while (from > 0 && text[from - 1] !== '\n' && text[from - 1] !== '\r') from -= 1
    let to = end
    while (to < text.length && text[to] !== '\n' && text[to] !== '\r') to += 1
    return text.slice(from, to).split(/\r\n|\r|\n/u)
  }
  const delimiterLine = (line: string): boolean => /^ {0,3}(?:`{3,}|~{3,}|\$\$)/u.test(line)
  const typedArm = armText.slice(0, local.start) + edit.insert + armText.slice(local.end)
  const onDelimiterLine = editedLines(armText, local.start, local.end).some(delimiterLine) ||
    editedLines(typedArm, local.start, local.start + edit.insert.length).some(delimiterLine)
  const before = core.sourceSlice(previous, { start: Math.max(0, owner.range.start - 512), end: owner.range.start })
  const joinsFenceLine = before.slice(lineStart(before, before.length)).trim() !== '' && delimiterLine(armText)
  if (onDelimiterLine || joinsFenceLine) {
    const extended = preview([edit])
    const grown = edit.insert.length - (edit.end - edit.start)
    if (markupAnnotations(extended.annotations).some(annotation => annotation.kind === owner.kind &&
      annotation.range.start === owner.range.start && annotation.range.end === owner.range.end + grown)) return Object.freeze({ ...edit })
  }
  // Accepting the draft is the untracked result of the same operation.
  const accepted = [Object.freeze({ ...owner.range, insert: content })]
  const oracle = createTrackedOracle(core, previous, accepted, preview)
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

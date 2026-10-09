import { plansFromGeneralCompile } from './internal/documentCoreInspection.js'
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
  /** For a candidate parsed whole: its blocks and literals, as `trackedStructure` reads them. */
  readonly structure?: () => TrackedStructure
}

/** A block or literal of a Markdown reading: what it is, and its source range. */
export interface TrackedPart {
  readonly kind: string
  readonly start: number
  readonly end: number
}

/**
 * The top-level blocks of a reading, with the items of a list as blocks of
 * their own, and the literals it reads, each in source order.
 */
export interface TrackedStructure {
  readonly blocks: readonly TrackedPart[]
  readonly literals: readonly TrackedPart[]
}

interface SourceCoordinates {
  readonly toSource: (offset: number, affinity: 'next' | 'previous') => number
}

/**
 * A reading's blocks and literals. A block's kind holds its own attributes
 * other than positions and text, so a list item that leaves its list, or a
 * fence that loses its info string, reads as another block.
 */
export function trackedStructure(root: MarkdownAstNode, coordinates: SourceCoordinates): TrackedStructure {
  const range = (node: MarkdownAstNode) => ({
    start: coordinates.toSource(node.range.start, 'next'),
    end: coordinates.toSource(node.range.end, 'previous')
  })
  const shape = (node: MarkdownAstNode): string => JSON.stringify(Object.entries(node.attributes)
    .filter(([name, value]) => !(typeof value === 'number' && /(?:Start|End)$/u.test(name)) &&
      name !== 'content' && name !== 'semanticText' && name !== 'semanticStart' && name !== 'semanticEnd')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
  const blocks: TrackedPart[] = []
  for (const block of root.children) {
    if (block.kind === 'list') {
      for (const item of block.children) blocks.push({ kind: `item ${shape(block)} ${shape(item)}`, ...range(item) })
    } else {
      blocks.push({ kind: `${block.kind} ${shape(block)} ${block.kind === 'table' ? block.children.length : ''}`, ...range(block) })
    }
  }
  const literals: TrackedPart[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (LITERAL_KINDS.has(node.kind)) literals.push({ kind: node.kind, ...range(node) })
    for (const child of node.children) visit(child)
  }
  visit(root)
  return { blocks, literals }
}

/**
 * The source range of `previous` whose reading the edit of `edited` changes,
 * where `next` is that edit's reading and the edit changed the length by
 * `delta`: the blocks and literals from the first that reads otherwise to
 * the last, the parts before and after reading alike (moved by `delta` after
 * it). A block that only holds the edit, keeping its kind, changes no block
 * structure. A position `next` wrote maps to the edited range.
 */
export function readingChange(previous: TrackedStructure, next: TrackedStructure, edited: SourceRange, delta: number): SourceRange {
  const back = (position: number, side: 'start' | 'end'): number =>
    position <= edited.start ? position : position >= edited.end + delta ? position - delta : side === 'start' ? edited.start : edited.end
  let start = edited.start
  let end = edited.end
  const span = (before: readonly TrackedPart[], after: readonly TrackedPart[], holdsOnly: boolean): void => {
    const alike = (left: TrackedPart | undefined, right: TrackedPart | undefined, shift: number): boolean =>
      left !== undefined && right !== undefined && left.kind === right.kind &&
      left.start + shift === right.start && left.end + shift === right.end
    let first = 0
    while (first < before.length && first < after.length && (before[first]?.end ?? Infinity) <= edited.start &&
      alike(before[first], after[first], 0)) first += 1
    let last = 0
    while (last < before.length - first && last < after.length - first && (before[before.length - 1 - last]?.start ?? -1) >= edited.end &&
      alike(before[before.length - 1 - last], after[after.length - 1 - last], delta)) last += 1
    const changedBefore = before.slice(first, before.length - last)
    const changedAfter = after.slice(first, after.length - last)
    if (holdsOnly && changedBefore.length === changedAfter.length && changedBefore.every((part, ordinal) => {
      const other = changedAfter[ordinal]
      return other !== undefined && other.kind === part.kind && other.start === part.start && other.end === part.end + delta &&
        part.start <= edited.start && edited.end <= part.end
    })) return
    for (const part of changedBefore) {
      start = Math.min(start, part.start)
      end = Math.max(end, part.end)
    }
    for (const part of changedAfter) {
      start = Math.min(start, back(part.start, 'start'))
      end = Math.max(end, back(part.end, 'end'))
    }
  }
  span(previous.blocks, next.blocks, true)
  span(previous.literals, next.literals, false)
  return { start, end }
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

/**
 * Source units up to which a document's tracked keys are spelled over the
 * span their reading change derives: the change is read off whole parses
 * of the document before and after the key.
 */
export const DERIVED_SPELLING_UNITS = 8192

/**
 * Whether a key, as the untracked edit `edited` writing `insert`, is one
 * whose reading can change far beyond its own lines: it is typed on a
 * fence or math delimiter line, or it writes or removes a delimiter run
 * such a line opens with. Other keys read locally enough for the search.
 */
export function derivesSpelling(source: string, edited: SourceRange, insert: string): boolean {
  if (/`{2,}|~{3,}|\$\$/u.test(insert + source.slice(edited.start, edited.end))) return true
  // Typed within or at either end of the delimiter run a line opens with;
  // an info string after it leaves the block as it reads.
  const start = lineStart(source, edited.start)
  const run = /^( {0,3})(`{2,}|~{2,}|\$\$)/u.exec(source.slice(start, lineEnd(source, edited.start)))
  if (run !== null && edited.start <= start + run[0].length && edited.end >= start + (run[1]?.length ?? 0)) return true
  // Punctuation typed where a line starts, below a line of text, can join
  // the line to the block above or end that block.
  return edited.start === start && start > 0 && /^[^\p{L}\p{N}\s]/u.test(insert) &&
    /\S/u.test(source.slice(lineStart(source, start - 1), start))
}

/**
 * For a window core compiling such a key: the range of the window the key
 * changes the document's reading of, read off the whole document, so the
 * window spells the key over the span the document would.
 */
export const documentReadingChanges = new WeakMap<DocumentCore, SourceRange>()

/**
 * The key a core's general tracked compile is spelling, as typed: its
 * reading change, read the same way by a window and the document, is
 * what a spelling derives from.
 */
export const typedKeys = new WeakMap<DocumentCore, Readonly<{ previous: DocumentRevision, edit: DocumentSourceEdit }>>()

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

/**
 * The number of annotations at the root of a candidate's parse, where the
 * core can count them without projecting its views; undefined elsewhere.
 */
export const trackedRootCounts = new WeakMap<DocumentCore,
  (previous: DocumentRevision, edits: readonly DocumentSourceEdit[]) => number | undefined>()

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
const windowCompileCores = new WeakMap<DocumentCore, Readonly<{ startsDocument: boolean, endsDocument: boolean }>>()
const unresolvedDraftCores = new WeakMap<DocumentCore, { start: boolean, end: boolean }>()
/** A window core, and whether its window starts and ends where the document does. */
export const markWindowCompileCore = (core: DocumentCore, edges: Readonly<{ startsDocument: boolean, endsDocument: boolean }>): void => {
  windowCompileCores.set(core, edges)
}
export const isWindowCompileCore = (core: DocumentCore): boolean => windowCompileCores.has(core)
/**
 * Whether a range of a window core's document reaches an edge of the window
 * that the document goes on past, where text beyond the window could read it
 * otherwise.
 */
/** Whether a range of a window core's document reaches an edge of the window, which ones. */
export const reachesWindowEdge = (core: DocumentCore, range: SourceRange, length: number): Readonly<{ start: boolean, end: boolean }> | undefined => {
  const start = windowCompileCores.has(core) && range.start === 0
  const end = windowCompileCores.has(core) && range.end === length
  return start || end ? { start, end } : undefined
}
/** Spellings derived from the document's reading change (see searchWidenedSpelling). */
const derivedSpellings = new WeakSet<DocumentSourceEdit>()
/**
 * The span each widened spelling was found in. A span that reaches an edge
 * of a window the document goes on past, as the rest of the window or the
 * whole of it does, is the window's extent rather than the document's: the
 * document compile weighs its own, wider, span there and may settle on
 * another spelling, however narrowly the window's then trims.
 */
const spellingSpans = new WeakMap<DocumentSourceEdit, SourceRange>()
export const reachesOpenWindowEdge = (core: DocumentCore, range: SourceRange, length: number): Readonly<{ start: boolean, end: boolean }> | undefined => {
  const edges = windowCompileCores.get(core)
  const start = edges !== undefined && range.start === 0 && !edges.startsDocument
  const end = edges !== undefined && range.end === length && !edges.endsDocument
  return start || end ? { start, end } : undefined
}
/** Whether a window core's window ends where its document does; undefined for a core reading a document whole. */
export const windowEndsDocument = (core: DocumentCore): boolean | undefined => windowCompileCores.get(core)?.endsDocument

/**
 * Marks a window core's draft as one the document must settle, and which
 * edges of the window it reaches: both, where the window found no spelling.
 */
export const markUnresolvedDraft = (core: DocumentCore, reaches: Readonly<{ start: boolean, end: boolean }> = { start: true, end: true }): void => {
  const marked = unresolvedDraftCores.get(core) ?? { start: false, end: false }
  marked.start ||= reaches.start
  marked.end ||= reaches.end
  unresolvedDraftCores.set(core, marked)
}
export const draftUnresolved = (core: DocumentCore): boolean => unresolvedDraftCores.has(core)
/** The window edges an unresolved draft reaches. */
export const unresolvedDraftEdges = (core: DocumentCore): Readonly<{ start: boolean, end: boolean }> | undefined =>
  unresolvedDraftCores.get(core)

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
  /** `whole`: only Accept All and Reject All need read as the operation, not each suggestion resolved alone. */
  readonly accepts: (edits: readonly DocumentSourceEdit[], equivalence: TrackedEquivalence, whole?: boolean) => boolean
  /** Whether Accept All of the suggestions the edits author gives the operation and Reject All the previous source, byte for byte. */
  readonly resolvesExactly: (edits: readonly DocumentSourceEdit[]) => boolean
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
  const countRoots = trackedRootCounts.get(core)
  const rootCount = (edits: readonly DocumentSourceEdit[]): number =>
    countRoots?.(previous, edits) ?? cachedPreview(edits).annotations.length
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
    authored: AuthoredAnnotation[], equivalence: TrackedEquivalence, whole: boolean): boolean => {
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
    return whole || partiallyResolvable(edits, candidate, authored, rootCount)
  }
  // A spelling that escapes a marker spelling inside literal content is no
  // spelling of the key (see escapesLiteralContent).
  let targetLiterals: SourceRange[] | undefined
  const literals = (): SourceRange[] => {
    targetLiterals ??= literalRanges(core, target)
    return targetLiterals
  }
  const accepts = (edits: readonly DocumentSourceEdit[], equivalence: TrackedEquivalence, whole = false): boolean => {
    const candidate = cachedPreview(edits)
    const facts = trackedPreviewFacts.get(candidate)
    if (facts === undefined) return false
    const authored = authoredAnnotations(edits, candidate)
    return (acceptsInPresence(candidate, facts, edits, authored, equivalence, whole) ||
      acceptsAcrossPresence(candidate, edits, authored, equivalence, whole)) &&
      !escapesLiteralContent(edits, candidate, target.source, literals)
  }
  const acceptsInPresence = (candidate: DocumentRevision, facts: TrackedProjectionFacts, edits: readonly DocumentSourceEdit[],
    authored: AuthoredAnnotation[], equivalence: TrackedEquivalence, whole: boolean): boolean => {
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
    return whole || partiallyResolvable(edits, candidate, authored, rootCount)
  }
  const resolvesExactly = (edits: readonly DocumentSourceEdit[]): boolean => {
    const candidate = cachedPreview(edits)
    const authored = authoredAnnotations(edits, candidate)
    return authored.length > 0 && resolveAuthored(candidate.source, authored, 'accept') === target.source &&
      resolveAuthored(candidate.source, authored, 'reject') === previousSource
  }
  return Object.freeze({
    resolvesExactly,
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

const MARKER_TOKEN = /^(?:\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\{==|==\}|\{>>|<<\})/u
/**
 * Offsets in `typed` before which `accepted` adds a backslash escaping a
 * marker spelling, where the two texts differ only so far; the texts are
 * compared past their common prefix and suffix.
 */
function addedMarkerEscapes(accepted: string, typed: string): number[] {
  let prefix = 0
  const shorter = Math.min(accepted.length, typed.length)
  while (prefix < shorter && accepted.charCodeAt(prefix) === typed.charCodeAt(prefix)) prefix += 1
  let suffix = 0
  while (suffix < shorter - prefix &&
    accepted.charCodeAt(accepted.length - 1 - suffix) === typed.charCodeAt(typed.length - 1 - suffix)) suffix += 1
  const escapes: number[] = []
  // An escape added at the start of a run of equal text may be read at either
  // end of it, so the walk backs up to the start of that run.
  let at = prefix
  while (at > 0 && accepted.charCodeAt(at - 1) === 92 && typed.charCodeAt(at - 1) === 92) at -= 1
  for (let index = at, cursor = at; index < accepted.length - suffix || cursor < typed.length - suffix;) {
    if (accepted.charCodeAt(index) === typed.charCodeAt(cursor) && index < accepted.length && cursor < typed.length) {
      index += 1
      cursor += 1
    } else if (accepted.charCodeAt(index) === 92 && MARKER_TOKEN.test(typed.slice(cursor, cursor + 3)) &&
      accepted.startsWith(typed.slice(cursor, cursor + 3), index + 1)) {
      escapes.push(cursor)
      index += 1
    } else break
  }
  return escapes
}

/**
 * Whether Accept All of the suggestions a candidate's edits author escapes a
 * marker spelling the typed text holds inside literal content, which reads
 * every byte as its text: the escape then changes the code or math, though
 * the views may read the two alike.
 */
export function escapesLiteralContent(
  edits: readonly DocumentSourceEdit[],
  candidate: DocumentRevision,
  typed: string,
  literals: () => readonly SourceRange[]
): boolean {
  const authored = authoredAnnotations(edits, candidate)
  if (authored.length === 0) return false
  const accepted = resolveAuthored(candidate.source, authored, 'accept')
  if (accepted === typed) return false
  const escapes = addedMarkerEscapes(accepted, typed)
  if (escapes.length === 0) return false
  const ranges = literals()
  return escapes.some(at => ranges.some(range => range.start <= at && at < range.end))
}

/** The source ranges of a revision's literal syntax, whose text is its content byte for byte. */
function literalRanges(core: DocumentCore, revision: DocumentRevision): SourceRange[] {
  const { ast, coordinates } = core.project(revision, 'markup').syntax
  const ranges: SourceRange[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (LITERAL_KINDS.has(node.kind)) {
      ranges.push({ start: coordinates.toSource(node.range.start, 'next'), end: coordinates.toSource(node.range.end, 'previous') })
      return
    }
    for (const child of node.children) visit(child)
  }
  visit(ast.root)
  return ranges
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
  rootCount: (edits: readonly DocumentSourceEdit[]) => number
): boolean {
  const shared = authored.filter(item => authored.some(other => other !== item && other.edit === item.edit))
  return shared.every(({ annotation, edit, offset }) => (['accept', 'reject'] as const).every(decision => {
    const owner = edits[edit]!
    const length = annotation.range.end - annotation.range.start
    const insert = owner.insert.slice(0, offset) + resolvedText(candidate.source, annotation, decision) + owner.insert.slice(offset + length)
    const partial = rootCount(edits.map((item, index) => index === edit ? Object.freeze({ ...item, insert }) : item))
    const kept = annotation.arms.find(arm => arm.name === resolvedArm(annotation, decision))
    return partial === candidate.annotations.length - 1 + (kept?.annotations.length ?? 0)
  }))
}

const EOL = /\r\n|\r|\n/u

const LITERAL_KINDS = new Set(['inline-code', 'code-block', 'inline-math', 'math-block', 'inline-html', 'html-block', 'front-matter', 'diagram', 'autolink'])
const BLOCK_LITERAL_KINDS = new Set(['code-block', 'math-block', 'diagram'])
/**
 * Spellings a widened search weighs before it gives up. Every search that
 * finds a spelling in the small, 2,000-block, input and delimiter pools
 * does so within 25; those that find none weigh 44 or more.
 */
const WIDENED_SPELLINGS_WEIGHED = 32

/**
 * The parse work a key's document-level spelling search may spend, in
 * source units of the candidates it reads (each a parse of the document):
 * about 50 ms on the reference Mac (owner decision, 8 October 2026). Past
 * it, the search stops weighing spellings and the key takes its closest one,
 * whose Accept All and Reject All read as the operation, byte for byte.
 */
export const DOCUMENT_SEARCH_UNITS = 8192

/**
 * Oracles of an edit the markup compile cannot read, spelled as the source
 * edit it is: its untracked reading may leave markers unpaired, but no
 * spelling of it may.
 */
export const spelledAsSource = new WeakSet<TrackedOracle>()
/**
 * Oracles recording a key no spelling of its markup holds, as one splitting a
 * marker, the G47 way: only a spelling whose Accept All and Reject All
 * resolve to the operation's bytes, however it reads while pending.
 */
export const recordedExactly = new WeakSet<TrackedOracle>()

/** Spellings of each kind a key past its budget weighs for its closest one, besides the whole document's. */
const CLOSEST_SPELLINGS_WEIGHED = 24

const documentSearchBudgets = new WeakMap<DocumentCore, { spent: number, exhausted?: true }>()

/**
 * Compiles one key in `core` under one document-level search budget, shared
 * by every spelling search the key runs there. Window cores and the
 * reference compiles run without one.
 */
export function withDocumentSearchBudget<T>(core: DocumentCore, compile: () => T): T {
  if (documentSearchBudgets.has(core)) return compile()
  documentSearchBudgets.set(core, { spent: 0 })
  try {
    return compile()
  } finally {
    documentSearchBudgets.delete(core)
  }
}

/** Whether the key compiling in `core` stopped a spelling search at its budget. */
export function documentSearchExhausted(core: DocumentCore): boolean {
  return documentSearchBudgets.get(core)?.exhausted === true
}

/** Compiles within a key's budget as though it had none. */
export function withoutDocumentSearchBudget<T>(core: DocumentCore, compile: () => T): T {
  const outer = documentSearchBudgets.get(core)
  documentSearchBudgets.set(core, { spent: Number.NEGATIVE_INFINITY })
  try {
    return compile()
  } finally {
    if (outer === undefined) documentSearchBudgets.delete(core)
    else documentSearchBudgets.set(core, outer)
  }
}

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

type Variant = 'exact' | 'pair' | 'reversed' | 'padded' | 'padded-pair' | 'shifted' | 'escaped'

/**
 * Widen an operation whose inline suggestion changes meaning into a
 * Substitution over the smallest retained span whose parse changes. Its old
 * arm is the retained source and its new arm the untracked result, so
 * Accept/Reject reproduce those exact bytes by construction.
 */
const BEST_EFFORT = new WeakSet<DocumentCore>()

/**
 * Runs a tracked compile that, as a last resort, keeps a spelling only Accept
 * All and Reject All read as the operation (see `widenedTrackedSourceEdit`).
 */
export function withBestEffortSpelling<T>(core: DocumentCore, compile: () => T): T {
  BEST_EFFORT.add(core)
  try {
    return compile()
  } finally {
    BEST_EFFORT.delete(core)
  }
}

/**
 * Widened spellings found per revision and untracked edit: one key reaches
 * the search from several compile paths (the edit, its literal's owner,
 * structure scope), and each search previews many candidates.
 */
const widenedSpellings = new WeakMap<DocumentRevision, Map<string, DocumentSourceEdit | null>>()

export function widenedTrackedSourceEdit(
  core: DocumentCore,
  previous: DocumentRevision,
  oracle: TrackedOracle
): DocumentSourceEdit | undefined {
  let found = widenedSpellings.get(previous)
  if (found === undefined) {
    found = new Map()
    widenedSpellings.set(previous, found)
  }
  const key = (BEST_EFFORT.has(core) ? 'whole ' : '') + JSON.stringify(oracle.untracked)
  const known = plansFromGeneralCompile(core) ? undefined : found.get(key)
  const spelled = known !== undefined ? known ?? undefined : searchWidenedSpelling(core, previous, oracle)
  if (known === undefined) found.set(key, spelled ?? null)
  // A widened spelling reaching a window's edge may need text beyond it,
  // which the whole document's readings decide.
  // The span the document's reading change derives is the document's own,
  // which a window holding that change spells as the document would;
  // any other spelling reaching a window edge may need text beyond it.
  const span = spelled === undefined ? undefined : spellingSpans.get(spelled)
  const reached = spelled === undefined
    ? undefined
    : derivedSpellings.has(spelled)
      ? reachesOpenWindowEdge(core, spelled, previous.sourceLength)
      : reachesWindowEdge(core, spelled, previous.sourceLength) ??
        (span === undefined ? undefined : reachesOpenWindowEdge(core, span, previous.sourceLength))
  if (reached !== undefined) {
    markUnresolvedDraft(core, reached)
  }
  return spelled
}

function searchWidenedSpelling(
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
  // An opener before a block that interrupts the paragraph above it joins
  // that paragraph's last line, where backticks before it can pair with the
  // block's own as inline code: the paragraph is retained with the block.
  const blocks = syntax.ast.root.children
  const holder = blocks.findIndex(node => syntax.coordinates.toSource(node.range.start, 'next') <= base.start &&
    base.end <= syntax.coordinates.toSource(node.range.end, 'previous'))
  const above = blocks[holder - 1]
  const held = blocks[holder]
  if (above?.kind === 'paragraph' && held !== undefined) {
    const start = syntax.coordinates.toSource(above.range.start, 'next')
    const heldStart = syntax.coordinates.toSource(held.range.start, 'next')
    const between = source.slice(syntax.coordinates.toSource(above.range.end, 'previous'), heldStart)
    if (!/(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/u.test(between)) {
      spans.push(lineAligned({ start, end: syntax.coordinates.toSource(held.range.end, 'previous') }))
    }
  }
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
  // The change a key makes to the document's reading: a window is given the
  // document's own; a document reads it off its parses before and after.
  const typed = typedKeys.get(core)
  const changed = typed?.previous !== previous
    ? undefined
    : isWindowCompileCore(core)
      ? documentReadingChanges.get(core)
      : source.length <= DERIVED_SPELLING_UNITS && derivesSpelling(source, typed.edit, typed.edit.insert)
        ? (() => {
          const structure = trackedPreviewFacts.get(oracle.preview([typed.edit]))?.structure
          return structure === undefined
            ? undefined
            : readingChange(trackedStructure(syntax.ast.root, syntax.coordinates), structure(), typed.edit,
              typed.edit.insert.length - (typed.edit.end - typed.edit.start))
        })()
        : undefined
  // A change within the lines the edit touches is the search's to spell
  // narrowly; one reaching other lines, as a fence it breaks, is spelled
  // over those lines whole.
  const derivedSpan = (): SourceRange | undefined => {
    const touched = lineAligned(base)
    if (changed === undefined || (touched.start <= changed.start && changed.end <= touched.end)) return undefined
    // Whole lines, but not the line break ending the last: a suggestion's
    // closer stays on the line it ends, as the search spells it.
    const lines = lineAligned(changed)
    const content = lines.end > lines.start && /[\r\n]/u.test(source[lines.end - 1] ?? '') && lines.end - 1 > changed.end
      ? { start: lines.start, end: lines.end - (source.slice(lines.end - 2, lines.end) === '\r\n' ? 2 : 1) }
      : lines
    const safe = annotationSafe(annotations, whole(content))
    return insideHistory(annotations, safe) || cuts(safe.start, safe.end) ? undefined : safe
  }

  const spell = (old: string, next: string, variant: Variant, atLineEnd: boolean): string | undefined => {
    if (variant === 'escaped') {
      const oldEscape = trailingBackslashes(old) % 2 === 1 ? '\\' : ''
      const nextEscape = trailingBackslashes(next) % 2 === 1 ? '\\' : ''
      if (oldEscape === '' && nextEscape === '') return undefined
      old += oldEscape
      next += nextEscape
    }
    if (variant === 'padded' || variant === 'padded-pair' || variant === 'shifted') {
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
    if (variant === 'pair' || variant === 'padded-pair' || variant === 'reversed') {
      // A literal opener in one arm could pair across the divider; separate
      // annotations give each side its own closer, in either order.
      if (old.length === 0 || next.length === 0) return undefined
      return variant === 'reversed' ? `{++${next}++}{--${old}--}` : `{--${old}--}{++${next}++}`
    }
    if (old.length === 0) return `{++${next}++}`
    // A retained `--}` would close a Deletion; a Substitution with an empty
    // new arm deletes it exactly.
    if (next.length === 0) return old.includes('--}') ? `{~~${old}~>~~}` : `{--${old}--}`
    return `{~~${old}~>${next}~~}`
  }
  let weighed = 0
  const budget = documentSearchBudgets.get(core)
  let budgetSpent = false
  let closestOnly = false
  // While set, the closest spelling over a span narrower than the document
  // leaves no marker unpaired that the document did not (owner decision,
  // 8 October 2026: a budgeted outcome adds no diagnostic).
  let addsNoDiagnostic = false
  let weighedClosest = 0
  // `bytes`: Accept All and Reject All need only splice exactly, however the
  // pending suggestions read.
  const attempt = (span: SourceRange, prefix: number, suffix: number, variant: Variant, equivalence: TrackedEquivalence,
    whole = false, bytes = false): DocumentSourceEdit | undefined => {
    const mapped = toTarget(span)
    const old = source.slice(span.start + prefix, span.end - suffix)
    const next = target.slice(mapped.start + prefix, mapped.end - suffix)
    if (old === next) return undefined
    const start = span.start + prefix
    const end = span.end - suffix
    // Exact resolution alone may leave a literal's last lines outside.
    if (!bytes && cuts(start, end)) return undefined
    const atLineEnd = end === source.length || source[end] === '\n' || source[end] === '\r'
    const insert = spell(old, next, variant, atLineEnd)
    if (insert === undefined) return undefined
    const edit = Object.freeze({ start, end, insert })
    // A search weighs at most so many spellings that read alike while
    // pending; one finding none by then goes on to the spellings that only
    // resolve exactly, as one finding none at all does.
    if (!whole && !bytes && (weighed += 1) > WIDENED_SPELLINGS_WEIGHED) return undefined
    // A spelling past the key's budget is not weighed; the closest one,
    // which only needs to resolve exactly, is weighed once the search stops.
    if (budget !== undefined && !closestOnly) {
      if (budgetSpent || budget.spent + source.length > DOCUMENT_SEARCH_UNITS) {
        budgetSpent = true
        budget.exhausted = true
        return undefined
      }
      budget.spent += source.length
    }
    if (recordedExactly.has(oracle) && !bytes) return undefined
    if (bytes ? !oracle.resolvesExactly([edit]) : !oracle.accepts([edit], equivalence, whole)) return undefined
    const candidate = oracle.preview([edit])
    // A tracked edit spells only whole suggestions; one that leaves a marker
    // unpaired beyond those the untracked edit leaves is no spelling of it.
    // A key spelled as the source edit it is (see `spelledAsSource`) takes
    // no spelling that leaves a marker unpaired, however it resolves, unless
    // it is recorded exactly (see `recordedExactly`).
    if (!recordedExactly.has(oracle) && (spelledAsSource.has(oracle) || addsNoDiagnostic
      ? candidate.diagnostics.length > previous.diagnostics.length
      : !bytes && candidate.diagnostics.length > Math.max(previous.diagnostics.length, oracle.preview(untracked).diagnostics.length))) return undefined
    const authored = markupAnnotations(candidate.annotations).find(annotation =>
      annotation.range.end === start + insert.length && annotation.range.start >= start)
    return authored === undefined ? undefined : edit
  }
  const trimmed = (span: SourceRange, variant: Variant, equivalence: TrackedEquivalence, whole = false,
    bytes = false): DocumentSourceEdit | undefined => {
    const found = attempt(span, 0, 0, variant, equivalence, whole, bytes)
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
    const [prefix, afterPrefix] = largest(prefixes, value => value === 0 ? found : attempt(span, value, 0, variant, equivalence, whole, bytes), found)
    const rest = Math.min(old.length, next.length) - prefix
    let suffixCommon = 0
    while (suffixCommon < rest && old[old.length - 1 - suffixCommon] === next[next.length - 1 - suffixCommon]) suffixCommon += 1
    const suffixes = boundaries(suffixCommon, index => old[index], true)
    const spelled = largest(suffixes, value => value === 0 ? afterPrefix : attempt(span, prefix, value, variant, equivalence, whole, bytes), afterPrefix)[1]
    spellingSpans.set(spelled, span)
    return spelled
  }
  // A span enclosing an existing annotation repeats it in both arms; prefer
  // spans of plain source even at the cost of a rendering-identical spelling.
  const encloses = (span: SourceRange): boolean => annotations.some(annotation =>
    span.start <= annotation.range.start && annotation.range.end <= span.end)
  // The span the edit changes the reading of, as its blocks and literals
  // show, is spelled before the wider spans are searched shortest first:
  // one preview usually proves it. The search reaches a short span's other
  // spellings soon enough itself.
  const derived = derivedSpan()
  const spellDerived = (): DocumentSourceEdit | undefined => {
    if (derived === undefined) return undefined
    const soon = candidates.slice(0, 3).some(span => span.start === derived.start && span.end === derived.end)
    for (const variant of soon ? ['exact'] as const : ['exact', 'pair', 'reversed'] as const) {
      const edit = attempt(derived, 0, 0, variant, 'exact')
      if (edit !== undefined) {
        derivedSpellings.add(edit)
        return edit
      }
    }
    return undefined
  }
  // Spans within the lines the edit touches are weighed first, as the
  // narrowest; then the derived span, before the wider spans.
  if (derived !== undefined) {
    const touched = lineAligned(base)
    const near = candidates.filter(span => touched.start <= span.start && span.end <= touched.end)
    for (const enclosing of [false, true]) {
      for (const variant of ['exact', 'pair', 'reversed'] as const) {
        for (const span of near.filter(candidate => encloses(candidate) === enclosing)) {
          const edit = trimmed(span, variant, 'exact')
          if (edit !== undefined) return edit
        }
      }
    }
    const edit = spellDerived()
    if (edit !== undefined) return edit
  }
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
  // A key past its budget takes the closest spelling whose Accept All and
  // Reject All read as the operation: of the edit itself, of the lines it
  // touches, of the shortest spans holding those, or at last of the whole
  // document.
  // Whole lines common to both readings at either end may stay outside.
  const lineTrims = (old: string, next: string, fromEnd: boolean): number[] => {
    const trims = [0]
    for (let length = 1; length <= Math.min(old.length, next.length); length += 1) {
      const a = fromEnd ? old[old.length - length] : old[length - 1]
      if (a !== (fromEnd ? next[next.length - length] : next[length - 1])) break
      const boundary = fromEnd ? old[old.length - length - 1] : a
      if (boundary === '\n' || boundary === '\r') trims.push(length)
    }
    return trims.reverse().slice(0, 8)
  }
  const budgetGone = (): boolean => {
    if (budget === undefined || !(budgetSpent || budget.spent + source.length > DOCUMENT_SEARCH_UNITS)) return false
    budget.exhausted = true
    return true
  }
  // A spelling over `span` that resolves to the operation's bytes, with the
  // whole lines common to both readings at either end left outside.
  const exactly = (span: SourceRange, variant: Variant): DocumentSourceEdit | undefined => {
    const mapped = toTarget(span)
    const old = source.slice(span.start, span.end)
    const next = target.slice(mapped.start, mapped.end)
    for (const suffix of lineTrims(old, next, true)) {
      for (const prefix of lineTrims(old.slice(0, old.length - suffix), next.slice(0, next.length - suffix), false)) {
        const edit = attempt(span, prefix, suffix, variant, 'exact', true, true)
        if (edit !== undefined) return edit
      }
    }
    return undefined
  }
  const closestSpelling = (): DocumentSourceEdit | undefined => {
    closestOnly = true
    const whole = { start: 0, end: source.length }
    const spans: SourceRange[] = []
    const tried = new Set<string>([`${whole.start}:${whole.end}`])
    // A document one candidate's parse exceeds the budget for is spelled
    // over its whole text at once, as few parses as that takes.
    const narrower = source.length > DOCUMENT_SEARCH_UNITS
      ? []
      : [base, lineAligned(base), ...candidates.filter(span => span.start <= base.start && base.end <= span.end)]
    for (const span of narrower) {
      const key = `${span.start}:${span.end}`
      if (tried.has(key)) continue
      tried.add(key)
      spans.push(span)
    }
    // As the search's last stages weigh them: spellings whose Accept All and
    // Reject All read as the operation over each span, narrowest first, then
    // those resolving to the operation's bytes; the whole document is always
    // weighed, last.
    addsNoDiagnostic = true
    try {
      for (const bytes of [false, true]) {
        weighedClosest = 0
        for (const span of spans) {
          for (const variant of ['pair', 'reversed', 'exact'] as const) {
            if ((weighedClosest += 1) > CLOSEST_SPELLINGS_WEIGHED) break
            const edit = bytes ? exactly(span, variant) : trimmed(span, variant, 'exact', true)
            if (edit !== undefined) return edit
          }
        }
      }
    } finally {
      addsNoDiagnostic = false
    }
    // Over the whole document, the lines both readings share at either end
    // stay outside, as at the search's last stage.
    for (const variant of ['pair', 'reversed', 'exact'] as const) {
      const edit = exactly(whole, variant)
      if (edit !== undefined) return edit
    }
    for (const variant of ['pair', 'reversed', 'exact'] as const) {
      const edit = attempt(whole, 0, 0, variant, 'exact', true)
      if (edit !== undefined) return edit
    }
    return undefined
  }
  if (!BEST_EFFORT.has(core)) return budgetGone() ? closestSpelling() : undefined
  if (budgetGone()) return closestSpelling()
  // Typing is never refused. Where no spelling lets each suggestion resolve
  // alone (an unclosed fence ending the document holds a closer either arm
  // would read as its own), the spelling Accept All and Reject All read as the
  // operation is kept, whatever resolving one side alone leaves (Profile 2
  // syntax limit). Only a compile that found nothing else asks for it.
  for (const variant of ['pair', 'reversed', 'exact'] as const) {
    for (const span of candidates) {
      const edit = trimmed(span, variant, 'exact', true)
      if (edit !== undefined) return edit
    }
  }
  // Exact resolution outranks reading alike while pending: a closer left
  // outside the suggestion (as an unclosed fence's last `~~}` line, which no
  // arm can hold without a line break of its own) reads as text until the
  // suggestion resolves.
  for (const variant of ['exact', 'pair', 'reversed'] as const) {
    for (const span of candidates) {
      const mapped = toTarget(span)
      const old = source.slice(span.start, span.end)
      const next = target.slice(mapped.start, mapped.end)
      for (const suffix of lineTrims(old, next, true)) {
        for (const prefix of lineTrims(old.slice(0, old.length - suffix), next.slice(0, next.length - suffix), false)) {
          const edit = attempt(span, prefix, suffix, variant, 'exact', true, true)
          if (edit !== undefined) return edit
        }
      }
    }
  }
  for (const variant of ['pair', 'reversed', 'exact', 'padded-pair', 'padded'] as const) {
    for (const span of candidates) {
      const edit = trimmed(span, variant, 'rendering', true)
      if (edit !== undefined) return edit
    }
  }
  // Typing is never refused (vision principle 7): a key no spelling above
  // holds takes its closest one, at last over the whole document.
  return closestSpelling()
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
    const facts = trackedPreviewFacts.get(candidate)
    if (facts === undefined) return undefined
    const added = markupAnnotations(candidate.annotations).some(annotation => annotation.kind === 'addition' &&
      annotation.arms.some(arm => candidate.source.slice(arm.range.start, arm.range.end) === payload))
    if (byResolution) {
      if (added && payload === text && candidate.diagnostics.length <= previous.diagnostics.length &&
          resolvedSuggestions(candidate.source, candidate.annotations, 'reject') === rejected() &&
          keepsTyping(resolvedSuggestions(candidate.source, candidate.annotations, 'accept'), accepted(), text)) return widen(edit)
      continue
    }
    // Weighing by the views, the plain typing at the split shows the Revised
    // view the split must keep; weighing by resolution never reads it.
    if (!added || candidate.diagnostics.length !== previous.diagnostics.length || facts.original !== original) continue
    const expectedFacts = trackedPreviewFacts.get(preview([widen(plain)]))
    if (expectedFacts === undefined) return undefined
    if (payload !== text || facts.revised === expectedFacts.revised) return widen(edit)
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
 * The kind of the top-level block literal starting at an arm's start whose
 * text reaches `end`, the arm's end before its final line break: the arm's
 * whole text, which the arm boundary ends if the block does not.
 */
function armBlockLiteral(core: DocumentCore, revision: DocumentRevision, start: number, end: number): string | undefined {
  const { ast, coordinates } = core.project(revision, 'markup').syntax
  return ast.root.children.find(node => ARM_BLOCK_LITERAL_KINDS.has(node.kind) &&
    coordinates.toSource(node.range.start, 'next') === start && coordinates.toSource(node.range.end, 'previous') >= end)?.kind
}

const ARM_BLOCK_LITERAL_KINDS = new Set([...BLOCK_LITERAL_KINDS, 'html-block'])

/** The openers of the HTML blocks a line other than a blank one ends (CommonMark kinds 1-5). */
const RAW_HTML_OPENER = /^ {0,3}(?:<(?:script|pre|style|textarea)(?:\s|>|$)|<!--|<\?|<![A-Za-z]|<!\[CDATA\[)/iu

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
  // A block literal that is the arm's whole text reads every line after its
  // first as its text in the Revised view (L2c). Acceptance can read the
  // block itself otherwise (a `$$` block cannot interrupt a paragraph before
  // the suggestion, so it reads inline), which no change to the acceptance
  // matches: an edit there that spells no line ending the block (a fence or
  // `$$` line; a blank line, for an HTML block that one ends) is the same
  // edit in the arm.
  const openerEnd = armText.search(EOL)
  const opener = openerEnd < 0 ? '' : armText.slice(0, openerEnd)
  // Indented code has no opener line: every line is its text.
  const indented = /^(?: {4}|\t)/u.test(armText)
  const literal = openerEnd >= 0 && (local.start > openerEnd || indented)
    ? armBlockLiteral(core, previous, arm.range.start, arm.range.end - (/(?:\r\n|\r|\n)$/u.exec(armText)?.[0].length ?? 0))
    : undefined
  const typedLines = editedLines(typedArm, local.start, local.start + edit.insert.length)
  const inArmLiteral = literal === 'html-block'
    ? !RAW_HTML_OPENER.test(opener) && !typedLines.some(line => line.trim() === '')
    : literal === 'code-block' && indented
      // Lines that keep their indentation stay its text; markers there read as markers.
      ? typedLines.every(line => line.trim() === '' || /^(?: {4}|\t)/u.test(line)) && !/\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\{==|==\}|\{>>|<<\}/u.test(edit.insert)
      : literal !== undefined && delimiterLine(opener) && !onDelimiterLine
  if (onDelimiterLine || joinsFenceLine || inArmLiteral) {
    const extended = preview([edit])
    const grown = edit.insert.length - (edit.end - edit.start)
    // A line the edit spells can still end the block in the arm (a blank
    // line ends a `$$` block there), making its text read as suggestions.
    if (markupAnnotations(extended.annotations).some(annotation => annotation.kind === owner.kind &&
      annotation.range.start === owner.range.start && annotation.range.end === owner.range.end + grown &&
      (!inArmLiteral || annotation.arms.every((arm, index) => arm.annotations.length === owner.arms[index]?.annotations.length)))) {
      return Object.freeze({ ...edit })
    }
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
  if (changesAcceptanceAlike(owner, armText, edit, accepted, preview)) return Object.freeze({ ...edit })
  // Typing in one's own draft is the edit in the arm (Google Docs). Words,
  // spaces and line breaks pair with nothing, so where the arm reads them
  // into its blocks otherwise than its acceptance does, that reading is the
  // draft's layout, not a spelling the edit chooses: the edit stays as typed
  // while the suggestion holds it whole. Typed delimiters keep the compile.
  if (/^[\p{L}\p{N} \t\r\n]*$/u.test(edit.insert) && /^[\p{L}\p{N} \t\r\n]*$/u.test(core.sourceSlice(previous, edit))) {
    const typed = preview([edit])
    const grown = edit.insert.length - (edit.end - edit.start)
    if (markupAnnotations(typed.annotations).some(annotation => annotation.kind === owner.kind &&
      annotation.range.start === owner.range.start && annotation.range.end === owner.range.end + grown &&
      annotation.arms.every((part, index) => part.annotations.length === owner.arms[index]?.annotations.length))) {
      return Object.freeze({ ...edit })
    }
  }
  // Text after the draft that the accepted draft would absorb (an unclosed
  // fence) joins one Substitution whose new arm is that accepted text.
  return widenedTrackedSourceEdit(core, previous, oracle)
}

/**
 * Whether an edit in one's own draft changes its Revised view as it changes
 * the draft's untracked acceptance, where that acceptance already reads
 * otherwise before the edit: text the arm boundary ends, as a paragraph or
 * block literal closing the arm, joins what follows the suggestion once
 * accepted. That reading is the draft's, not the edit's, so the edit in the
 * arm is the same edit; delimiters typed there that pair otherwise once the
 * boundary is gone change the two readings differently.
 */
function changesAcceptanceAlike(
  owner: CriticMarkupAnnotation,
  armText: string,
  edit: DocumentSourceEdit,
  accepted: readonly DocumentSourceEdit[],
  preview: Preview
): boolean {
  const facts = (edits: readonly DocumentSourceEdit[]) => trackedPreviewFacts.get(preview(edits))
  const typed = facts([edit])
  const before = facts([])
  const acceptedBefore = facts([Object.freeze({ ...owner.range, insert: armText })])
  const acceptedAfter = facts(accepted)
  if (typed === undefined || before === undefined || acceptedBefore === undefined || acceptedAfter === undefined ||
      before.revised === acceptedBefore.revised || typed.original !== before.original) return false
  const grown = edit.insert.length - (edit.end - edit.start)
  return markupAnnotations(preview([edit]).annotations).some(annotation => annotation.kind === owner.kind &&
      annotation.range.start === owner.range.start && annotation.range.end === owner.range.end + grown) &&
    sameChange(before.revised, typed.revised, acceptedBefore.revised, acceptedAfter.revised) &&
    sameChange(before.revisedView(), typed.revisedView(), acceptedBefore.revisedView(), acceptedAfter.revisedView())
}

function sameChange(before: string, after: string, acceptedBefore: string, acceptedAfter: string): boolean {
  const change = changeBetween(before, after)
  return change !== undefined && change === changeBetween(acceptedBefore, acceptedAfter)
}

/**
 * Source units of an edit in one's own draft that a regional planner may
 * spell as typed. Each reading compared spells a unit in a few places, a few
 * characters each, so an edit this size changes it by far fewer than
 * `COMPARED_CHANGE_LIMIT` characters and the comparison always decides it;
 * a larger edit is left to the compile, as the document weighs it.
 */
export const OWN_DRAFT_SHORTCUT_UNITS = 32

/** Changed characters past which two readings' changes are not compared. */
const COMPARED_CHANGE_LIMIT = 32 * OWN_DRAFT_SHORTCUT_UNITS

/**
 * The changes turning `before` into `after`, as the removed and inserted text
 * of each, in order: one edit can change several readings of the same text
 * (a block's content and its text nodes). Undefined past
 * `COMPARED_CHANGE_LIMIT` changed characters, where the edit is weighed as
 * any other.
 */
function changeBetween(before: string, after: string): string | undefined {
  let start = 0
  const limit = Math.min(before.length, after.length)
  while (start < limit && before[start] === after[start]) start += 1
  let end = 0
  while (end < limit - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1
  const a = before.slice(start, before.length - end)
  const b = after.slice(start, after.length - end)
  // Myers' shortest edit script, bounded.
  const max = Math.min(a.length + b.length, COMPARED_CHANGE_LIMIT)
  const offset = max + 1
  const trace: Int32Array[] = []
  const frontier = new Int32Array(2 * max + 3)
  let found = -1
  for (let d = 0; d <= max && found < 0; d += 1) {
    trace.push(frontier.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (frontier[offset + k - 1] ?? 0) < (frontier[offset + k + 1] ?? 0))
        ? frontier[offset + k + 1] ?? 0
        : (frontier[offset + k - 1] ?? 0) + 1
      let y = x - k
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x += 1
        y += 1
      }
      frontier[offset + k] = x
      if (x >= a.length && y >= b.length) {
        found = d
        break
      }
    }
  }
  if (found < 0) return undefined
  // Walk back from the end, collecting each run of removals and insertions.
  const hunks: Array<[string, string]> = []
  let x = a.length
  let y = b.length
  let removed = ''
  let inserted = ''
  for (let d = found; d > 0; d -= 1) {
    const v = trace[d] ?? frontier
    const k = x - y
    const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
    const previousK = down ? k + 1 : k - 1
    const previousX = v[offset + previousK] ?? 0
    const previousY = previousX - previousK
    const snakeX = down ? previousX : previousX + 1
    if (x > snakeX && (removed !== '' || inserted !== '')) {
      hunks.push([removed, inserted])
      removed = ''
      inserted = ''
    }
    if (down) inserted = (b[previousY] ?? '') + inserted
    else removed = (a[previousX] ?? '') + removed
    x = previousX
    y = previousY
  }
  if (removed !== '' || inserted !== '') hunks.push([removed, inserted])
  return JSON.stringify(hunks.reverse())
}

import type { SourceSnapshot } from './sourceSnapshot.js'
import { createSourceSnapshot } from './sourceSnapshot.js'
import type {
  CompleteDocumentRevision,
  DocumentRevision,
  MarkdownLineIndex,
  MarkdownNode,
  MarkdownPhysicalLine,
  MarkupProjection,
  NodeId,
  ParseConfiguration,
  Profile1SyntaxGraph,
  ProjectedCodeUnitOrigin,
  ProjectedMarkdown,
  SourceOffset
} from './revision.js'
import {
  createProfile1DocumentReuseCache,
  inspectProfile1ChangedCriticMarkerJoins,
  parseProfile1Document
} from './internal/profile1Document.js'
import { activeProfileParseTraceRecorderV1 } from './internal/profileParseTraceV1.js'
import { validateAndFreezeParseConfiguration } from './configuration.js'
import {
  reopenSourceHashV1WithCache,
  revisionSemanticHashV1,
  sourceHashV1WithCache,
  type SourceHashCacheV1
} from './hashCodec.js'
import {
  createParseExecutionAccumulator,
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  type ParseExecutionAccumulator,
  type ParseExecutionControl
} from './parseExecutionControl.js'
import {
  recordForkAstRegionReuseV1
} from './internal/profile1/physicalTraversalAccounting.js'
import {
  cacheCertifiedSimpleTextDocumentFacts,
  certifySimpleTextDocumentFacts
} from './materialize/documentFacts.js'
import { applyExactSourceEdits } from './exactSourceEdits.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'

type LanguageEngineChangedJoinInspection =
  | Readonly<{
    readonly kind: 'inspected'
    readonly protectionPositions: readonly number[]
  }>
  | Readonly<{
    readonly kind: 'source-only'
    readonly fatalDiagnostic: Extract<
      DocumentRevision,
      { readonly kind: 'source-only' }
    >['fatalDiagnostic']
  }>

export interface LanguageEngine {
  open(
    source: SourceSnapshot,
    configuration: ParseConfiguration,
    executionControl?: ParseExecutionControl
  ): DocumentRevision
  reopen(
    previous: DocumentRevision,
    source: SourceSnapshot,
    edits: readonly LanguageEngineSourceEdit[],
    executionControl?: ParseExecutionControl
  ): DocumentRevision
  /**
   * Parser-owned recognition of which changed joins became CriticMarkup
   * syntax. Declared here rather than reached through a side channel so
   * syntax-decision ownership is derivable from the module graph.
   */
  inspectChangedCriticMarkerJoins(
    source: SourceSnapshot,
    configuration: ParseConfiguration,
    joins: readonly number[],
    executionControl?: ParseExecutionControl
  ): LanguageEngineChangedJoinInspection
  /**
   * Allocate one internal stage on the engine's production execution stream,
   * so session-owned work outside the parser exposes no second cancellation
   * or progress authority.
   */
  nextExecutionStage(): ParseExecutionControl | undefined
}

export interface LanguageEngineSourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

interface CertifiedSimpleTextShape {
  readonly terminalPeriod: boolean
}

function isCertifiedSimpleTextRevision(
  revision: CompleteDocumentRevision,
  simpleTextIdentity: boolean
): boolean {
  if (
    !simpleTextIdentity ||
    revision.source.text.length === 0 ||
    revision.criticMarkup.rootCount !== 0 ||
    revision.diagnostics.count !== 0 ||
    revision.markup.runCount !== 1 ||
    revision.ownership.count !== 1 ||
    revision.syntax.nodeCount !== 4 ||
    revision.syntax.edgeCount !== 3
  ) {
    return false
  }
  const markup = revision.markup.runAt(0)
  const ownership = revision.ownership.at(0)
  const projection = revision.projection('editing')
  const root = projection.markdown.root
  const paragraph = root.childCount === 1 ? root.childAt(0) : undefined
  const text = paragraph?.childCount === 1
    ? paragraph.childAt(0)
    : undefined
  return markup.text === revision.source.text &&
    markup.sourceRange.start === 0 &&
    markup.sourceRange.end === revision.source.text.length &&
    markup.marks.length === 0 &&
    ownership.range.start === 0 &&
    ownership.range.end === revision.source.text.length &&
    ownership.owner.kind === 'markdown-text' &&
    projection.source === revision.source.text &&
    projection.markdown.source === revision.source.text &&
    root.kind === 'document' &&
    root.range.start === 0 &&
    root.range.end === revision.source.text.length &&
    paragraph?.kind === 'paragraph' &&
    paragraph.range.start === 0 &&
    paragraph.range.end === revision.source.text.length &&
    text?.kind === 'text' &&
    text.range.start === 0 &&
    text.range.end === revision.source.text.length
}

function isAsciiAlphanumeric(codeUnit: number): boolean {
  return (
    (codeUnit >= 48 && codeUnit <= 57) ||
    (codeUnit >= 65 && codeUnit <= 90) ||
    (codeUnit >= 97 && codeUnit <= 122)
  )
}

function isAsciiLetter(codeUnit: number): boolean {
  return (
    (codeUnit >= 65 && codeUnit <= 90) ||
    (codeUnit >= 97 && codeUnit <= 122)
  )
}

function certifiedSimpleTextShapeAfterEdits(
  previousLength: number,
  previousShape: CertifiedSimpleTextShape,
  nextLength: number,
  nextFirstCodeUnit: number,
  edits: readonly LanguageEngineSourceEdit[]
): CertifiedSimpleTextShape | undefined {
  if (edits.length === 0) return undefined
  let insertedUnits = 0
  for (const edit of edits) {
    insertedUnits += edit.insert.length
    if (
      !Number.isSafeInteger(insertedUnits) ||
      insertedUnits > PARSE_SOURCE_CHECKPOINT_INTERVAL
    ) {
      return undefined
    }
  }

  const previousPeriod = previousShape.terminalPeriod
    ? previousLength - 1
    : undefined
  let previousOffset = 0
  let outputOffset = 0
  let periodCount = 0
  let periodPosition = -1
  const appendPrevious = (start: number, end: number): void => {
    if (
      previousPeriod !== undefined &&
      previousPeriod >= start &&
      previousPeriod < end
    ) {
      periodCount += 1
      periodPosition = outputOffset + previousPeriod - start
    }
    outputOffset += end - start
  }

  for (const edit of edits) {
    appendPrevious(previousOffset, edit.start)
    for (let offset = 0; offset < edit.insert.length; offset += 1) {
      const codeUnit = edit.insert.charCodeAt(offset)
      if (isAsciiAlphanumeric(codeUnit)) continue
      if (codeUnit !== 46) return undefined
      periodCount += 1
      periodPosition = outputOffset + offset
      if (periodCount > 1) return undefined
    }
    outputOffset += edit.insert.length
    previousOffset = edit.end
  }
  appendPrevious(previousOffset, previousLength)
  if (
    outputOffset !== nextLength ||
    periodCount > 1 ||
    (periodCount === 1 && periodPosition !== nextLength - 1) ||
    (periodCount === 1 && !isAsciiLetter(nextFirstCodeUnit)) ||
    nextLength - periodCount < 1
  ) {
    return undefined
  }
  return Object.freeze({ terminalPeriod: periodCount === 1 })
}

function sourceOffset(value: number): SourceOffset {
  return value as SourceOffset
}

function sourceRange(start: number, end: number) {
  return Object.freeze({ start: sourceOffset(start), end: sourceOffset(end) })
}

function createSimpleTextMarkdownNode(
  nodeId: NodeId,
  kind: 'document' | 'paragraph' | 'text',
  length: number,
  children: readonly MarkdownNode[]
): MarkdownNode {
  const stableChildren = Object.freeze([...children])
  const node = {
    kind,
    range: Object.freeze({ start: 0, end: length }),
    attributes: Object.freeze({}),
    childCount: stableChildren.length,
    childAt: Object.freeze((ordinal: number): MarkdownNode => {
      const child = Number.isInteger(ordinal)
        ? stableChildren[ordinal]
        : undefined
      if (child === undefined) {
        throw new RangeError('Markdown child ordinal is outside the node')
      }
      return child
    })
  }
  Object.defineProperty(node, 'nodeId', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: nodeId
  })
  return Object.freeze(node) as MarkdownNode
}

/**
 * Physical lines of a certified simple-text document, computed lazily: the
 * certificate proves the source holds no block structure, so every line's
 * content begins at its start — there are no container prefixes to consume.
 */
function simpleTextLineIndex(text: string): MarkdownLineIndex {
  let computed: readonly MarkdownPhysicalLine[] | undefined
  const compute = (): readonly MarkdownPhysicalLine[] => {
    const lines: MarkdownPhysicalLine[] = []
    let start = 0
    while (start <= text.length) {
      const breakMatch = /\r\n|\r|\n/.exec(text.slice(start))
      if (breakMatch === null || breakMatch.index === undefined) {
        if (start < text.length) {
          lines.push(Object.freeze({
            start,
            contentOffset: start,
            contentEnd: text.length,
            end: text.length,
            blank: text.slice(start).trim() === ''
          }))
        }
        break
      }
      const contentEnd = start + breakMatch.index
      const end = contentEnd + breakMatch[0].length
      lines.push(Object.freeze({
        start,
        contentOffset: start,
        contentEnd,
        end,
        blank: text.slice(start, contentEnd).trim() === ''
      }))
      start = end
    }
    return Object.freeze(lines)
  }
  return Object.freeze({
    get count(): number {
      computed ??= compute()
      return computed.length
    },
    at: Object.freeze((ordinal: number): MarkdownPhysicalLine => {
      computed ??= compute()
      const line = Number.isInteger(ordinal) ? computed[ordinal] : undefined
      if (line === undefined) {
        throw new RangeError(
          `Markdown line ordinal is outside the document: ${String(ordinal)}`
        )
      }
      return line
    })
  })
}

function reuseCertifiedSimpleTextRevision(
  previous: CompleteDocumentRevision,
  source: SourceSnapshot,
  sourceHash: CompleteDocumentRevision['sourceHash'],
  semanticHash: CompleteDocumentRevision['semanticHash'],
  configuration: ParseConfiguration
): CompleteDocumentRevision {
  const previousProjection = previous.projection('editing')
  const previousRoot = previousProjection.markdown.root
  const previousParagraph = previousRoot.childAt(0)
  const previousText = previousParagraph.childAt(0)
  const length = source.text.length
  const text = createSimpleTextMarkdownNode(
    previousText.nodeId,
    'text',
    length,
    Object.freeze([])
  )
  const paragraph = createSimpleTextMarkdownNode(
    previousParagraph.nodeId,
    'paragraph',
    length,
    Object.freeze([text])
  )
  const root = createSimpleTextMarkdownNode(
    previousRoot.nodeId,
    'document',
    length,
    Object.freeze([paragraph])
  )
  const path = Object.freeze([root, paragraph, text])
  const markdown = Object.freeze({
    source: source.text,
    root,
    references: previousProjection.markdown.references,
    headings: previousProjection.markdown.headings,
    lines: simpleTextLineIndex(source.text),
    nodeAt: Object.freeze((
      projectedOffset: number,
      affinity: 'previous' | 'next'
    ): readonly MarkdownNode[] => {
      if (
        !Number.isInteger(projectedOffset) ||
        projectedOffset < 0 ||
        projectedOffset > length
      ) {
        throw new RangeError(
          'Projected Markdown position is outside the document'
        )
      }
      if (affinity !== 'previous' && affinity !== 'next') {
        throw new RangeError(
          `Unknown projected Markdown affinity: ${String(affinity)}`
        )
      }
      return (
        (projectedOffset === 0 && affinity === 'previous') ||
        (projectedOffset === length && affinity === 'next')
      )
        ? Object.freeze([root])
        : path
    })
  })
  const provenance = Object.freeze({
    originAt: Object.freeze((projectedOffset: number): ProjectedCodeUnitOrigin => {
      if (
        !Number.isInteger(projectedOffset) ||
        projectedOffset < 0 ||
        projectedOffset >= length
      ) {
        throw new RangeError('Projected offset is outside the projection')
      }
      return Object.freeze({
        kind: 'canonical' as const,
        sourceOffset: sourceOffset(projectedOffset)
      })
    }),
    canonicalSourceRangeIntersects: Object.freeze((
      sourceStart: number,
      sourceEnd: number
    ): boolean => {
      if (
        !Number.isInteger(sourceStart) ||
        !Number.isInteger(sourceEnd) ||
        sourceStart < 0 ||
        sourceEnd < sourceStart
      ) {
        throw new RangeError('Canonical source range is invalid')
      }
      return sourceStart !== sourceEnd && sourceStart < length
    })
  })
  const projected: ProjectedMarkdown = Object.freeze({
    source: source.text,
    provenance,
    markdown
  })
  const run = Object.freeze({
    text: source.text,
    sourceRange: sourceRange(0, length),
    marks: Object.freeze([])
  })
  const markup: MarkupProjection = Object.freeze({
    runCount: 1,
    runAt: Object.freeze((ordinal: number) => {
      if (!Number.isInteger(ordinal) || ordinal !== 0) {
        throw new RangeError(
          `Markup projection run ordinal ${String(ordinal)} is outside [0, 1)`
        )
      }
      return run
    })
  })
  const ownershipRun = Object.freeze({
    range: sourceRange(0, length),
    owner: Object.freeze({ kind: 'markdown-text' as const })
  })
  const ownership = Object.freeze({
    count: 1,
    at: Object.freeze((ordinal: number) => {
      if (ordinal !== 0) {
        throw new RangeError('Source ownership ordinal is outside the revision')
      }
      return ownershipRun
    }),
    ownerAt: Object.freeze((offset: number) => {
      if (!Number.isInteger(offset) || offset < 0 || offset >= length) {
        throw new RangeError('Source offset is outside the revision')
      }
      return ownershipRun
    })
  })
  const syntaxNodes = Object.freeze(Array.from(
    { length: previous.syntax.nodeCount },
    (_, ordinal) => Object.freeze({
      ...previous.syntax.nodeAt(ordinal),
      range: sourceRange(0, length)
    })
  ))
  const syntaxEdges = Object.freeze(Array.from(
    { length: previous.syntax.edgeCount },
    (_, ordinal) => previous.syntax.edgeAt(ordinal)
  ))
  const syntax: Profile1SyntaxGraph = Object.freeze({
    root: previous.syntax.root,
    nodeCount: syntaxNodes.length,
    nodeAt: Object.freeze((ordinal: number) => {
      const node = Number.isInteger(ordinal) ? syntaxNodes[ordinal] : undefined
      if (node === undefined) {
        throw new RangeError('Profile 1 syntax node ordinal is outside the graph')
      }
      return node
    }),
    edgeCount: syntaxEdges.length,
    edgeAt: Object.freeze((ordinal: number) => {
      const edge = Number.isInteger(ordinal) ? syntaxEdges[ordinal] : undefined
      if (edge === undefined) {
        throw new RangeError('Profile 1 syntax edge ordinal is outside the graph')
      }
      return edge
    })
  })
  recordForkAstRegionReuseV1()
  return Object.freeze({
    kind: 'complete',
    source,
    sourceHash,
    semanticHash,
    configuration,
    syntax,
    criticMarkup: previous.criticMarkup,
    diagnostics: previous.diagnostics,
    ownership,
    markup,
    commentDisplay: previous.commentDisplay,
    projection: Object.freeze((
      view: 'original' | 'revised' | 'editing'
    ): ProjectedMarkdown => {
      if (view !== 'original' && view !== 'revised' && view !== 'editing') {
        throw new RangeError(
          `Unknown CriticMarkup projection: ${String(view)}`
        )
      }
      return projected
    })
  })
}

/**
 * Allocate one internal stage on the engine's production execution stream.
 *
 * Session-owned work outside the parser (for example authenticated search)
 * uses this without exposing a second cancellation or progress authority.
 */
export function nextLanguageEngineExecutionStage(
  engine: LanguageEngine
): ParseExecutionControl | undefined {
  return engine.nextExecutionStage()
}

/** Parser-owned transformation capability kept behind the engine seam. */
export function inspectLanguageEngineChangedCriticMarkerJoins(
  engine: LanguageEngine,
  source: SourceSnapshot,
  configuration: ParseConfiguration,
  joins: readonly number[],
  executionControl?: ParseExecutionControl
): LanguageEngineChangedJoinInspection {
  return engine.inspectChangedCriticMarkerJoins(
    source,
    configuration,
    joins,
    executionControl
  )
}

function applyLanguageEngineSourceEdits(
  source: string,
  edits: readonly LanguageEngineSourceEdit[]
): string {
  return applyExactSourceEdits(
    source,
    edits,
    'Language engine source edit'
  )
}

export function createLanguageEngine(
  defaultExecutionControl?: ParseExecutionControl
): LanguageEngine {
  const defaultExecution: ParseExecutionAccumulator | undefined =
    defaultExecutionControl === undefined
      ? undefined
      : createParseExecutionAccumulator(defaultExecutionControl)
  const reuseCache = createProfile1DocumentReuseCache()
  const ownedRevisions = new WeakSet<DocumentRevision>()
  const sourceHashCache = new WeakMap<DocumentRevision, SourceHashCacheV1>()
  const certifiedSimpleTextRevisions =
    new WeakMap<CompleteDocumentRevision, CertifiedSimpleTextShape>()
  const openRevision = (
    source: SourceSnapshot,
    configuration: ParseConfiguration,
    executionControl?: ParseExecutionControl,
    previous?: Readonly<{
      revision: DocumentRevision
      edits: readonly LanguageEngineSourceEdit[]
    }>
  ): DocumentRevision => {
    const execution = executionControl === undefined
      ? defaultExecution
      : createParseExecutionAccumulator(executionControl)
    const stableSource = createSourceSnapshot(source.text)
    const stableConfiguration = validateAndFreezeParseConfiguration(configuration)
    const previousHashCache = previous === undefined
      ? undefined
      : sourceHashCache.get(previous.revision)
    const hashed = previousHashCache === undefined || previous === undefined
      ? sourceHashV1WithCache(stableSource.text, execution?.stage())
      : reopenSourceHashV1WithCache(
        previousHashCache,
        stableSource.text,
        previous.edits,
        execution?.stage()
      )
    const sourceHash = hashed.hash
    const semanticHash = revisionSemanticHashV1(
      sourceHash,
      stableConfiguration
    )
    const previousSimpleTextShape =
      previous?.revision.kind === 'complete'
        ? certifiedSimpleTextRevisions.get(previous.revision)
        : undefined
    const nextSimpleTextShape =
      previous?.revision.kind === 'complete' &&
      previousSimpleTextShape !== undefined
        ? certifiedSimpleTextShapeAfterEdits(
          previous.revision.source.text.length,
          previousSimpleTextShape,
          stableSource.text.length,
          stableSource.text.charCodeAt(0),
          previous.edits
        )
        : undefined
    if (
      previous?.revision.kind === 'complete' &&
      nextSimpleTextShape !== undefined &&
      (
        stableConfiguration.executionBudget.limitsProfile !== 'desktop-v1' ||
        stableSource.text.length <=
          DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
      )
    ) {
      const revision = reuseCertifiedSimpleTextRevision(
        previous.revision,
        stableSource,
        sourceHash,
        semanticHash,
        stableConfiguration
      )
      ownedRevisions.add(revision)
      sourceHashCache.set(revision, hashed.cache)
      certifiedSimpleTextRevisions.set(revision, nextSimpleTextShape)
      cacheCertifiedSimpleTextDocumentFacts(revision)
      return revision
    }
    const parsed = parseProfile1Document(
      stableSource.text,
      stableConfiguration.executionBudget,
      activeProfileParseTraceRecorderV1(engine),
      stableConfiguration.markdownOptions,
      false,
      execution?.stage(),
      reuseCache
    )
    const parsedSimpleTextIdentity = parsed.kind === 'source-only'
      ? false
      : parsed.simpleTextIdentity
    let revision: DocumentRevision
    if (parsed.kind === 'source-only') {
      revision = Object.freeze({
        kind: 'source-only',
        source: stableSource,
        sourceHash,
        semanticHash,
        configuration: stableConfiguration,
        fatalDiagnostic: parsed.fatalDiagnostic
      })
    } else {
      const projection = Object.freeze((
        view: 'original' | 'revised' | 'editing'
      ) => {
        if (view === 'original') {
          return parsed.original
        }
        if (view === 'revised') {
          return parsed.revised
        }
        if (view === 'editing') {
          return parsed.editing()
        }
        throw new RangeError(
          `Unknown CriticMarkup projection: ${String(view)}`
        )
      })
      const commentDisplay: CompleteDocumentRevision['commentDisplay'] =
        Object.freeze((comment) =>
          parsed.commentDisplay(
            typeof comment === 'string' ? comment : comment.nodeId
          ))

      revision = Object.freeze({
        kind: 'complete',
        source: stableSource,
        sourceHash,
        semanticHash,
        configuration: stableConfiguration,
        syntax: parsed.syntax,
        criticMarkup: parsed.criticMarkup,
        diagnostics: parsed.diagnostics,
        ownership: parsed.ownership,
        markup: parsed.markup,
        commentDisplay,
        projection
      }) satisfies CompleteDocumentRevision
    }
    ownedRevisions.add(revision)
    sourceHashCache.set(revision, hashed.cache)
    if (
      revision.kind === 'complete' &&
      isCertifiedSimpleTextRevision(revision, parsedSimpleTextIdentity)
    ) {
      certifiedSimpleTextRevisions.set(revision, Object.freeze({
        terminalPeriod: stableSource.text.charCodeAt(
          stableSource.text.length - 1
        ) === 46
      }))
      certifySimpleTextDocumentFacts(revision)
    }
    return revision
  }
  const engine: LanguageEngine = Object.freeze({
    inspectChangedCriticMarkerJoins(
      source: SourceSnapshot,
      configuration: ParseConfiguration,
      joins: readonly number[],
      executionControl?: ParseExecutionControl
    ): LanguageEngineChangedJoinInspection {
      const execution = executionControl === undefined
        ? defaultExecution
        : createParseExecutionAccumulator(executionControl)
      const stableSource = createSourceSnapshot(source.text)
      const stableConfiguration =
        validateAndFreezeParseConfiguration(configuration)
      return inspectProfile1ChangedCriticMarkerJoins(
        stableSource.text,
        stableConfiguration.executionBudget,
        stableConfiguration.markdownOptions,
        joins,
        execution?.stage()
      )
    },
    nextExecutionStage(): ParseExecutionControl | undefined {
      return defaultExecution?.stage()
    },
    open(
      source: SourceSnapshot,
      configuration: ParseConfiguration,
      executionControl?: ParseExecutionControl
    ): DocumentRevision {
      return openRevision(source, configuration, executionControl)
    },
    reopen(
      previous: DocumentRevision,
      source: SourceSnapshot,
      edits: readonly LanguageEngineSourceEdit[],
      executionControl?: ParseExecutionControl
    ): DocumentRevision {
      if (!ownedRevisions.has(previous)) {
        throw new Error(
          'Language engine cannot reuse a revision owned by another engine'
        )
      }
      const reproduced = applyLanguageEngineSourceEdits(
        previous.source.text,
        edits
      )
      if (reproduced !== source.text) {
        throw new Error(
          'Language engine reuse source does not match its exact edits'
        )
      }
      return openRevision(
        source,
        previous.configuration,
        executionControl,
        Object.freeze({ revision: previous, edits })
      )
    }
  })
  return engine
}

import type { SourceSnapshot } from './sourceSnapshot.js'
import { createSourceSnapshot } from './sourceSnapshot.js'
import type {
  CompleteDocumentRevision,
  DocumentRevision,
  MarkupProjection,
  ParseConfiguration,
  ProjectedMarkdown
} from './revision.js'
import {
  createProfile1DocumentReuseCache,
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
  type ParseExecutionAccumulator,
  type ParseExecutionControl
} from './parseExecutionControl.js'
import {
  recordForkAstRegionReuseV1
} from './internal/profile1/physicalTraversalAccounting.js'
import {
  inheritEquivalentDocumentFacts
} from './materialize/documentFacts.js'

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
}

export interface LanguageEngineSourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

function isCertifiedPlainTextRevision(
  revision: CompleteDocumentRevision
): boolean {
  if (
    revision.source.text.length === 0 ||
    /[^A-Za-z0-9]/.test(revision.source.text) ||
    revision.criticMarkup.rootCount !== 0 ||
    revision.diagnostics.count !== 0 ||
    revision.markup.runCount !== 1 ||
    revision.ownership.count !== 1
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

function editsPreserveCertifiedPlainText(
  previous: string,
  edits: readonly LanguageEngineSourceEdit[]
): boolean {
  return edits.length > 0 && edits.every((edit) =>
    edit.end > edit.start &&
    edit.end - edit.start === edit.insert.length &&
    /^[A-Za-z0-9]+$/.test(edit.insert) &&
    /^[A-Za-z0-9]+$/.test(previous.slice(edit.start, edit.end))
  )
}

function reuseCertifiedPlainTextRevision(
  previous: CompleteDocumentRevision,
  source: SourceSnapshot,
  sourceHash: CompleteDocumentRevision['sourceHash'],
  semanticHash: CompleteDocumentRevision['semanticHash'],
  configuration: ParseConfiguration
): CompleteDocumentRevision {
  const previousProjection = previous.projection('editing')
  const markdown = Object.freeze({
    ...previousProjection.markdown,
    source: source.text
  })
  const projected: ProjectedMarkdown = Object.freeze({
    source: source.text,
    provenance: previousProjection.provenance,
    markdown
  })
  const run = Object.freeze({
    text: source.text,
    sourceRange: previous.markup.runAt(0).sourceRange,
    marks: Object.freeze([])
  })
  const markup: MarkupProjection = Object.freeze({
    runCount: 1,
    runAt: Object.freeze((ordinal: number) => {
      if (ordinal !== 0) {
        throw new RangeError('Markup projection ordinal is outside the revision')
      }
      return run
    })
  })
  recordForkAstRegionReuseV1()
  return Object.freeze({
    kind: 'complete',
    source,
    sourceHash,
    semanticHash,
    configuration,
    syntax: previous.syntax,
    criticMarkup: previous.criticMarkup,
    diagnostics: previous.diagnostics,
    ownership: previous.ownership,
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

const defaultExecutionByEngine =
  new WeakMap<LanguageEngine, ParseExecutionAccumulator>()

/**
 * Allocate one internal stage on the engine's production execution stream.
 *
 * Session-owned work outside the parser (for example authenticated search)
 * uses this without exposing a second cancellation or progress authority.
 */
export function nextLanguageEngineExecutionStage(
  engine: LanguageEngine
): ParseExecutionControl | undefined {
  return defaultExecutionByEngine.get(engine)?.stage()
}

function applyLanguageEngineSourceEdits(
  source: string,
  edits: readonly LanguageEngineSourceEdit[]
): string {
  let previousEnd = 0
  let result = source
  for (const [index, edit] of edits.entries()) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < previousEnd ||
      edit.end < edit.start ||
      edit.end > source.length ||
      typeof edit.insert !== 'string'
    ) {
      throw new RangeError(
        `Language engine source edit ${String(index)} is invalid`
      )
    }
    previousEnd = edit.end
  }
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index]
    if (edit !== undefined) {
      result =
        result.slice(0, edit.start) +
        edit.insert +
        result.slice(edit.end)
    }
  }
  return result
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
  const certifiedPlainTextRevisions =
    new WeakSet<CompleteDocumentRevision>()
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
    if (
      previous?.revision.kind === 'complete' &&
      certifiedPlainTextRevisions.has(previous.revision) &&
      editsPreserveCertifiedPlainText(
        previous.revision.source.text,
        previous.edits
      )
    ) {
      const revision = reuseCertifiedPlainTextRevision(
        previous.revision,
        stableSource,
        sourceHash,
        semanticHash,
        stableConfiguration
      )
      ownedRevisions.add(revision)
      sourceHashCache.set(revision, hashed.cache)
      certifiedPlainTextRevisions.add(revision)
      inheritEquivalentDocumentFacts(previous.revision, revision)
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
      isCertifiedPlainTextRevision(revision)
    ) {
      certifiedPlainTextRevisions.add(revision)
    }
    return revision
  }
  const engine: LanguageEngine = Object.freeze({
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
  if (defaultExecution !== undefined) {
    defaultExecutionByEngine.set(engine, defaultExecution)
  }
  return engine
}

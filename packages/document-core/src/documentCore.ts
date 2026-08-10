import {
  createProfile1DocumentReuseCache,
  parseProfile1Document,
  type PreviousIntrinsicPass,
  type Profile1DocumentProducts,
  type Profile1DocumentReuseCache
} from './internal/profile1Document.js'
import { createPhysicalTraversalRecorderV1 } from './internal/profile1/physicalTraversalAccounting.js'
import { registerDocumentCoreInspection } from './internal/documentCoreInspection.js'
import { applyExactSourceEdits } from './exactSourceEdits.js'
import type {
  CriticMarkupNode,
  ExecutionBudgetId,
  MarkdownOptionsV1,
  ResourceDiagnostic,
  SyntaxDiagnostic
} from './revision.js'

export type CriticMarkupKind =
  | 'addition'
  | 'deletion'
  | 'substitution'
  | 'highlight'
  | 'comment'

export interface SourceRange {
  /** Inclusive UTF-16 code-unit offset in canonical source. */
  readonly start: number
  /** Exclusive UTF-16 code-unit offset in canonical source. */
  readonly end: number
}

export interface CriticMarkupArm {
  readonly name: 'content' | 'old' | 'new' | 'comment'
  readonly range: SourceRange
  readonly annotations: readonly CriticMarkupAnnotation[]
}

export interface CriticMarkupAnnotation {
  readonly kind: CriticMarkupKind
  readonly range: SourceRange
  readonly arms: readonly CriticMarkupArm[]
}

export type DocumentDiagnosticCode =
  | 'CM_UNMATCHED_CLOSER'
  | 'CM_NON_TOP_CLOSER'
  | 'CM_UNTERMINATED_OPENER'
  | 'CM_SUBSTITUTION_SEPARATOR_MISSING'

export interface DocumentDiagnostic {
  readonly code: DocumentDiagnosticCode
  readonly range: SourceRange
  readonly metadata: Readonly<Record<string, string>>
}

export interface DocumentRevision {
  /** The exact decoded UTF-16 source supplied to open. */
  readonly source: string
  /** Top-level CriticMarkup annotations in canonical source order. */
  readonly annotations: readonly CriticMarkupAnnotation[]
  /** Recoverable syntax diagnostics in canonical source order. */
  readonly diagnostics: readonly DocumentDiagnostic[]
}

export type DocumentProjectionName = 'original' | 'revised'

export interface DocumentProjection {
  readonly markdown: string
}

export interface DocumentSourceEdit {
  /** Inclusive UTF-16 code-unit offset in the previous revision. */
  readonly start: number
  /** Exclusive UTF-16 code-unit offset in the previous revision. */
  readonly end: number
  readonly insert: string
}

export interface MarkdownOptions {
  readonly gfm: boolean
  readonly frontMatter: boolean
  readonly math: boolean
  readonly gitLabMath: boolean
  readonly footnotes: boolean
  readonly subscriptAndSuperscript: boolean
}

export type DocumentCoreErrorCode =
  | 'CM_RESOURCE_SOURCE_UNITS_EXCEEDED'
  | 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED'
  | 'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED'
  | 'CM_RESOURCE_CM_DEPTH_EXCEEDED'

export class DocumentCoreError extends Error {
  readonly code: DocumentCoreErrorCode
  readonly range: SourceRange
  readonly metadata: Readonly<Record<string, string>>

  constructor(
    code: DocumentCoreErrorCode,
    range: SourceRange,
    metadata: Readonly<Record<string, string>>
  ) {
    super(`Document parser rejected source: ${code}`)
    this.name = 'DocumentCoreError'
    this.code = code
    this.range = Object.freeze({ ...range })
    this.metadata = Object.freeze({ ...metadata })
  }
}

/**
 * One document lineage. Successful open and reopen calls advance its current
 * revision. Older revisions remain projectable but cannot be reopened.
 */
export interface DocumentCore {
  open(
    source: string,
    options?: Readonly<Partial<MarkdownOptions>>
  ): DocumentRevision
  reopen(
    previous: DocumentRevision,
    source: string,
    edits: readonly DocumentSourceEdit[],
    options?: Readonly<Partial<MarkdownOptions>>
  ): DocumentRevision
  project(
    revision: DocumentRevision,
    projection: DocumentProjectionName
  ): DocumentProjection
}

const DEFAULT_MARKDOWN_OPTIONS: MarkdownOptions = Object.freeze({
  gfm: true,
  frontMatter: true,
  math: true,
  gitLabMath: false,
  footnotes: false,
  subscriptAndSuperscript: false
})

// Resource and accounting profiles remain private transitional inputs to the
// research parser. They are deliberately absent from the MarkText facade.
const EXECUTION_BUDGET: ExecutionBudgetId = Object.freeze({
  limitsProfile: 'desktop-v1',
  accountingSchema: 'syntax-accounting-1'
})

function markdownOptions(
  options: Readonly<Partial<MarkdownOptions>> = {},
  inherited: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS
): MarkdownOptionsV1 {
  const resolved = Object.freeze({
    gfm: inherited.gfm,
    frontMatter: inherited.frontMatter,
    math: inherited.math,
    gitLabMath: inherited.gitLabMath,
    footnotes: inherited.footnotes,
    subscriptAndSuperscript: inherited.subscriptAndSuperscript,
    ...options
  })

  for (const [name, value] of Object.entries(resolved)) {
    if (typeof value !== 'boolean') {
      throw new TypeError(`Markdown option ${name} must be a boolean`)
    }
  }

  return Object.freeze({
    schema: 'markdown-options-1',
    ...resolved
  })
}

function annotationsOf(
  products: Profile1DocumentProducts
): readonly CriticMarkupAnnotation[] {
  const roots = Array.from(
    { length: products.criticMarkup.rootCount },
    (_, ordinal) => products.criticMarkup.rootAt(ordinal)
  )
  const materialized = new Map<CriticMarkupNode, CriticMarkupAnnotation>()
  const pending = roots.map(annotation => ({ annotation, ready: false }))

  while (pending.length > 0) {
    const task = pending.pop()
    if (task === undefined) break

    if (!task.ready) {
      pending.push({ annotation: task.annotation, ready: true })
      for (let armIndex = task.annotation.arms.length - 1; armIndex >= 0; armIndex -= 1) {
        const arm = task.annotation.arms[armIndex]
        if (arm === undefined) continue
        for (let childIndex = arm.children.length - 1; childIndex >= 0; childIndex -= 1) {
          const child = arm.children[childIndex]
          if (child !== undefined) {
            pending.push({ annotation: child, ready: false })
          }
        }
      }
      continue
    }

    materialized.set(task.annotation, Object.freeze({
      kind: task.annotation.kind,
      range: sourceRangeOf(task.annotation.range),
      arms: Object.freeze(task.annotation.arms.map(arm => Object.freeze({
        name: arm.name,
        range: sourceRangeOf(arm.range),
        annotations: Object.freeze(arm.children.map(child => {
          const annotation = materialized.get(child)
          if (annotation === undefined) {
            throw new Error('CriticMarkup child was not materialized')
          }
          return annotation
        }))
      })))
    }))
  }

  return Object.freeze(roots.map(root => {
    const annotation = materialized.get(root)
    if (annotation === undefined) {
      throw new Error('CriticMarkup root was not materialized')
    }
    return annotation
  }))
}

function sourceRangeOf(range: {
  readonly start: number
  readonly end: number
}): SourceRange {
  return Object.freeze({ start: range.start, end: range.end })
}

function diagnosticOf(diagnostic: SyntaxDiagnostic): DocumentDiagnostic {
  return Object.freeze({
    code: diagnostic.code,
    range: sourceRangeOf(diagnostic.range),
    metadata: Object.freeze({ ...diagnostic.metadata })
  })
}

function diagnosticsOf(
  products: Profile1DocumentProducts
): readonly DocumentDiagnostic[] {
  return Object.freeze(Array.from(
    { length: products.diagnostics.count },
    (_, ordinal) => diagnosticOf(products.diagnostics.at(ordinal))
  ))
}

function documentCoreError(
  diagnostic: ResourceDiagnostic
): DocumentCoreError {
  return new DocumentCoreError(
    diagnostic.code,
    sourceRangeOf(diagnostic.range),
    diagnostic.metadata
  )
}

function sameMarkdownOptions(
  left: MarkdownOptionsV1,
  right: MarkdownOptionsV1
): boolean {
  return left.gfm === right.gfm &&
    left.frontMatter === right.frontMatter &&
    left.math === right.math &&
    left.gitLabMath === right.gitLabMath &&
    left.footnotes === right.footnotes &&
    left.subscriptAndSuperscript === right.subscriptAndSuperscript
}

interface RevisionState {
  readonly products: Profile1DocumentProducts
  readonly markdownOptions: MarkdownOptionsV1
}

export function createDocumentCore(): DocumentCore {
  const stateByRevision = new WeakMap<
    DocumentRevision,
    RevisionState
  >()
  const projectionCache = new WeakMap<
    DocumentRevision,
    Map<DocumentProjectionName, DocumentProjection>
  >()
  let reuseCache: Profile1DocumentReuseCache =
    createProfile1DocumentReuseCache()
  const physicalRecorder = createPhysicalTraversalRecorderV1()
  let currentRevision: DocumentRevision | undefined

  const parse = (
    source: string,
    resolvedOptions: MarkdownOptionsV1,
    previousPass?: PreviousIntrinsicPass
  ): Profile1DocumentProducts => {
    let products
    try {
      products = parseProfile1Document(
        source,
        EXECUTION_BUDGET,
        undefined,
        resolvedOptions,
        false,
        undefined,
        reuseCache,
        physicalRecorder,
        previousPass
      )
    } catch (error) {
      reuseCache = createProfile1DocumentReuseCache()
      throw error
    }
    if (products.kind !== 'complete') {
      reuseCache = createProfile1DocumentReuseCache()
      throw documentCoreError(products.fatalDiagnostic)
    }
    return products
  }

  const publish = (
    source: string,
    products: Profile1DocumentProducts,
    resolvedOptions: MarkdownOptionsV1
  ): DocumentRevision => {
    try {
      const revision = Object.freeze({
        source,
        annotations: annotationsOf(products),
        diagnostics: diagnosticsOf(products)
      })
      stateByRevision.set(revision, Object.freeze({
        products,
        markdownOptions: resolvedOptions
      }))
      currentRevision = revision
      return revision
    } catch (error) {
      // Parsing updates provenance state before facade materialization. If
      // publication fails, discard that candidate state so the current head
      // can still be reopened safely.
      reuseCache = createProfile1DocumentReuseCache()
      throw error
    }
  }

  const core: DocumentCore = Object.freeze({
    open(
      source: string,
      options?: Readonly<Partial<MarkdownOptions>>
    ): DocumentRevision {
      if (typeof source !== 'string') {
        throw new TypeError('Document source must be a string')
      }
      const resolvedOptions = markdownOptions(options)
      return publish(source, parse(source, resolvedOptions), resolvedOptions)
    },

    reopen(
      previous: DocumentRevision,
      source: string,
      edits: readonly DocumentSourceEdit[],
      options?: Readonly<Partial<MarkdownOptions>>
    ): DocumentRevision {
      const previousState = stateByRevision.get(previous)
      if (previousState === undefined) {
        throw new Error('Document revision belongs to another core')
      }
      if (previous !== currentRevision) {
        throw new Error('Document revision is not the current core revision')
      }
      if (typeof source !== 'string') {
        throw new TypeError('Document source must be a string')
      }

      const stableEdits = Object.freeze(edits.map(edit => Object.freeze({
        start: edit.start,
        end: edit.end,
        insert: edit.insert
      })))
      const reproduced = applyExactSourceEdits(
        previous.source,
        stableEdits,
        'Document core source edit'
      )
      if (reproduced !== source) {
        throw new Error(
          'Document core reopen source does not match its exact edits'
        )
      }

      const resolvedOptions = options === undefined
        ? previousState.markdownOptions
        : markdownOptions(options, previousState.markdownOptions)
      const retained = sameMarkdownOptions(
        previousState.markdownOptions,
        resolvedOptions
      )
        ? previousState.products.retainedIntrinsic
        : undefined
      const previousPass = retained === undefined
        ? undefined
        : Object.freeze({ retained, edits: stableEdits })
      return publish(
        source,
        parse(source, resolvedOptions, previousPass),
        resolvedOptions
      )
    },

    project(
      revision: DocumentRevision,
      projection: DocumentProjectionName
    ): DocumentProjection {
      const state = stateByRevision.get(revision)
      if (state === undefined) {
        throw new Error('Document revision belongs to another core')
      }
      if (projection !== 'original' && projection !== 'revised') {
        throw new RangeError(`Unknown document projection: ${String(projection)}`)
      }

      let cachedByName = projectionCache.get(revision)
      if (cachedByName === undefined) {
        cachedByName = new Map()
        projectionCache.set(revision, cachedByName)
      }
      const cached = cachedByName.get(projection)
      if (cached !== undefined) return cached

      const result = Object.freeze({
        markdown: projection === 'original'
          ? state.products.original.source
          : state.products.revised.source
      })
      cachedByName.set(projection, result)
      return result
    }
  })
  registerDocumentCoreInspection(core, () => Object.freeze({
    intrinsicSourceUnits: physicalRecorder.counts().intrinsicSourceUnits
  }))
  return core
}

import {
  parseProfile1Document,
  type Profile1DocumentProducts
} from './internal/profile1Document.js'
import type {
  CriticMarkupNode,
  ExecutionBudgetId,
  MarkdownOptionsV1,
  SyntaxDiagnostic
} from './revision.js'

export type CriticMarkupKind =
  | 'addition'
  | 'deletion'
  | 'substitution'
  | 'highlight'
  | 'comment'

export interface SourceRange {
  readonly start: number
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

export interface MarkdownOptions {
  readonly gfm: boolean
  readonly frontMatter: boolean
  readonly math: boolean
  readonly gitLabMath: boolean
  readonly footnotes: boolean
  readonly subscriptAndSuperscript: boolean
}

export interface DocumentCore {
  open(
    source: string,
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
  options: Readonly<Partial<MarkdownOptions>> = {}
): MarkdownOptionsV1 {
  const resolved = Object.freeze({
    ...DEFAULT_MARKDOWN_OPTIONS,
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

export function createDocumentCore(): DocumentCore {
  const productsByRevision = new WeakMap<
    DocumentRevision,
    Profile1DocumentProducts
  >()
  const projectionCache = new WeakMap<
    DocumentRevision,
    Map<DocumentProjectionName, DocumentProjection>
  >()

  return Object.freeze({
    open(
      source: string,
      options?: Readonly<Partial<MarkdownOptions>>
    ): DocumentRevision {
      if (typeof source !== 'string') {
        throw new TypeError('Document source must be a string')
      }
      const products = parseProfile1Document(
        source,
        EXECUTION_BUDGET,
        undefined,
        markdownOptions(options)
      )
      if (products.kind !== 'complete') {
        throw new RangeError(
          `Document parser rejected source: ${products.fatalDiagnostic.code}`
        )
      }
      const revision = Object.freeze({
        source,
        annotations: annotationsOf(products),
        diagnostics: diagnosticsOf(products)
      })
      productsByRevision.set(revision, products)
      return revision
    },

    project(
      revision: DocumentRevision,
      projection: DocumentProjectionName
    ): DocumentProjection {
      const products = productsByRevision.get(revision)
      if (products === undefined) {
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
          ? products.original.source
          : products.revised.source
      })
      cachedByName.set(projection, result)
      return result
    }
  })
}

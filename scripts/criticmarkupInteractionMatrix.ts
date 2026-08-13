import { readFileSync } from 'node:fs'

export type CriticMarkupInteractionForm =
  | 'addition'
  | 'deletion'
  | 'substitution'
  | 'highlight'
  | 'comment'

export type CriticMarkupInteractionContext =
  | 'paragraph'
  | 'block-boundary'
  | 'literal'
  | 'reference-footnote'
  | 'nested-comment'

export type CriticMarkupInteractionOperation =
  | 'render'
  | 'author'
  | 'resolve'
  | 'source-round-trip'
  | 'save-reopen'

export type CriticMarkupInteractionAction =
  | Readonly<{ kind: 'render' }>
  | Readonly<{
    kind: 'author'
    selection: string
    outcome: 'applied' | 'unavailable'
    replacement?: string
  }>
  | Readonly<{
    kind: 'resolve'
    decision: 'accept' | 'reject'
    targetOrdinal: number | null
    outcome: 'applied' | 'no-target'
  }>
  | Readonly<{ kind: 'source-round-trip' }>
  | Readonly<{ kind: 'save-reopen' }>

export interface CriticMarkupInteractionRow {
  id: string
  form: CriticMarkupInteractionForm
  context: CriticMarkupInteractionContext
  operation: CriticMarkupInteractionOperation
  source: string
  action: CriticMarkupInteractionAction
  expectedSource: string
  expected: string
  productionOracle: string
  status: 'planned' | 'red' | 'green'
}

export interface CriticMarkupInteractionMatrix {
  schema: 'marktext-criticmarkup-interaction-matrix-v1'
  status: 'proposed-unratified'
  rows: CriticMarkupInteractionRow[]
}

const FORMS: readonly CriticMarkupInteractionForm[] = [
  'addition',
  'deletion',
  'substitution',
  'highlight',
  'comment'
]
const CONTEXTS: readonly CriticMarkupInteractionContext[] = [
  'paragraph',
  'block-boundary',
  'literal',
  'reference-footnote',
  'nested-comment'
]
const OPERATIONS: readonly CriticMarkupInteractionOperation[] = [
  'render',
  'author',
  'resolve',
  'source-round-trip',
  'save-reopen'
]

export const readCriticMarkupInteractionMatrix = (
  path: string
): CriticMarkupInteractionMatrix => JSON.parse(
  readFileSync(path, 'utf8')
) as CriticMarkupInteractionMatrix

export const validateCriticMarkupInteractionMatrix = (
  matrix: CriticMarkupInteractionMatrix
): void => {
  if (matrix.schema !== 'marktext-criticmarkup-interaction-matrix-v1') {
    throw new Error('CriticMarkup interaction-matrix schema is invalid')
  }
  if (matrix.status !== 'proposed-unratified') {
    throw new Error('CriticMarkup interaction matrix must remain proposed-unratified')
  }
  const ids = new Set<string>()
  const pairings = new Set<string>()
  for (const row of matrix.rows) {
    if (!row.id.trim() || ids.has(row.id)) {
      throw new Error(`CriticMarkup interaction-row ID is missing or duplicated: ${row.id}`)
    }
    ids.add(row.id)
    if (!FORMS.includes(row.form)) {
      throw new Error(`CriticMarkup interaction row ${row.id} has invalid form`)
    }
    if (!CONTEXTS.includes(row.context)) {
      throw new Error(`CriticMarkup interaction row ${row.id} has invalid context`)
    }
    if (!OPERATIONS.includes(row.operation)) {
      throw new Error(`CriticMarkup interaction row ${row.id} has invalid operation`)
    }
    if (!row.source.trim() || !row.expected.trim() || !row.productionOracle.trim()) {
      throw new Error(`CriticMarkup interaction row ${row.id} is incomplete`)
    }
    if (row.action === undefined || row.action.kind !== row.operation) {
      throw new Error(`CriticMarkup interaction row ${row.id} must define an executable action`)
    }
    if (typeof row.expectedSource !== 'string') {
      throw new Error(`CriticMarkup interaction row ${row.id} requires exact resulting source`)
    }
    if (row.action.kind === 'render' || row.action.kind === 'source-round-trip' ||
      row.action.kind === 'save-reopen') {
      if (row.expectedSource !== row.source) {
        throw new Error(`CriticMarkup interaction row ${row.id} read action changes source`)
      }
    } else if (row.action.kind === 'author') {
      if (
        !(['applied', 'unavailable'] as const).includes(row.action.outcome) ||
        typeof row.action.selection !== 'string' ||
        !row.action.selection ||
        !row.source.includes(row.action.selection) ||
        (row.action.replacement !== undefined && typeof row.action.replacement !== 'string')
      ) {
        throw new Error(`CriticMarkup interaction row ${row.id} has an invalid author selection`)
      }
      if (row.action.outcome === 'applied' && row.expectedSource === row.source) {
        throw new Error(`CriticMarkup interaction row ${row.id} author action changes no source`)
      }
      if (
        row.action.outcome === 'unavailable' &&
        row.expectedSource !== row.source
      ) {
        throw new Error(`CriticMarkup interaction row ${row.id} unavailable action changes source`)
      }
    } else if (row.action.kind === 'resolve') {
      const applied = row.action.outcome === 'applied'
      const noTarget = row.action.outcome === 'no-target'
      const validDecision = row.action.decision === 'accept' || row.action.decision === 'reject'
      const validTarget = applied
        ? Number.isInteger(row.action.targetOrdinal) && (row.action.targetOrdinal ?? -1) >= 0
        : noTarget && row.action.targetOrdinal === null
      if (!validDecision || (!applied && !noTarget) || !validTarget) {
        throw new Error(`CriticMarkup interaction row ${row.id} has an invalid resolve action`)
      }
      if (applied === (row.expectedSource === row.source)) {
        throw new Error(`CriticMarkup interaction row ${row.id} resolve outcome contradicts source`)
      }
    } else {
      throw new Error(`CriticMarkup interaction row ${row.id} has an invalid action kind`)
    }
    if (!(['planned', 'red', 'green'] as const).includes(row.status)) {
      throw new Error(`CriticMarkup interaction row ${row.id} has invalid status`)
    }
    pairings.add(`${row.form}:${row.context}`)
  }

  const missing = FORMS.flatMap(form => CONTEXTS.map(context => `${form}:${context}`))
    .filter(pairing => !pairings.has(pairing))
  if (missing.length > 0) {
    throw new Error(`CriticMarkup interaction matrix is missing: ${missing.join(', ')}`)
  }
  const representedOperations = new Set(matrix.rows.map(row => row.operation))
  const missingOperations = OPERATIONS.filter(operation => !representedOperations.has(operation))
  if (missingOperations.length > 0) {
    throw new Error(`CriticMarkup interaction operations are missing: ${missingOperations.join(', ')}`)
  }
  const pairwise = [
    [FORMS, CONTEXTS, 'form-context'],
    [FORMS, OPERATIONS, 'form-operation'],
    [CONTEXTS, OPERATIONS, 'context-operation']
  ] as const
  const values = (row: CriticMarkupInteractionRow, dimension: string): string => {
    switch (dimension) {
      case 'form': return row.form
      case 'context': return row.context
      case 'operation': return row.operation
      default: throw new Error(`Unknown interaction-matrix dimension ${dimension}`)
    }
  }
  for (const [leftValues, rightValues, label] of pairwise) {
    const [left, right] = label.split('-')
    const observed = new Set(matrix.rows.map(row =>
      `${values(row, left ?? '')}:${values(row, right ?? '')}`
    ))
    const absent = leftValues.flatMap(leftValue =>
      rightValues.map(rightValue => `${leftValue}:${rightValue}`)
    ).filter(pair => !observed.has(pair))
    if (absent.length > 0) {
      throw new Error(`CriticMarkup interaction pairwise coverage is missing: ${absent.join(', ')}`)
    }
  }
}

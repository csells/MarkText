import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

export type CriticMarkupInteractionEvidenceStatus =
  | 'missing-production-oracle'
  | 'existing-partial'
  | 'red'
  | 'green'

export interface CriticMarkupInteractionEvidenceRow {
  id: string
  status: CriticMarkupInteractionEvidenceStatus
  existingEvidence: ReadonlyArray<Readonly<{
    path: string
    scope: string
  }>>
  missingSeam: string | null
  productionOracle: Readonly<{
    kind: 'installed' | 'production-path'
    path: string
    testName: string
  }> | null
  execution: Readonly<{
    buildCommit: string
    recordedAt: string
    result: 'pass' | 'fail'
    recordPath: string
    recordSha256: string
  }> | null
}

export interface CriticMarkupInteractionEvidenceManifest {
  schema: 'marktext-criticmarkup-interaction-evidence-v1'
  status: 'proposed-unapproved'
  matrixPath: string
  matrixSha256: string
  rows: CriticMarkupInteractionEvidenceRow[]
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
    if (row.status === 'green' && row.productionOracle.startsWith('planned:')) {
      throw new Error(
        `CriticMarkup interaction green row ${row.id} requires a named production oracle`
      )
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

const resolveRepositoryPath = (
  repoRoot: string,
  path: string,
  label = 'CriticMarkup interaction evidence'
): string => {
  if (!path.trim() || isAbsolute(path)) throw new Error(`${label} path is invalid`)
  const absolutePath = resolve(repoRoot, path)
  const withinRepo = relative(repoRoot, absolutePath)
  if (withinRepo.startsWith('..') || isAbsolute(withinRepo) || !existsSync(absolutePath)) {
    throw new Error(`${label} file is absent: ${path}`)
  }
  return absolutePath
}

const requireRepoFileDigest = (
  repoRoot: string,
  path: string,
  expectedDigest: string,
  label: string
): void => {
  const absolutePath = resolveRepositoryPath(repoRoot, path, label)
  if (!/^[0-9a-f]{64}$/u.test(expectedDigest)) {
    throw new Error(`${label} digest is invalid`)
  }
  const actualDigest = createHash('sha256')
    .update(readFileSync(absolutePath))
    .digest('hex')
  if (actualDigest !== expectedDigest) throw new Error(`${label} digest is stale: ${path}`)
}

export const validateCriticMarkupInteractionEvidence = (
  repoRoot: string,
  matrix: CriticMarkupInteractionMatrix,
  evidence: CriticMarkupInteractionEvidenceManifest
): void => {
  validateCriticMarkupInteractionMatrix(matrix)
  if (evidence.schema !== 'marktext-criticmarkup-interaction-evidence-v1') {
    throw new Error('CriticMarkup interaction evidence schema is invalid')
  }
  if (evidence.status !== 'proposed-unapproved') {
    throw new Error('CriticMarkup interaction evidence must remain proposed-unapproved')
  }
  requireRepoFileDigest(
    repoRoot,
    evidence.matrixPath,
    evidence.matrixSha256,
    'CriticMarkup interaction matrix'
  )
  const matrixById = new Map(matrix.rows.map(row => [row.id, row]))
  const evidenceIds = new Set<string>()
  for (const row of evidence.rows) {
    if (!row.id.trim() || evidenceIds.has(row.id) || !matrixById.has(row.id)) {
      throw new Error(`CriticMarkup interaction evidence row is stale or duplicated: ${row.id}`)
    }
    evidenceIds.add(row.id)
    if (!([
      'missing-production-oracle',
      'existing-partial',
      'red',
      'green'
    ] as const).includes(row.status)) {
      throw new Error(`CriticMarkup interaction evidence ${row.id} has invalid status`)
    }
    if (!Array.isArray(row.existingEvidence)) {
      throw new Error(`CriticMarkup interaction evidence ${row.id} requires an evidence array`)
    }
    for (const existing of row.existingEvidence) {
      if (!existing.scope.trim()) {
        throw new Error(`CriticMarkup interaction evidence ${row.id} requires an exact scope`)
      }
      const path = resolveRepositoryPath(repoRoot, existing.path)
      if (!existsSync(path)) {
        throw new Error(`CriticMarkup interaction evidence ${row.id} file is absent`)
      }
    }
    if (
      (row.status === 'missing-production-oracle' || row.status === 'existing-partial') &&
      !row.missingSeam?.trim()
    ) {
      throw new Error(`CriticMarkup interaction evidence ${row.id} requires a missing seam`)
    }
    if (row.status === 'missing-production-oracle' && row.productionOracle !== null) {
      throw new Error(`Missing interaction evidence ${row.id} cannot name an implemented oracle`)
    }
    if (row.productionOracle !== null) {
      if (
        !(['installed', 'production-path'] as const).includes(row.productionOracle.kind) ||
        !row.productionOracle.testName.trim()
      ) {
        throw new Error(`CriticMarkup interaction evidence ${row.id} oracle is invalid`)
      }
      if (
        !row.productionOracle.path.startsWith('packages/desktop/test/e2e/') ||
        !row.productionOracle.path.endsWith('.spec.ts')
      ) {
        throw new Error(
          `CriticMarkup interaction evidence ${row.id} oracle is not a production E2E test`
        )
      }
      const oracleSource = readFileSync(resolve(repoRoot, row.productionOracle.path), 'utf8')
      if (!oracleSource.includes(row.productionOracle.testName)) {
        throw new Error(`CriticMarkup interaction evidence ${row.id} test name is stale`)
      }
    }
    if (
      row.status === 'green' &&
      (row.productionOracle?.kind !== 'installed' || row.execution?.result !== 'pass')
    ) {
      throw new Error(
        `CriticMarkup interaction ${row.id} green evidence requires an installed production oracle and passing execution record`
      )
    }
    if (
      row.status === 'red' &&
      (row.productionOracle?.kind !== 'installed' || row.execution?.result !== 'fail')
    ) {
      throw new Error(
        `CriticMarkup interaction ${row.id} red evidence requires an installed production oracle and failing execution record`
      )
    }
    if (row.status === 'green' || row.status === 'red') {
      if (row.execution === null) {
        throw new Error(`CriticMarkup interaction ${row.id} requires an execution record`)
      }
      if (!/^[0-9a-f]{40}$/u.test(row.execution.buildCommit)) {
        throw new Error(`CriticMarkup interaction ${row.id} execution commit is invalid`)
      }
      if (Number.isNaN(Date.parse(row.execution.recordedAt))) {
        throw new Error(`CriticMarkup interaction ${row.id} execution timestamp is invalid`)
      }
      requireRepoFileDigest(
        repoRoot,
        row.execution.recordPath,
        row.execution.recordSha256,
        `CriticMarkup interaction execution ${row.id}`
      )
    }
    if (row.status === 'green') {
      if (matrixById.get(row.id)?.status !== 'green') {
        throw new Error(`CriticMarkup interaction ${row.id} evidence is green but its matrix row is not`)
      }
    } else if (row.status !== 'red' && row.execution !== null) {
      throw new Error(`Non-green interaction evidence ${row.id} cannot claim an execution record`)
    }
  }
  const missing = matrix.rows.filter(row => !evidenceIds.has(row.id))
  if (missing.length > 0) {
    throw new Error(`${missing.length} interaction rows have no evidence disposition`)
  }
}

export const requireGreenCriticMarkupInteractionEvidence = (
  repoRoot: string,
  matrix: CriticMarkupInteractionMatrix,
  evidence: CriticMarkupInteractionEvidenceManifest
): void => {
  validateCriticMarkupInteractionEvidence(repoRoot, matrix, evidence)
  const notGreen = evidence.rows.filter(row => row.status !== 'green')
  if (notGreen.length > 0) {
    throw new Error(`${notGreen.length} interaction rows are not green`)
  }
}

const runCli = (): void => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const matrix = readCriticMarkupInteractionMatrix(resolve(
    repoRoot,
    'specs/baselines/criticmarkup-interaction-matrix.json'
  ))
  const evidence = JSON.parse(readFileSync(resolve(
    repoRoot,
    'specs/baselines/criticmarkup-interaction-evidence.json'
  ), 'utf8')) as CriticMarkupInteractionEvidenceManifest
  if (process.argv[2] === '--validate-evidence') {
    validateCriticMarkupInteractionEvidence(repoRoot, matrix, evidence)
    return
  }
  if (process.argv[2] === '--require-green') {
    requireGreenCriticMarkupInteractionEvidence(repoRoot, matrix, evidence)
    return
  }
  throw new Error(
    'Usage: tsx scripts/criticmarkupInteractionMatrix.ts ' +
    '--validate-evidence | --require-green'
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  createCriticMarkupInstalledInteractionRunRecord,
  type CriticMarkupInteractionEvidenceManifest,
  requireGreenCriticMarkupInteractionEvidence,
  readCriticMarkupInteractionMatrix,
  validateCriticMarkupInteractionEvidence,
  validateCriticMarkupInstalledInteractionRunRecord,
  writeCriticMarkupInstalledInteractionRunRecord,
  validateCriticMarkupInteractionMatrix
} from '../../../../../scripts/criticmarkupInteractionMatrix'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const matrixPath = resolve(
  repoRoot,
  'specs/baselines/criticmarkup-interaction-matrix.json'
)
const evidencePath = resolve(
  repoRoot,
  'specs/baselines/criticmarkup-interaction-evidence.json'
)
const installedRunPath =
  'specs/baselines/runs/' +
  'installed-interaction-addd76f29ac28b0efc13db33868b1f62dd0f9724-20260813T174659Z.json'
const installedRunSha256 =
  'a1f9bcefa6b844096b418c8fc5515f764b661833e2d971b531edf03873c62d53'

describe('CriticMarkup interaction matrix', () => {
  const passingPlaywrightReport = () => {
    const matrix = readCriticMarkupInteractionMatrix(matrixPath)
    return {
      suites: [{
        title: 'installed interaction suite',
        specs: matrix.rows.map(row => ({
          title: `${row.id} follows the installed interaction matrix`,
          ok: true,
          tests: [{
            projectName: 'installed',
            results: [{ status: 'passed' }]
          }]
        }))
      }]
    }
  }

  it('freezes a finite human-authored release-risk denominator', () => {
    const matrix = readCriticMarkupInteractionMatrix(matrixPath)

    expect(() => validateCriticMarkupInteractionMatrix(matrix)).not.toThrow()
    expect(matrix.status).toBe('proposed-unratified')
    expect(matrix.rows).toHaveLength(25)
    expect(new Set(matrix.rows.map(row => row.form))).toEqual(new Set([
      'addition',
      'deletion',
      'substitution',
      'highlight',
      'comment'
    ]))
    expect(new Set(matrix.rows.map(row => row.operation))).toEqual(new Set([
      'render',
      'author',
      'resolve',
      'source-round-trip',
      'save-reopen'
    ]))
  })

  it('authors a selected Comment as the product Commented span', () => {
    const matrix = readCriticMarkupInteractionMatrix(matrixPath)
    const row = matrix.rows.find(candidate => candidate.id === 'comment.paragraph.author')

    expect(row?.action).toEqual({
      kind: 'author',
      selection: 'review this claim',
      replacement: 'note',
      outcome: 'applied'
    })
    expect(row?.expectedSource).toBe(
      'Alpha {==review this claim==}{>>note<<} omega.'
    )
  })

  it('cannot imply owner ratification through row status alone', () => {
    const matrix = structuredClone(readCriticMarkupInteractionMatrix(matrixPath))
    Object.assign(matrix, { status: 'ratified' })

    expect(() => validateCriticMarkupInteractionMatrix(matrix)).toThrow(
      /must remain proposed-unratified/
    )
  })

  it('cannot mark a matrix row green while its production oracle is planned', () => {
    const matrix = structuredClone(readCriticMarkupInteractionMatrix(matrixPath))
    const row = matrix.rows[0]
    if (row === undefined) throw new Error('Interaction matrix is empty')
    row.status = 'green'
    row.productionOracle = 'planned: missing installed interaction oracle'

    expect(() => validateCriticMarkupInteractionMatrix(matrix)).toThrow(
      /green row .* requires a named production oracle/
    )
  })

  it('rejects an operation collapsed out of a form or context', () => {
    const matrix = structuredClone(readCriticMarkupInteractionMatrix(matrixPath))
    for (const row of matrix.rows) {
      row.operation = 'render'
      row.action = { kind: 'render' }
      row.expectedSource = row.source
    }
    Object.assign(matrix.rows[0], {
      operation: 'author',
      action: { kind: 'author', selection: 'Before.', outcome: 'applied' },
      expectedSource: `${matrix.rows[0]?.source ?? ''}!`
    })
    Object.assign(matrix.rows[1], {
      operation: 'resolve',
      action: {
        kind: 'resolve', decision: 'accept', targetOrdinal: null, outcome: 'no-target'
      }
    })
    Object.assign(matrix.rows[2], {
      operation: 'source-round-trip',
      action: { kind: 'source-round-trip' }
    })
    Object.assign(matrix.rows[3], {
      operation: 'save-reopen',
      action: { kind: 'save-reopen' }
    })

    expect(() => validateCriticMarkupInteractionMatrix(matrix)).toThrow(
      /pairwise coverage is missing/
    )
  })

  it('requires an executable action and exact resulting source', () => {
    const matrix = structuredClone(readCriticMarkupInteractionMatrix(matrixPath))
    delete (matrix.rows[0] as Partial<(typeof matrix.rows)[number]>).action

    expect(() => validateCriticMarkupInteractionMatrix(matrix)).toThrow(
      /must define an executable action/
    )
  })

  it('rejects malformed runtime action variants', () => {
    const matrix = structuredClone(readCriticMarkupInteractionMatrix(matrixPath))
    const resolveRow = matrix.rows.find(row => row.action.kind === 'resolve')
    if (resolveRow === undefined) throw new Error('Resolve row is missing')
    Object.assign(resolveRow.action, {
      decision: 'invented',
      outcome: 'invented',
      targetOrdinal: 'not-an-ordinal'
    })

    expect(() => validateCriticMarkupInteractionMatrix(matrix)).toThrow(
      /has an invalid resolve action/
    )
  })

  it('pins passing authenticated installed evidence for every matrix row', () => {
    const matrix = readCriticMarkupInteractionMatrix(matrixPath)
    const evidence = JSON.parse(
      readFileSync(evidencePath, 'utf8')
    ) as CriticMarkupInteractionEvidenceManifest
    const installedRun = JSON.parse(
      readFileSync(resolve(repoRoot, installedRunPath), 'utf8')
    ) as unknown

    expect(() => validateCriticMarkupInteractionEvidence(
      repoRoot,
      matrix,
      evidence
    )).not.toThrow()
    expect(() => validateCriticMarkupInstalledInteractionRunRecord(
      matrix,
      installedRun
    )).not.toThrow()
    expect(evidence.rows).toHaveLength(25)
    expect(matrix.rows.every(row => (
      row.status === 'green' &&
      row.productionOracle ===
        'packages/desktop/test/e2e/installed-core-review.spec.ts: ' +
        'follows the installed interaction matrix'
    ))).toBe(true)
    expect(evidence.rows.filter(row => row.status === 'green')).toHaveLength(25)
    expect(evidence.rows.every(row => row.missingSeam === null)).toBe(true)
    expect(evidence.rows.filter(row =>
      row.productionOracle?.path ===
        'packages/desktop/test/e2e/installed-core-review.spec.ts' &&
      row.productionOracle.testName === 'follows the installed interaction matrix'
    ).map(row => row.id)).toEqual([
      'addition.block-boundary.author',
      'addition.literal.resolve',
      'addition.nested-comment.save-reopen',
      'addition.paragraph.render',
      'addition.reference-footnote.source-round-trip',
      'comment.block-boundary.source-round-trip',
      'comment.literal.save-reopen',
      'comment.nested-comment.render',
      'comment.paragraph.author',
      'comment.reference-footnote.resolve',
      'deletion.block-boundary.resolve',
      'deletion.literal.source-round-trip',
      'deletion.nested-comment.author',
      'deletion.paragraph.save-reopen',
      'deletion.reference-footnote.render',
      'highlight.block-boundary.save-reopen',
      'highlight.literal.render',
      'highlight.nested-comment.resolve',
      'highlight.paragraph.source-round-trip',
      'highlight.reference-footnote.author',
      'substitution.block-boundary.render',
      'substitution.literal.author',
      'substitution.nested-comment.source-round-trip',
      'substitution.paragraph.resolve',
      'substitution.reference-footnote.save-reopen'
    ])
    expect(evidence.rows.every(row => (
      row.execution?.buildCommit ===
        'addd76f29ac28b0efc13db33868b1f62dd0f9724' &&
      row.execution.recordedAt === '2026-08-13T17:48:22.569Z' &&
      row.execution.result === 'pass' &&
      row.execution.recordPath === installedRunPath &&
      row.execution.recordSha256 === installedRunSha256
    ))).toBe(true)
    expect(() => requireGreenCriticMarkupInteractionEvidence(
      repoRoot,
      matrix,
      evidence
    )).not.toThrow()
  })

  it('rejects a green claim without a named installed oracle and execution record', () => {
    const matrix = readCriticMarkupInteractionMatrix(matrixPath)
    const evidence = JSON.parse(
      readFileSync(evidencePath, 'utf8')
    ) as CriticMarkupInteractionEvidenceManifest
    const falseGreen = structuredClone(evidence)
    const row = falseGreen.rows[0]
    if (row === undefined) throw new Error('Interaction evidence fixture is empty')
    row.status = 'green'
    row.productionOracle = null
    row.execution = null

    expect(() => validateCriticMarkupInteractionEvidence(
      repoRoot,
      matrix,
      falseGreen
    )).toThrow(/green evidence requires an installed production oracle/)
  })

  it('materializes exactly one passing installed result for every matrix row', () => {
    const matrix = readCriticMarkupInteractionMatrix(matrixPath)
    const record = createCriticMarkupInstalledInteractionRunRecord(
      matrix,
      passingPlaywrightReport(),
      {
        buildCommit: '0123456789abcdef0123456789abcdef01234567',
        recordedAt: '2026-08-13T19:20:21.000Z'
      }
    )

    expect(() => validateCriticMarkupInstalledInteractionRunRecord(
      matrix,
      record
    )).not.toThrow()
    expect(record).toEqual({
      schema: 'marktext-criticmarkup-installed-interaction-run-v1',
      buildCommit: '0123456789abcdef0123456789abcdef01234567',
      recordedAt: '2026-08-13T19:20:21.000Z',
      result: 'pass',
      rows: matrix.rows.map(row => ({ id: row.id, result: 'pass' }))
        .sort((left, right) => left.id.localeCompare(right.id))
    })
  })

  it.each([
    ['a missing row', (report: ReturnType<typeof passingPlaywrightReport>) => {
      report.suites[0]?.specs.pop()
    }],
    ['a duplicated row', (report: ReturnType<typeof passingPlaywrightReport>) => {
      const first = report.suites[0]?.specs[0]
      if (first !== undefined) report.suites[0]?.specs.push(structuredClone(first))
    }],
    ['a failed row', (report: ReturnType<typeof passingPlaywrightReport>) => {
      const result = report.suites[0]?.specs[0]?.tests[0]?.results[0]
      if (result !== undefined) result.status = 'failed'
    }]
  ])('refuses to materialize %s from Playwright output', (_label, mutate) => {
    const matrix = readCriticMarkupInteractionMatrix(matrixPath)
    const report = passingPlaywrightReport()
    mutate(report)

    expect(() => createCriticMarkupInstalledInteractionRunRecord(
      matrix,
      report,
      {
        buildCommit: '0123456789abcdef0123456789abcdef01234567',
        recordedAt: '2026-08-13T19:20:21.000Z'
      }
    )).toThrow(/installed interaction run/)
  })

  it('writes a hash-pinned record once and validates its execution metadata', () => {
    const matrix = structuredClone(readCriticMarkupInteractionMatrix(matrixPath))
    const evidence = JSON.parse(
      readFileSync(evidencePath, 'utf8')
    ) as CriticMarkupInteractionEvidenceManifest
    const record = createCriticMarkupInstalledInteractionRunRecord(
      matrix,
      passingPlaywrightReport(),
      {
        buildCommit: '0123456789abcdef0123456789abcdef01234567',
        recordedAt: '2026-08-13T19:20:21.000Z'
      }
    )
    const temporaryDirectory = mkdtempSync(resolve(repoRoot, '.criticmarkup-run-test-'))
    const recordPath = resolve(temporaryDirectory, 'installed-interaction.json')

    try {
      const recordSha256 = writeCriticMarkupInstalledInteractionRunRecord(
        recordPath,
        matrix,
        record
      )
      const matrixRow = matrix.rows[0]
      const evidenceRow = evidence.rows[0]
      if (matrixRow === undefined || evidenceRow === undefined) {
        throw new Error('Interaction fixture is empty')
      }
      matrixRow.status = 'green'
      matrixRow.productionOracle = 'installed interaction matrix oracle'
      evidenceRow.status = 'green'
      evidenceRow.execution = {
        buildCommit: record.buildCommit,
        recordedAt: record.recordedAt,
        result: record.result,
        recordPath: relative(repoRoot, recordPath),
        recordSha256
      }

      expect(() => validateCriticMarkupInteractionEvidence(
        repoRoot,
        matrix,
        evidence
      )).not.toThrow()
      expect(() => writeCriticMarkupInstalledInteractionRunRecord(
        recordPath,
        matrix,
        record
      )).toThrow(/already exists/)

      evidenceRow.execution = {
        ...evidenceRow.execution,
        buildCommit: 'fedcba9876543210fedcba9876543210fedcba98'
      }
      expect(() => validateCriticMarkupInteractionEvidence(
        repoRoot,
        matrix,
        evidence
      )).toThrow(/execution metadata does not match its run record/)
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })
})

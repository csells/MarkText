import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  type CriticMarkupInteractionEvidenceManifest,
  requireGreenCriticMarkupInteractionEvidence,
  readCriticMarkupInteractionMatrix,
  validateCriticMarkupInteractionEvidence,
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

describe('CriticMarkup interaction matrix', () => {
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

  it('maps every row to named production evidence or a concrete missing seam', () => {
    const matrix = readCriticMarkupInteractionMatrix(matrixPath)
    const evidence = JSON.parse(
      readFileSync(evidencePath, 'utf8')
    ) as CriticMarkupInteractionEvidenceManifest

    expect(() => validateCriticMarkupInteractionEvidence(
      repoRoot,
      matrix,
      evidence
    )).not.toThrow()
    expect(evidence.rows).toHaveLength(25)
    expect(Object.fromEntries(['existing-partial', 'missing-production-oracle'].map(status => [
      status,
      evidence.rows.filter(row => row.status === status).length
    ]))).toEqual({
      'existing-partial': 21,
      'missing-production-oracle': 4
    })
    expect(evidence.rows.some(row => row.status === 'green')).toBe(false)
    expect(evidence.rows.filter(row =>
      row.productionOracle?.path ===
        'packages/desktop/test/e2e/installed-core-review.spec.ts' &&
      row.productionOracle.testName === 'follows the installed interaction matrix'
    ).map(row => row.id)).toEqual([
      'addition.literal.resolve',
      'addition.nested-comment.save-reopen',
      'addition.paragraph.render',
      'addition.reference-footnote.source-round-trip',
      'comment.block-boundary.source-round-trip',
      'comment.literal.save-reopen',
      'comment.nested-comment.render',
      'comment.reference-footnote.resolve',
      'deletion.block-boundary.resolve',
      'deletion.literal.source-round-trip',
      'deletion.paragraph.save-reopen',
      'deletion.reference-footnote.render',
      'highlight.block-boundary.save-reopen',
      'highlight.literal.render',
      'highlight.nested-comment.resolve',
      'highlight.paragraph.source-round-trip',
      'substitution.block-boundary.render',
      'substitution.nested-comment.source-round-trip',
      'substitution.paragraph.resolve',
      'substitution.reference-footnote.save-reopen'
    ])
    expect(() => requireGreenCriticMarkupInteractionEvidence(
      repoRoot,
      matrix,
      evidence
    )).toThrow(/25 interaction rows are not green/)
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

    expect(() => validateCriticMarkupInteractionEvidence(
      repoRoot,
      matrix,
      falseGreen
    )).toThrow(/green evidence requires an installed production oracle/)
  })
})

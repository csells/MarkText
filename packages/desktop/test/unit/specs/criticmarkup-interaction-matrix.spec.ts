import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  readCriticMarkupInteractionMatrix,
  validateCriticMarkupInteractionMatrix
} from '../../../../../scripts/criticmarkupInteractionMatrix'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const matrixPath = resolve(
  repoRoot,
  'specs/baselines/criticmarkup-interaction-matrix.json'
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
})

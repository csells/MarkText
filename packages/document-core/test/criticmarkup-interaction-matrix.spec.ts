import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  createDocumentCore,
  type CriticMarkupAnnotation,
  type CriticMarkupKind,
  type DocumentSourceEdit
} from '../src/index.js'

type MatrixRow = Readonly<{
  id: string
  form: CriticMarkupKind
  context: string
  source: string
  action:
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
  expectedSource: string
}>

const matrixPath = resolve(
  import.meta.dirname,
  '../../../specs/baselines/criticmarkup-interaction-matrix.json'
)
const rows = (JSON.parse(readFileSync(matrixPath, 'utf8')) as {
  rows: MatrixRow[]
}).rows

const annotations = (
  roots: readonly CriticMarkupAnnotation[]
): CriticMarkupAnnotation[] => {
  const found: CriticMarkupAnnotation[] = []
  const pending = [...roots].reverse()
  while (pending.length > 0) {
    const annotation = pending.pop()
    if (annotation === undefined) continue
    found.push(annotation)
    for (const arm of [...annotation.arms].reverse()) {
      pending.push(...[...arm.annotations].reverse())
    }
  }
  return found
}

const singleEdit = (before: string, after: string): DocumentSourceEdit => {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1
  }
  let beforeEnd = before.length
  let afterEnd = after.length
  while (
    beforeEnd > start && afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1
    afterEnd -= 1
  }
  return { start, end: beforeEnd, insert: after.slice(start, afterEnd) }
}

describe('CriticMarkup interaction matrix at the public engine seam', () => {
  it.each(rows)('$id has a deterministic public-engine disposition', row => {
    const core = createDocumentCore()
    const opened = core.open(row.source)
    expect(opened.source).toBe(row.source)
    const openedAnnotations = annotations(opened.annotations)

    if (row.action.kind === 'resolve') {
      const targets = openedAnnotations.filter(annotation => annotation.kind === row.form)
      if (row.action.outcome === 'no-target') {
        expect(targets).toEqual([])
        expect(opened.source).toBe(row.expectedSource)
      } else {
        const target = targets[row.action.targetOrdinal ?? -1]
        if (target === undefined) throw new Error(`${row.id} has no resolution target`)
        expect(core.resolve(opened, target, row.action.decision).revision.source)
          .toBe(row.expectedSource)
      }
      return
    }

    if (row.action.kind === 'author') {
      if (row.action.outcome === 'unavailable') {
        expect(opened.source).toBe(row.expectedSource)
        return
      }
      expect(row.source).toContain(row.action.selection)
      const authored = core.apply(opened, [singleEdit(row.source, row.expectedSource)]).revision
      expect(authored.source).toBe(row.expectedSource)
      expect(annotations(authored.annotations).some(annotation => (
        annotation.kind === row.form
      ))).toBe(true)
      return
    }

    expect(opened.source).toBe(row.expectedSource)
    if (row.context === 'literal') {
      expect(openedAnnotations.some(annotation => annotation.kind === row.form)).toBe(false)
    } else {
      expect(openedAnnotations.some(annotation => annotation.kind === row.form)).toBe(true)
    }
  })
})

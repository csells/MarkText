import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

// Plan 0012 G35: work a key repeats is done once. Readers of every
// annotation (the Review overview's Comment projections) share one fact table.

describe('Annotation facts of a revision', () => {
  it('are built once for every Comment projection of a regionally edited document', () => {
    const paragraph = 'Review {++new++} and {==a claim==}{>>Check this source.<<}.'
    const source = ['Warm paragraph.', ...Array.from({ length: 200 }, () => paragraph)].join('\n\n') + '\n'
    const core = createDocumentCore()
    let revision = core.open(source)
    revision = core.apply(revision, [{ start: 4, end: 4, insert: 'q' }], { projections: ['markup'] }).revision
    const comments = revision.annotations.filter(annotation => annotation.kind === 'comment')
    expect(comments).toHaveLength(200)
    const before = inspectDocumentCore(core).annotationFactTables
    const projected = comments.map(comment => core.projectComment(revision, comment).ast)
    expect(inspectDocumentCore(core).annotationFactTables - before).toBeLessThanOrEqual(1)
    const oracle = createDocumentCore()
    const fresh = oracle.open(revision.source)
    expect(projected).toEqual(fresh.annotations
      .filter(annotation => annotation.kind === 'comment')
      .map(comment => oracle.projectComment(fresh, comment).ast))
  })
})

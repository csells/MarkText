import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'
import { parseProfile1Document, parseProfile1Window } from '../src/internal/profile1Document.js'
import { createPhysicalTraversalRecorderV1 } from '../src/internal/profile1/physicalTraversalAccounting.js'
import type { ExecutionBudgetId } from '../src/revision.js'

// Work a key repeats is done once. Planning a key previews the
// window that applying it parses again, and readers of every annotation
// (the Review overview's Comment projections) share one fact table.

const budget: ExecutionBudgetId = Object.freeze({
  limitsProfile: 'desktop-v1',
  accountingSchema: 'syntax-accounting-1'
})

const options = Object.freeze({
  schema: 'markdown-options-1' as const,
  gfm: true,
  gfmAutolinks: true,
  gfmTagFilter: true,
  frontMatter: false,
  texMathDollars: true,
  texMathGfm: false,
  texMathSingleBackslash: false,
  texMathDoubleBackslash: false,
  footnotes: false,
  subscriptAndSuperscript: true
})

describe('Regional window parses', () => {
  it('parse a window again only when it or how it is read changes', () => {
    const recorder = createPhysicalTraversalRecorderV1()
    const window = 'Text {++added++} here.\n\n'
    const first = parseProfile1Window(window, budget, options, false, recorder, false)
    expect(parseProfile1Window(window, budget, { ...options }, false, recorder, false)).toBe(first)
    for (const other of [
      parseProfile1Window('Text {++addeds++} here.\n\n', budget, options, false, recorder, false),
      parseProfile1Window(window, budget, options, false, recorder, true),
      parseProfile1Window(window, budget, options, true, recorder, false),
      parseProfile1Window(window, budget, { ...options, gfm: false }, false, recorder, false),
      parseProfile1Window(window, budget, options, false, createPhysicalTraversalRecorderV1(), false)
    ]) {
      expect(other).not.toBe(first)
    }
  })

  it('read as a fresh parse of the same window', () => {
    const window = 'Plain {--gone--} and {~~a~>b~~} words.\n\n'
    const recorder = createPhysicalTraversalRecorderV1()
    const retained = parseProfile1Window(window, budget, options, false, recorder, true)
    parseProfile1Window(window, budget, options, false, recorder, true)
    const fresh = parseProfile1Document(window, budget, options, false, undefined,
      createPhysicalTraversalRecorderV1(), undefined, true)
    if (retained.kind !== 'complete' || fresh.kind !== 'complete') throw new Error('Expected complete parses')
    expect(retained.editing().markdown.root.childCount).toBe(fresh.editing().markdown.root.childCount)
    expect(retained.markup.eventCount).toBe(fresh.markup.eventCount)
    expect(retained.markerDecisions).toEqual(fresh.markerDecisions)
  })
})

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

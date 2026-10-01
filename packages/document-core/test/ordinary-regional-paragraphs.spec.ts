import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { inspectDocumentCore, planFromDocumentParse } from '../src/internal/documentCoreInspection.js'

const suffix = Array.from({ length: 80 }, (_, index) =>
  `Block ${index}: {++added++} {--removed--} {~~old~>new~~} {==marked==}{>>note<<}.\n\n`
).join('')

describe('Ordinary paragraphs in the regional annotation inventory', () => {
  it('keeps repeated edits to separate ordinary paragraphs local and shifts retained annotation facts exactly', () => {
    let source = 'first target\n\nsecond target\n\n' + suffix
    const core = createDocumentCore()
    let revision = core.open(source)
    for (const target of ['first', 'second', 'first', 'second']) {
      const start = source.indexOf(target) + target.length
      const before = inspectDocumentCore(core)
      const result = core.apply(revision, [{ start, end: start, insert: ' more' }], { projections: ['markup'] })
      const after = inspectDocumentCore(core)
      expect(result.change.projections[0]?.scope).toBe('regions')
      expect(after.documentParses - before.documentParses).toBe(0)
      expect(after.sourceMaterializations - before.sourceMaterializations).toBe(0)
      expect(after.regionalInventoryChangedLeaves - before.regionalInventoryChangedLeaves).toBe(1)
      expect(after.regionalInventoryCandidateRegionParseSourceUnits - before.regionalInventoryCandidateRegionParseSourceUnits).toBeLessThan(40)
      source = source.slice(0, start) + ' more' + source.slice(start)
      revision = result.revision
    }
    const oracle = createDocumentCore()
    const expected = oracle.open(source)
    expect(revision.source).toBe(source)
    expect(revision.annotations).toEqual(expected.annotations)
    expect(revision.diagnostics).toEqual(expected.diagnostics)
    for (const name of ['original', 'revised', 'markup'] as const) {
      const actual = core.project(revision, name)
      const full = oracle.project(expected, name)
      if (actual.kind === 'markup' && full.kind === 'markup') {
        expect(actual.events).toEqual(full.events)
        expect(actual.syntax.ast).toEqual(full.syntax.ast)
        for (let position = 0; position <= source.length; position += 17) {
          for (const affinity of ['previous', 'next'] as const) {
            expect(actual.syntax.coordinates.toProjected(position, affinity)).toBe(full.syntax.coordinates.toProjected(position, affinity))
          }
        }
      } else if (actual.kind === 'markdown' && full.kind === 'markdown') {
        expect(actual).toMatchObject({ markdown: full.markdown, ast: full.ast })
      }
    }
  })

  // Plan 0012 G35: markers pair as one stack across the document and backtick
  // runs pair beyond their paragraphs, so a new annotation is regional where
  // every other marker pairs and no such run can reach it.
  it('reparses only the paragraph an ordinary edit adds an annotation to', () => {
    const source = 'ordinary target\n\n' + suffix
    const start = source.indexOf('target') + 2
    const insert = '{++new++}'
    const core = createDocumentCore()
    const revision = core.open(source)
    const before = inspectDocumentCore(core)
    const result = core.apply(revision, [{ start, end: start, insert }], { projections: ['markup'] })
    const after = inspectDocumentCore(core)
    expect(result.change.projections[0]?.scope).toBe('regions')
    expect(after.documentParses - before.documentParses).toBe(0)
    const oracle = createDocumentCore()
    const expected = oracle.open(source.slice(0, start) + insert + source.slice(start))
    expect(result.revision.annotations).toEqual(expected.annotations)
    expect(core.project(result.revision, 'markup').syntax.ast).toEqual(oracle.project(expected, 'markup').syntax.ast)
  })

  // Plan 0012 G35: a document's start and end read at its projection's start
  // and end, also beside markers the projection omits there.
  it.each([
    { label: 'begins with a Highlight', text: '{==outer {==inner==}{>>nested<<} text==}{>>outer comment<<}\n\n' + suffix, at: 'Block 40' },
    { label: 'ends with a Comment and no line ending', text: suffix + 'Last words {>>c<<}', at: 'Last' }
  ])('reads an edit in a document that $label from its blocks', ({ text, at }) => {
    const core = createDocumentCore()
    const opened = core.open(text)
    const start = text.indexOf(at) + 2
    const before = inspectDocumentCore(core).documentParses
    const result = core.apply(opened, [{ start, end: start, insert: 'x' }], { projections: ['markup'] })
    expect(result.change.projections[0]?.scope).toBe('regions')
    expect(inspectDocumentCore(core).documentParses - before).toBe(0)
    const oracle = createDocumentCore()
    const expected = oracle.open(text.slice(0, start) + 'x' + text.slice(start))
    expect(result.revision.annotations).toEqual(expected.annotations)
    expect(result.revision.diagnostics).toEqual(expected.diagnostics)
    expect(core.project(result.revision, 'markup').syntax.ast).toEqual(oracle.project(expected, 'markup').syntax.ast)
    for (const name of ['original', 'revised'] as const) {
      expect(core.project(result.revision, name).markdown).toBe(oracle.project(expected, name).markdown)
    }
  })

  // Plan 0012 G35: a Substitution of a whole fenced code or math block pairs
  // its delimiter runs with each other alone, as the struck block's paired in
  // place, so it is read from its blocks beside the document's suggestions.
  it.each([
    { label: 'fenced code', block: '```js\nconst a = 1\nconst b = 2\n```', typed: 'const ab = 2' },
    { label: 'display math', block: '$$\nx + y\nz\n$$', typed: 'x + yz' }
  ])('reads a Substitution of a whole $label block from its blocks', ({ block, typed }) => {
    const source = 'ordinary target\n\n' + block + '\n\n' + suffix + block + '\n'
    const start = source.lastIndexOf(block)
    const lines = block.split('\n')
    const proposed = [lines[0], typed, ...lines.slice(2)].join('\n')
    const insert = `{~~${block}~>${proposed}~~}`
    const core = createDocumentCore()
    const revision = core.open(source)
    const before = inspectDocumentCore(core)
    const result = core.apply(revision, [{ start, end: start + block.length, insert }], { projections: ['markup'] })
    expect(result.change.projections[0]?.scope).toBe('regions')
    expect(inspectDocumentCore(core).documentParses - before.documentParses).toBe(0)
    const oracle = createDocumentCore()
    const expected = oracle.open(source.slice(0, start) + insert + source.slice(start + block.length))
    expect(result.revision.annotations).toEqual(expected.annotations)
    expect(core.project(result.revision, 'markup').syntax.ast).toEqual(oracle.project(expected, 'markup').syntax.ast)
  })

  // Plan 0012 G35: a fence's backtick runs pair with each other alone, so a
  // paragraph beside it that splits or joins is read from its blocks.
  it('reads a paragraph split beside a fence from its blocks', () => {
    const source = 'ordinary target\n\n```js\nconst a = 1\n```\n\n' + suffix
    const start = source.indexOf('target') + 3
    const core = createDocumentCore()
    const revision = core.open(source)
    const before = inspectDocumentCore(core)
    const result = core.apply(revision, [{ start, end: start, insert: '\n\n' }], { projections: ['markup'] })
    expect(result.change.projections[0]?.scope).toBe('regions')
    expect(inspectDocumentCore(core).documentParses - before.documentParses).toBe(0)
    const oracle = createDocumentCore()
    const expected = oracle.open(source.slice(0, start) + '\n\n' + source.slice(start))
    expect(result.revision.annotations).toEqual(expected.annotations)
    expect(core.project(result.revision, 'markup').syntax.ast).toEqual(oracle.project(expected, 'markup').syntax.ast)
  })

  // Plan 0012 G35: a tracked key whose window compile reaches the window's
  // context is compiled again in a window wider than that context, so the
  // key costs the one parse apply() publishes, not the document compile's.
  it('widens a tracked key\'s window past its context', () => {
    const text = 'Plain words here.\n\n' + ['    indented 0', '    indented 1', '{++\\{--d\\--}++}'].join('\n') +
      '\n$$\nx_{0} + y\nx_{1} + y\n$$\n\n> quoted {~~a~>b~~} line\n\nPlain words here.'
    const start = text.indexOf('x_{1} + y') + 5
    const regional = (core: ReturnType<typeof createDocumentCore>) =>
      core.apply(core.open(text), [{ start: 1, end: 1, insert: 'q' }], { projections: ['markup'] }).revision
    const core = createDocumentCore()
    const revision = regional(core)
    const before = inspectDocumentCore(core).documentParses
    const actual = core.trackedEdit(revision, { start: start + 1, end: start + 1, insert: '\n' })
    expect(inspectDocumentCore(core).documentParses - before).toBeLessThanOrEqual(1)
    const control = createDocumentCore()
    planFromDocumentParse(control)
    expect(actual).toEqual(control.trackedEdit(regional(control), { start: start + 1, end: start + 1, insert: '\n' }))
  })

  // Plan 0012 G35: a heading or a label naming no definition is read in the
  // blocks around it, as the whole document reads it.
  it.each([
    { label: 'new Markdown structure', insert: '\n\n# heading\n\n' },
    { label: 'a label no definition names', insert: '[new][label]' }
  ])('keeps an ordinary edit that introduces $label regional', ({ insert }) => {
    const source = 'ordinary target\n\n' + suffix
    const start = source.indexOf('target') + 2
    const core = createDocumentCore()
    const revision = core.open(source)
    const before = inspectDocumentCore(core)
    const result = core.apply(revision, [{ start, end: start, insert }], { projections: ['markup'] })
    expect(result.change.projections[0]?.scope).toBe('regions')
    expect(inspectDocumentCore(core).documentParses - before.documentParses).toBe(0)
    const oracle = createDocumentCore()
    const expected = oracle.open(source.slice(0, start) + insert + source.slice(start))
    expect(result.revision.annotations).toEqual(expected.annotations)
    expect(core.project(result.revision, 'markup').syntax.ast).toEqual(oracle.project(expected, 'markup').syntax.ast)
  })

  // A whole new suggestion pairs only with itself, so backtick runs elsewhere
  // keep their pairing, and a spelling a backslash protects reads as text
  // anywhere; a lone spelling there could pair with any marker.
  it.each([
    { label: 'a new annotation beside a code span', insert: '{++new++}', tail: 'A `code` span.\n', scope: 'regions', parses: 0 },
    { label: 'a lone opener beside a code span', insert: '{++new', tail: 'A `code` span.\n', scope: 'document', parses: 1 },
    { label: 'a suggestion of protected spellings', insert: '{++\\{--d\\--}++}', tail: 'A `code` span.\n', scope: 'regions', parses: 0 },
    { label: 'a protected spelling beside a code span', insert: '\\{++new', tail: 'A `code` span.\n', scope: 'regions', parses: 0 }
  ])('reads $label as the whole document does', ({ insert, tail, scope, parses }) => {
    const source = 'ordinary target\n\n' + suffix + tail
    const start = source.indexOf('target') + 2
    const core = createDocumentCore()
    const revision = core.open(source)
    const before = inspectDocumentCore(core)
    const result = core.apply(revision, [{ start, end: start, insert }], { projections: ['markup'] })
    const after = inspectDocumentCore(core)
    expect(result.change.projections[0]?.scope).toBe(scope)
    expect(after.documentParses - before.documentParses).toBe(parses)
    const oracle = createDocumentCore()
    const expected = oracle.open(source.slice(0, start) + insert + source.slice(start))
    expect(result.revision.annotations).toEqual(expected.annotations)
    expect(core.project(result.revision, 'markup').syntax.ast).toEqual(oracle.project(expected, 'markup').syntax.ast)
  })

  // Plan 0012 G35: a split or a joined paragraph reparses only the
  // paragraphs it changes.
  it.each([
    { label: 'a paragraph split', at: (source: string) => source.indexOf('target') + 2, length: 0, insert: '\n\n' },
    { label: 'a joined paragraph separator', at: (source: string) => source.indexOf('\n\n'), length: 2, insert: ' ' }
  ])('keeps $label in ordinary paragraphs regional', ({ at, length, insert }) => {
    const source = 'first target\n\nsecond target\n\n' + suffix
    const start = at(source)
    const core = createDocumentCore()
    const opened = core.open(source)
    const before = inspectDocumentCore(core)
    const result = core.apply(opened, [{ start, end: start + length, insert }], { projections: ['markup'] })
    expect(inspectDocumentCore(core).documentParses - before.documentParses).toBe(0)
    expect(result.change.projections[0]?.scope).toBe('regions')
    const expectedSource = source.slice(0, start) + insert + source.slice(start + length)
    expect(result.revision.source).toBe(expectedSource)
    const oracle = createDocumentCore()
    const expected = oracle.open(expectedSource)
    expect(result.revision.annotations).toEqual(expected.annotations)
    expect(core.project(result.revision, 'markup').events).toEqual(oracle.project(expected, 'markup').events)
    expect(core.project(result.revision, 'markup').syntax.ast).toEqual(oracle.project(expected, 'markup').syntax.ast)
  })
})

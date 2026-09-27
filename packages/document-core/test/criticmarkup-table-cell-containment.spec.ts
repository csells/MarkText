import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

// Profile 1 R3b: an unescaped `|` keeps delimiting table cells between
// CriticMarkup markers, so an annotation may not cut through a cell. It may sit
// inside one cell, or, with both markers touching pipes or outside the cells,
// cover whole cells, rows or the whole table.

const table = (row: string): string => `| h | i |\n|---|---|\n${row}\n`

function read(source: string): Readonly<{ annotations: readonly string[], original: string, revised: string }> {
  const core = createDocumentCore()
  const revision = core.open(source)
  return {
    annotations: revision.annotations.map(annotation => annotation.kind),
    original: core.project(revision, 'original').markdown,
    revised: core.project(revision, 'revised').markdown
  }
}

describe('an annotation that cuts through a table cell does not form', () => {
  it.each([
    ['addition', '| a {++ | b ++} |'],
    ['deletion', '| a {-- | b --} |'],
    ['substitution', '| a {~~x | y~>z~~} |'],
    ['highlight', '| a {==x | y==} |'],
    ['comment', '| a {>>x | y<<} |'],
    ['substitution separator in the next cell', '| a {~~x~> | y~~} |'],
    ['addition across two rows', '| a {++x | y |\n| z++} | w |'],
    ['a closer inside the next cell\'s text', '| {++x | y++}w |']
  ])('%s', (_name, row) => {
    const source = table(row)
    const read_ = read(source)
    expect(read_.annotations).toEqual([])
    // Every view keeps the pipes, so the rows keep their cells.
    expect(read_.original).toBe(source)
    expect(read_.revised).toBe(source)
  })

  it('in a header row, as the conformance case spells it', () => {
    expect(read('| a {++ | b ++} |\n|---|---|').annotations).toEqual([])
  })
})

describe('an annotation inside one cell forms', () => {
  it.each([
    ['| a {++x++} | b |', 'addition', '| h | i |\n|---|---|\n| a  | b |\n', '| h | i |\n|---|---|\n| a x | b |\n'],
    ['| {--a--}b | c |', 'deletion', '| h | i |\n|---|---|\n| ab | c |\n', '| h | i |\n|---|---|\n| b | c |\n'],
    ['| a {~~x~>y~~} | b |', 'substitution', '| h | i |\n|---|---|\n| a x | b |\n', '| h | i |\n|---|---|\n| a y | b |\n'],
    ['| a {++x \\| y++} | b |', 'addition', '| h | i |\n|---|---|\n| a  | b |\n', '| h | i |\n|---|---|\n| a x \\| y | b |\n'],
    ['| a {>>x \\| y<<} | b |', 'comment', '| h | i |\n|---|---|\n| a  | b |\n', '| h | i |\n|---|---|\n| a  | b |\n']
  ])('%j', (row, kind, original, revised) => {
    const read_ = read(table(row))
    expect(read_.annotations).toEqual([kind])
    expect(read_.original).toBe(original)
    expect(read_.revised).toBe(revised)
  })

  it('keeps a multi-line comment inside its cell', () => {
    expect(read(table('| a{>>multi\nline<<}b | c |')).annotations).toEqual(['comment'])
  })
})

describe('an annotation covering whole cells, rows or tables forms', () => {
  it.each([
    ['a cell added at the end of a row', table('| x |{++ y |++}'), 'addition'],
    ['a cell inserted before another, as tracked column insertion spells it', table('| x |{++ y |++} z |'), 'addition'],
    ['a cell removed with its pipe, as tracked column removal spells it', table('| x {--| y --}|'), 'deletion'],
    ['whole cells between the row pipes', table('|{++ x | y ++}|'), 'addition'],
    ['the whole text of two cells', table('| {++x | y++} |'), 'addition'],
    ['the text of a cell with its pipe', table('| {--x|--}z |'), 'deletion'],
    ['a whole row', '| h | i |\n|---|---|{++\n| x | y |++}\n', 'addition'],
    ['a row replaced whole', table('{~~| x |~>| x | y |~~}'), 'substitution'],
    ['the whole table', '{--| h | i |\n|---|---|\n| x | y |--}\n', 'deletion']
  ])('%s', (_name, source, kind) => {
    expect(read(source).annotations).toEqual([kind])
  })
})

describe('tracked authoring across cells', () => {
  it('records a cross-cell deletion as a change accept and reject resolve', () => {
    const source = table('| ab | cd |')
    const core = createDocumentCore()
    const revision = core.open(source)
    const start = source.indexOf('b |')
    const end = source.indexOf('d |')
    const edits = core.trackedEdits(revision, [{ start, end, insert: '' }])
    if (edits === undefined) throw new Error('Tracked cross-cell deletion refused')
    const next = core.apply(revision, edits).revision
    expect(next.annotations).toHaveLength(1)
    expect(core.project(next, 'original').markdown).toBe(source)
    expect(core.project(next, 'revised').markdown).toBe(source.slice(0, start) + source.slice(end))
  })

  it('records typing in one cell inside that cell', () => {
    const source = table('| ab | cd |')
    const core = createDocumentCore()
    const revision = core.open(source)
    const at = source.indexOf('b |')
    const edits = core.trackedEdits(revision, [{ start: at, end: at, insert: 'X' }])
    if (edits === undefined) throw new Error('Tracked cell typing refused')
    const next = core.apply(revision, edits).revision
    expect(next.source).toBe(table('| a{++X++}b | cd |'))
    expect(next.annotations.map(annotation => annotation.kind)).toEqual(['addition'])
  })
})

describe('Markup editing at the end of a suggestion inside a cell', () => {
  it('lands text that would cut the cell just after the closer', () => {
    // Pasting `p|q` over `--}y | ` at the end of a Deletion's arm would put a
    // structural pipe inside the Deletion, which then could not form.
    const source = table('| {--x--}y | z |')
    const core = createDocumentCore()
    const revision = core.open(source)
    const closer = source.indexOf('--}')
    const edits = core.markupEdits(revision, [{ start: closer, end: source.indexOf('z |'), insert: 'p|q' }])
    if (edits === undefined) throw new Error('Markup paste refused')
    const next = core.apply(revision, edits).revision
    expect(next.source).toBe(table('| {--x--}p|qz |'))
    expect(next.annotations.map(annotation => annotation.kind)).toEqual(['deletion'])
  })

  it('keeps a pipe that ends the cell inside the arm when the annotation still forms', () => {
    const source = table('| {--x--}y | z |')
    const core = createDocumentCore()
    const revision = core.open(source)
    const closer = source.indexOf('--}')
    const edits = core.markupEdits(revision, [{ start: closer, end: source.indexOf('z |'), insert: '|' }])
    if (edits === undefined) throw new Error('Markup pipe refused')
    expect(core.apply(revision, edits).revision.source).toBe(table('| {--x|--}z |'))
  })
})

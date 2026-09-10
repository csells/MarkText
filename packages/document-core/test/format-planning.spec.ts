import { expect, it } from 'vitest'
import { createDocumentCore, type SourceRange } from '../src/index.js'

const textSelection = ({ start, end }: SourceRange) => ({ ranges: [{ anchor: start, focus: end }], primary: 0 })

it.each([
  { format: 'strong', marker: '**' }, { format: 'em', marker: '*' },
  { format: 'del', marker: '~~' }, { format: 'inline_code', marker: '`' }
] as const)('plans $format from owned syntax with exact selection and annotation preservation', ({ format, marker }) => {
  for (const annotated of [false, true]) {
    const core = createDocumentCore()
    const source = annotated ? 'a{++a++}a\n' : 'aaa\n'
    const previous = core.open(source)
    const selection = annotated ? { start: 4, end: 5 } : { start: 1, end: 2 }
    const plan = core.planFormat(previous, { format, selection: textSelection(selection), tracked: false })
    const expected = annotated ? `a{++${marker}a${marker}++}a\n` : `a${marker}a${marker}a\n`
    const commit = core.apply(previous, plan.edits)
    expect(commit.revision.source).toBe(expected)
    expect(plan.selection).toEqual(textSelection({ start: selection.start + marker.length, end: selection.end + marker.length }))
    expect(commit.revision.annotations).toHaveLength(annotated ? 1 : 0)
    if (!('ranges' in plan.selection)) throw new Error('Expected ordinary formatting source selection')
    const toggle = core.planFormat(commit.revision, { format, selection: plan.selection, tracked: false })
    expect(core.apply(commit.revision, toggle.edits).revision.source).toBe(source)
    expect(toggle.selection).toEqual(textSelection(selection))
  }
})

it.each([
  { format: 'strong', expected: '**a{++a++}a**\n' },
  { format: 'em', expected: '*a{++a++}a*\n' },
  { format: 'del', expected: '~~a{++a++}a~~\n' },
  { format: 'inline_code', expected: '`a`{++`a`++}`a`\n' }
] as const)('keeps annotation ownership when $format spans the annotation', ({ format, expected }) => {
  const core = createDocumentCore()
  const previous = core.open('a{++a++}a\n')
  const plan = core.planFormat(previous, { format, selection: textSelection({ start: 0, end: 9 }), tracked: false })
  const commit = core.apply(previous, plan.edits)
  expect(commit.revision.source).toBe(expected)
  expect(commit.revision.annotations).toHaveLength(1)
  if (!('ranges' in plan.selection)) throw new Error('Expected ordinary formatting source selection')
  const toggle = core.planFormat(commit.revision, { format, selection: plan.selection, tracked: false })
  expect(core.apply(commit.revision, toggle.edits).revision.source).toBe('a{++a++}a\n')
})

it.each([
  { source: '**word**\n', format: 'strong', selection: { start: 4, end: 4 }, expected: 'word\n', caret: 2 },
  { source: '***word***\n', format: 'em', selection: { start: 5, end: 5 }, expected: '**word**\n', caret: 4 },
  { source: 'word \n', format: 'strong', selection: { start: 0, end: 5 }, expected: '**word** \n', caret: undefined },
  { source: 'word\n', format: 'strong', selection: { start: 2, end: 2 }, expected: 'wo****rd\n', caret: 4 },
  { source: '`x` y\n', format: 'inline_code', selection: { start: 0, end: 5 }, expected: 'x y\n', caret: undefined }
] as const)('retains native toggle/caret/whitespace behavior for $source', ({ source, format, selection, expected, caret }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const plan = core.planFormat(previous, { format, selection: textSelection(selection), tracked: false })
  expect(core.apply(previous, plan.edits).revision.source).toBe(expected)
  if (caret !== undefined) expect(plan.selection).toEqual(textSelection({ start: caret, end: caret }))
})

it('formats each Markdown content block and leaves literal blocks and heading prefixes alone', () => {
  const core = createDocumentCore()
  const source = '# one\n\ntwo\n\n```\nthree\n```\n\nfour\n'
  const previous = core.open(source)
  const plan = core.planFormat(previous, { format: 'strong', selection: textSelection({ start: 0, end: source.length - 1 }), tracked: false })
  expect(core.apply(previous, plan.edits).revision.source).toBe('# **one**\n\n**two**\n\n```\nthree\n```\n\n**four**\n')
})

it('tracks the actual format action as a complete replacement with a selected new arm', () => {
  const core = createDocumentCore()
  const previous = core.open('aaa\n')
  const plan = core.planFormat(previous, { format: 'strong', selection: textSelection({ start: 1, end: 2 }), tracked: true })
  expect(core.apply(previous, plan.edits).revision.source).toBe('a{~~a~>**a**~~}a\n')
  expect(plan.selection).toEqual(textSelection({ start: 9, end: 10 }))
})

it('extends formatting within an existing addition without another suggestion', () => {
  const core = createDocumentCore()
  const previous = core.open('a{++a++}a\n')
  const plan = core.planFormat(previous, { format: 'strong', selection: textSelection({ start: 4, end: 5 }), tracked: true })
  expect(core.apply(previous, plan.edits).revision.source).toBe('a{++**a**++}a\n')
  expect(plan.selection).toEqual(textSelection({ start: 6, end: 7 }))
})

it('rejects invalid source positions before changing the document', () => {
  const core = createDocumentCore()
  const previous = core.open('seed\n')
  expect(() => core.planFormat(previous, { format: 'strong', selection: textSelection({ start: -1, end: 3 }), tracked: false })).toThrow()
  expect(previous.source).toBe('seed\n')
})

it('formats only the payload when browser edges include a hidden opener', () => {
  const core = createDocumentCore()
  const previous = core.open('a{++a++}a\n')
  const plan = core.planFormat(previous, { format: 'strong', selection: textSelection({ start: 1, end: 5 }), tracked: false })
  expect(core.apply(previous, plan.edits).revision.source).toBe('a{++**a**++}a\n')
  expect(plan.selection).toEqual(textSelection({ start: 6, end: 7 }))
})

it.each([
  { format: 'strong', payload: '**a{++a++}a**' },
  { format: 'em', payload: '*a{++a++}a*' },
  { format: 'del', payload: '~~a{++a++}a~~' },
  { format: 'inline_code', payload: '`a`{++`a`++}`a`' }
] as const)('tracks and toggles $format across the whole existing annotation', ({ format, payload }) => {
  const core = createDocumentCore()
  const previous = core.open('a{++a++}a\n')
  const plan = core.planFormat(previous, { format, selection: textSelection({ start: 0, end: 9 }), tracked: true })
  const applied = core.apply(previous, plan.edits)
  expect(applied.revision.source).toBe(`{~~a{++a++}a~>${payload}~~}\n`)
  if (!('ranges' in plan.selection)) throw new Error('Expected ordinary formatting source selection')
  const toggle = core.planFormat(applied.revision, { format, selection: plan.selection, tracked: true })
  expect(core.apply(applied.revision, toggle.edits).revision.source).toBe('{~~a{++a++}a~>a{++a++}a~~}\n')
})

it('selects only trimmed formatted content, ready for the next replacement', () => {
  const core = createDocumentCore()
  const previous = core.open(' word \n')
  const plan = core.planFormat(previous, { format: 'strong', selection: textSelection({ start: 0, end: 6 }), tracked: false })
  expect(core.apply(previous, plan.edits).revision.source).toBe(' **word** \n')
  expect(plan.selection).toEqual(textSelection({ start: 3, end: 7 }))
})

it('uses a code delimiter that cannot capture its payload and removes its padding on toggle', () => {
  const core = createDocumentCore()
  const previous = core.open('`x\n')
  const plan = core.planFormat(previous, { format: 'inline_code', selection: textSelection({ start: 0, end: 2 }), tracked: false })
  const commit = core.apply(previous, plan.edits)
  expect(commit.revision.source).toBe('`` `x ``\n')
  expect(plan.selection).toEqual(textSelection({ start: 3, end: 5 }))
  if (!('ranges' in plan.selection)) throw new Error('Expected ordinary formatting source selection')
  const toggle = core.planFormat(commit.revision, { format: 'inline_code', selection: plan.selection, tracked: false })
  expect(core.apply(commit.revision, toggle.edits).revision.source).toBe('`x\n')
})

it.each([
  { source: '**a{++a++}a**\n', expected: 'a{++a++}a\n' },
  { source: '**_aaa_**\n', expected: 'aaa\n' },
  { source: '[**aaa**](https://example.com)\n', expected: 'aaa\n' },
  { source: '![aaa](image.png)\n', expected: 'aaa\n' },
  { source: '`aaa` $bbb$\n', expected: 'aaa bbb\n' },
  { source: 'a <u>**bbb**</u> <mark>ccc</mark>\n', expected: 'a bbb ccc\n' },
  { source: '# **aaa**\n\n```\n**bbb**\n```\n', expected: '# aaa\n\n```\n**bbb**\n```\n' },
  { source: 'aaa\n', expected: 'aaa\n' }
])('clears owned formatting while retaining content and annotations in $source', ({ source, expected }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const plan = core.planFormat(previous, { format: 'clear', selection: textSelection({ start: 0, end: source.length - 1 }), tracked: false })
  const applied = core.apply(previous, plan.edits)
  expect(applied.revision.source).toBe(expected)
  expect(plan.selection).toEqual(textSelection({ start: 0, end: expected.length - 1 }))
})

it.each([
  { source: '[](https://example.com)\n', expected: '\n' },
  { source: '![](image.png)\n', expected: '\n' },
  { source: '**aaa**\n', expected: '{~~**aaa**~>aaa~~}\n' },
  { source: '{++**aaa**++}\n', expected: '{++aaa++}\n' }
])('clears empty labels and tracked syntax in $source', ({ source, expected }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const plan = core.planFormat(revision, { format: 'clear', selection: textSelection({ start: 0, end: source.length - 1 }), tracked: source.startsWith('**') || source.startsWith('{++') })
  expect(core.apply(revision, plan.edits).revision.source).toBe(expected)
})

it.each([
  { format: 'u', open: '<u>', close: '</u>' },
  { format: 'mark', open: '<mark>', close: '</mark>' },
  { format: 'sub', open: '<sub>', close: '</sub>' },
  { format: 'sup', open: '<sup>', close: '</sup>' },
  { format: 'inline_math', open: '$', close: '$' }
] as const)('plans $format and its caret from owned syntax', ({ format, open, close }) => {
  for (const source of ['aaa\n', 'a{++a++}a\n']) {
    const core = createDocumentCore()
    const revision = core.open(source)
    const plan = core.planFormat(revision, { format, selection: textSelection({ start: 0, end: source.length - 1 }), tracked: false })
    const expected = format === 'inline_math' && source.includes('{++') ? `$a$${'{++$a$++}'}$a$\n` : `${open}${source.slice(0, -1)}${close}\n`
    const applied = core.apply(revision, plan.edits)
    expect(applied.revision.source).toBe(expected)
    if (!('ranges' in plan.selection)) throw new Error('Expected ordinary formatting source selection')
    const toggle = core.planFormat(applied.revision, { format, selection: plan.selection, tracked: false })
    const unformatted = core.apply(applied.revision, toggle.edits).revision
    expect(unformatted.source).toBe(source)
    const collapsed = core.planFormat(unformatted, { format, selection: textSelection({ start: 0, end: 0 }), tracked: false })
    expect(core.apply(unformatted, collapsed.edits).revision.source).toBe(`${open}${close}${source}`)
    expect(collapsed.selection).toEqual(textSelection({ start: open.length, end: open.length }))
  }
})

it.each([
  { source: 'aaa\n', end: 3, expected: '[aaa]()\n', caret: 6 },
  { source: 'a{++a++}a\n', end: 9, expected: '[a{++a++}a]()\n', caret: 12 },
  { source: 'aaa\n', end: 0, expected: '[]()aaa\n', caret: 3 }
])('creates link syntax with its owned destination selection in $source', ({ source, end, expected, caret }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const plan = core.planFormat(revision, { format: 'link', selection: textSelection({ start: 0, end }), tracked: false })
  const applied = core.apply(revision, plan.edits)
  expect(applied.revision.source).toBe(expected)
  expect(plan.selection).toEqual(textSelection({ start: caret, end: caret }))
  if (!('ranges' in plan.selection)) throw new Error('Expected ordinary formatting source selection')
  const toggle = core.planFormat(applied.revision, { format: 'link', selection: plan.selection, tracked: false })
  expect(core.apply(applied.revision, toggle.edits).revision.source).toBe(source)
})

it('unlinks a clicked fragment using the complete owned label and places its caret after that label', () => {
  const core = createDocumentCore()
  const revision = core.open('[a{++a++}a](url)\n')
  const plan = core.planFormat(revision, { format: 'unlink', selection: textSelection({ start: 1, end: 2 }), tracked: false })
  expect(core.apply(revision, plan.edits).revision.source).toBe('a{++a++}a\n')
  expect(plan.selection).toEqual(textSelection({ start: 9, end: 9 }))
})

it.each([
  { source: 'aaa\n', end: 3, expected: '![aaa]()\n', caret: 8 },
  { source: 'a{++a++}a\n', end: 9, expected: '![a{++a++}a]()\n', caret: 14 },
  { source: 'aaa\n', end: 0, expected: '![]()aaa\n', caret: 5 }
])('creates the image in $source with a document caret outside the atomic widget', ({ source, end, expected, caret }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const plan = core.planFormat(previous, { format: 'image', selection: textSelection({ start: 0, end }), tracked: false })
  const result = core.apply(previous, plan.edits).revision
  expect(result.source).toBe(expected)
  expect(plan.selection).toEqual(textSelection({ start: caret, end: caret }))
  expect(result.annotations).toHaveLength(previous.annotations.length)
})

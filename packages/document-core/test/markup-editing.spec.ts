import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

describe('ordinary Markup editing across annotations', () => {
  it('deletes visible text across a closer without deleting the remaining suggestion', () => {
    const core = createDocumentCore()
    const revision = core.open('a{++bc++}d')
    const visible = core.project(revision, 'markup').events.flatMap(event => event.kind === 'text'
      ? [...event.text].map((text, index) => ({ text, source: event.sourceRange.start + index }))
      : [])
    expect(visible.map(unit => unit.text).join('')).toBe('abcd')
    const edits = core.markupEdit(revision, {
      start: visible[2]!.source, end: visible[3]!.source + 1, insert: ''
    })
    expect(edits).toBeDefined()
    expect(core.apply(revision, edits!).revision.source).toBe('a{++b++}')
  })

  it('removes fully selected wrappers while preserving hidden comments and nested remaining marks', () => {
    const examples = [
      { source: 'a{++bc++}d', start: 4, end: 6, insert: '', expected: 'ad' },
      { source: 'a{++bc++}d', start: 4, end: 6, insert: 'X', expected: 'a{++X++}d' },
      { source: 'a{==b{++cd++}e==}{>>note<<}f', start: 4, end: 14, insert: '', expected: 'a{>>note<<}f' },
      { source: 'a{++b{>>note<<}c++}d', start: 4, end: 16, insert: '', expected: 'a{>>note<<}d' }
    ]
    for (const example of examples) {
      const core = createDocumentCore()
      const revision = core.open(example.source)
      const edits = core.markupEdit(revision, example)
      expect(edits, example.source).toBeDefined()
      expect(core.apply(revision, edits!).revision.source).toBe(example.expected)
    }
  })

  it('preserves the owning suggestion when formatting or replacing its complete arm', () => {
    for (const example of [
      { source: '{++bc++}', start: 3, end: 5, insert: '**bc**', expected: '{++**bc**++}' },
      { source: '{~~old~>new~~}', start: 3, end: 6, insert: 'other', expected: '{~~other~>new~~}' },
      { source: '{=={++bc++}==}', start: 6, end: 8, insert: 'X', expected: '{=={++X++}==}' },
      { source: 'a{++bc++}d', start: 0, end: 10, insert: 'X', expected: 'X' }
    ]) {
      const core = createDocumentCore()
      const revision = core.open(example.source)
      const planned = core.markupEdit(revision, example)
      expect(planned).toBeDefined()
      expect(core.apply(revision, planned!).revision.source).toBe(example.expected)
    }
  })

  it('replaces across substitution arms without resolving their unselected contents', () => {
    const core = createDocumentCore()
    const revision = core.open('{~~old~>new~~}')
    const edits = core.markupEdit(revision, { start: 4, end: 10, insert: 'X' })
    expect(edits).toBeDefined()
    const next = core.apply(revision, edits!).revision
    expect(next.source).toBe('{~~oX~>w~~}')
    expect(core.project(next, 'original').markdown).toBe('oX')
    expect(core.project(next, 'revised').markdown).toBe('w')
  })

  it('protects typed closers while preserving the remaining annotation', () => {
    const core = createDocumentCore()
    const revision = core.open('a{++bc++}d')
    const edits = core.markupEdit(revision, { start: 5, end: 10, insert: '++}' })
    expect(edits).toBeDefined()
    expect(core.apply(revision, edits!).revision.source).toBe('a{++b\\++}++}')
  })

  it('refuses a selection boundary inside hidden markers without consuming the revision', () => {
    const core = createDocumentCore()
    const revision = core.open('a{++bc++}d')
    expect(core.markupEdit(revision, { start: 2, end: 10, insert: '' })).toBeUndefined()
    expect(revision.source).toBe('a{++bc++}d')
    expect(core.apply(revision, [{ start: 9, end: 10, insert: 'e' }]).revision.source)
      .toBe('a{++bc++}e')
  })

  it('preserves adjacent untouched annotations, literal code, and exact line endings', () => {
    const examples = [
      { source: 'a{++bc++}{--de--}f', start: 5, end: 13, insert: 'X', expected: 'a{++bX++}{--e--}f' },
      { source: '`{++literal++}`\r\na{++bc++}d\r\n', start: 22, end: 27, insert: '', expected: '`{++literal++}`\r\na{++b++}\r\n' },
      { source: '{~~old~>new~~}', start: 3, end: 11, insert: 'X', expected: 'X' },
      { source: '{~~old~>new~~}', start: 3, end: 6, insert: '', expected: '{~~~>new~~}' }
    ]
    for (const example of examples) {
      const core = createDocumentCore()
      const revision = core.open(example.source)
      const edits = core.markupEdit(revision, example)
      expect(edits, example.source).toBeDefined()
      expect(core.apply(revision, edits!).revision.source).toBe(example.expected)
    }
  })

  it('protects a same-arm native closer and keeps ordinary Markdown typing unchanged', () => {
    const examples = [
      { source: '{++ab++}', start: 4, end: 4, insert: '++}', expected: '{++a\\++}b++}' },
      { source: '{~~old~>new~~}', start: 4, end: 4, insert: '~>', expected: '{~~o\\~>ld~>new~~}' },
      { source: 'plain', start: 5, end: 5, insert: ' **bold**', expected: 'plain **bold**' },
      { source: '{++ab++}', start: 4, end: 5, insert: '{--x--}', expected: '{++a\\{--x\\--}++}' }
    ]
    for (const example of examples) {
      const core = createDocumentCore()
      const revision = core.open(example.source)
      const edits = core.markupEdit(revision, example)
      expect(edits, example.source).toBeDefined()
      expect(core.apply(revision, edits!).revision.source).toBe(example.expected)
    }
  })

  it('inserts at document and arm boundaries without changing annotation ownership', () => {
    const examples = [
      { source: '', start: 0, end: 0, insert: 'text', expected: 'text' },
      { source: '{++ab++}', start: 3, end: 3, insert: 'X', expected: '{++Xab++}' },
      { source: '{++ab++}', start: 5, end: 5, insert: 'X', expected: '{++abX++}' },
      { source: 'a{++bc++}d', start: 0, end: 5, insert: 'X', expected: 'X{++c++}d' }
    ]
    for (const example of examples) {
      const core = createDocumentCore()
      const revision = core.open(example.source)
      const edits = core.markupEdit(revision, example)
      expect(edits, example.source).toBeDefined()
      expect(core.apply(revision, edits!).revision.source).toBe(example.expected)
    }
  })
})

it.each(['plain{++X++}', '{~~old~>new~~}', '{==marked==}{>>note<<}'])('appends outside the hidden EOF boundary of %s', source => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const edits = core.markupEdit(revision, { start: source.length, end: source.length, insert: '\n\n# Heading\n' })
  expect(edits).toBeDefined()
  const next = core.apply(revision, edits!).revision
  expect(next.source).toBe(source + '\n\n# Heading\n')
  expect(next.annotations).toEqual(revision.annotations)
})

import { expect, it } from 'vitest'
import { createDocumentCore, imageAltText } from '../src/index.js'

it('changes an image URL without reconstructing its Markdown and CriticMarkup label', () => {
  const core = createDocumentCore()
  const source = 'before ![**a**{++b++}c](old.png "caption") after\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 7, end: 42 },
    tracked: false,
    properties: { alt: 'abc', src: 'new file.png', title: 'caption' }
  })
  expect(core.apply(revision, plan.edits).revision.source).toBe('before ![**a**{++b++}c](new%20file.png "caption") after\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 49, focus: 49 }], primary: 0 })
})

it.each([
  { source: '![**a**{++b++}c](<old.png> \'caption\')\n', title: 'new "caption"', expected: '![**a**{++b++}c](<old.png> \'new "caption"\')\n' },
  { source: '![**a**{++b++}c](old.png)\n', title: 'caption', expected: '![**a**{++b++}c](old.png "caption")\n' },
  { source: '![**a**{++b++}c](old.png "caption")\n', title: '', expected: '![**a**{++b++}c](old.png)\n' }
])('edits only the owned image title in $source', ({ source, title, expected }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: source.length - 1 },
    tracked: false,
    properties: { alt: 'abc', src: 'old.png', title }
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe(expected)
  expect(result.annotations).toHaveLength(1)
  expect(plan.selection).toEqual({ ranges: [{ anchor: expected.length - 1, focus: expected.length - 1 }], primary: 0 })
})

it('deliberately replaces alt text while preserving the destination and title spelling', () => {
  const core = createDocumentCore()
  const revision = core.open('![**a**{++b++}c](<old.png> \'caption\')\n')
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: revision.sourceLength - 1 },
    tracked: false,
    properties: { alt: 'new label', src: 'old.png', title: 'caption' }
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('![new label](<old.png> \'caption\')\n')
  expect(result.annotations).toHaveLength(0)
})

it('tracks an image property change as a complete image replacement preserving its CM label', () => {
  const core = createDocumentCore()
  const source = '![a{++b++}c](old.png)\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: source.length - 1 },
    tracked: true,
    properties: { alt: 'abc', src: 'new.png', title: '' }
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('{~~![a{++b++}c](old.png)~>![a{++b++}c](new.png)~~}\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 47, focus: 47 }], primary: 0 })
  expect(core.project(result, 'original').markdown).toBe('![ac](old.png)\n')
  expect(core.project(result, 'revised').markdown).toBe('![abc](new.png)\n')
})

it.each([false, true])('preserves the actual current selection when an asynchronous image URL completes (tracked=%s)', tracked => {
  const core = createDocumentCore()
  const source = '![a](old.png) text\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: 13 },
    tracked,
    currentSelection: { ranges: [{ anchor: 15, focus: 17 }], primary: 0 },
    properties: { alt: 'a', src: 'new-file.png', title: '' }
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe(tracked ? '{~~![a](old.png)~>![a](new-file.png)~~} text\n' : '![a](new-file.png) text\n')
  expect(plan.selection).toEqual(tracked ? { ranges: [{ anchor: 41, focus: 43 }], primary: 0 } : { ranges: [{ anchor: 20, focus: 22 }], primary: 0 })
})

it('preserves unchanged multiline image labels and titles during a URL update', () => {
  const core = createDocumentCore()
  const source = '![**a**\n`b`{++c++}](old.png "line one\nline two")\n'
  const revision = core.open(source)
  const image = core.project(revision, 'markup').syntax.ast.root.children[0]?.children[0]
  expect(image?.kind).toBe('image')
  expect(image && imageAltText(image)).toBe('a\nbc')
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: source.length - 1 },
    tracked: false,
    properties: { alt: 'a\nbc', src: 'new.png', title: 'line one\nline two' }
  })
  expect(core.apply(revision, plan.edits).revision.source).toBe('![**a**\n`b`{++c++}](new.png "line one\nline two")\n')
})

it('retains exact source and creates no edits when every displayed image property is unchanged', () => {
  const core = createDocumentCore()
  const source = '![a&amp;`b`{++c++}](<old.png> \'a &amp; b\')\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: source.length - 1 },
    tracked: true,
    properties: { alt: 'a&bc', src: 'old.png', title: 'a & b' }
  })
  expect(plan.edits).toEqual([])
})

it('serializes deliberately edited alt and title as literal property values', () => {
  const core = createDocumentCore()
  const revision = core.open('![a](old.png "caption")\n')
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: revision.sourceLength - 1 },
    tracked: false,
    properties: { alt: '[x]{++y++}&copy;', src: 'old.png', title: 'a "quote" &copy;' }
  })
  const result = core.apply(revision, plan.edits).revision
  const image = core.project(result, 'markup').syntax.ast.root.children[0]?.children[0]
  expect(image?.kind).toBe('image')
  expect(image && imageAltText(image)).toBe('[x]{++y++}&copy;')
  expect(image?.attributes.semanticTitle).toBe('a "quote" &copy;')
  expect(result.annotations).toHaveLength(0)
})

it('preserves hidden comments under the existing replacement policy when alt text is changed', () => {
  const core = createDocumentCore()
  const source = '![a{>>note<<}b](old.png)\n'
  const revision = core.open(source)
  const controlCore = createDocumentCore()
  const control = controlCore.open(source)
  const input = controlCore.planInput(control, {
    selection: { ranges: [{ anchor: 2, focus: source.indexOf(']') }], primary: 0 },
    range: { start: 2, end: source.indexOf(']') },
    inputType: 'insertText',
    data: 'new',
    options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
  })
  const inputEdits = controlCore.markupEdits(control, input.edits)
  expect(inputEdits).toBeDefined()
  expect(controlCore.apply(control, inputEdits ?? []).revision.source).toBe('![new{>>note<<}](old.png)\n')
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: source.length - 1 },
    tracked: false,
    properties: { alt: 'new', src: 'old.png', title: '' }
  })
  expect(core.apply(revision, plan.edits).revision.source).toBe('![new{>>note<<}](old.png)\n')
})

it('keeps an edited image URL literal rather than interpreting its entity spelling', () => {
  const core = createDocumentCore()
  const revision = core.open('![a](old.png)\n')
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: 13 },
    tracked: false,
    properties: { alt: 'a', src: 'new&copy;.png', title: '' }
  })
  const result = core.apply(revision, plan.edits).revision
  const image = core.project(result, 'markup').syntax.ast.root.children[0]?.children[0]
  expect(image?.kind).toBe('image')
  expect(image?.attributes.semanticDestination).toBe('new&copy;.png')
})

it.each([
  { properties: { alt: 'abc', src: 'new.png', title: 'caption' }, expectedImage: '![a{++b++}c](new.png "caption")' },
  { properties: { alt: 'abc', src: 'old.png', title: 'new title' }, expectedImage: '![a{++b++}c](old.png "new title")' }
])('changes only the selected reference image properties: $properties', ({ properties, expectedImage }) => {
  const core = createDocumentCore()
  const source = '![a{++b++}c][id] and ![other][id]\n\n[id]: old.png "caption"\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: 16 },
    tracked: false,
    properties
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe(`${expectedImage} and ![other][id]\n\n[id]: old.png "caption"\n`)
  expect(plan.selection).toEqual({ ranges: [{ anchor: expectedImage.length, focus: expectedImage.length }], primary: 0 })
  expect(result.annotations).toHaveLength(1)
})

it('keeps reference syntax and shared definition when only the image alt text changes', () => {
  const core = createDocumentCore()
  const source = '![a{++b++}c][id] and ![other][id]\n\n[id]: old.png "caption"\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: 16 },
    tracked: false,
    properties: { alt: 'new', src: 'old.png', title: 'caption' }
  })
  expect(core.apply(revision, plan.edits).revision.source).toBe('![new][id] and ![other][id]\n\n[id]: old.png "caption"\n')
})

it.each(['![alt][]', '![alt]'])('preserves the reference target when changing an implicit image label: %s', image => {
  const core = createDocumentCore()
  const source = `${image} and ![other][alt]\n\n[alt]: old.png "caption"\n`
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: image.length },
    tracked: false,
    properties: { alt: 'new', src: 'old.png', title: 'caption' }
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('![new][alt] and ![other][alt]\n\n[alt]: old.png "caption"\n')
  expect(core.project(result, 'markup').syntax.ast.root.children[0]?.children[0]?.kind).toBe('image')
})

it('tracks only the selected reference image and keeps the shared definition unchanged', () => {
  const core = createDocumentCore()
  const source = '![a{++b++}c][id] and ![other][id]\n\n[id]: old.png\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: 16 },
    tracked: true,
    properties: { alt: 'abc', src: 'new.png', title: '' }
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('{~~![a{++b++}c][id]~>![a{++b++}c](new.png)~~} and ![other][id]\n\n[id]: old.png\n')
})

it.each([
  { image: '![a&amp;b][]', definition: 'a&amp;b', expectedReference: 'a&amp;b' },
  { image: '![a{++b++}c][]', definition: 'abc', expectedReference: 'abc' }
])('uses the parser-owned implicit reference spelling for $image', ({ image, definition, expectedReference }) => {
  const core = createDocumentCore()
  const source = `${image}\n\n[${definition}]: old.png\n`
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: image.length },
    tracked: false,
    properties: { alt: 'new', src: 'old.png', title: '' }
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe(`![new][${expectedReference}]\n\n[${definition}]: old.png\n`)
  const rendered = core.project(result, 'markup').syntax.ast.root.children[0]?.children[0]
  expect(rendered?.kind).toBe('image')
  expect(rendered?.attributes.semanticDestination).toBe('old.png')
})

it('keeps parser-owned title separator coordinates current after preceding text grows', () => {
  const core = createDocumentCore()
  const initial = core.open('prefix\n\n![a](<old.png> "caption")\n')
  const revision = core.apply(initial, [{ start: 0, end: 6, insert: 'longer prefix' }]).revision
  const start = revision.source.indexOf('![')
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start, end: revision.sourceLength - 1 },
    tracked: false,
    properties: { alt: 'a', src: 'old.png', title: '' }
  })
  expect(core.apply(revision, plan.edits).revision.source).toBe('longer prefix\n\n![a](<old.png>)\n')
})

it('completes image properties while retaining the current later implicit cell', () => {
  const core = createDocumentCore()
  const source = '![a](old)\n\n| a | b | c |\n| --- | --- | --- |\n| x |\n'
  const previous = core.open(source)
  const tableStart = source.indexOf('| a')
  const currentSelection = { kind: 'table-cell' as const, cell: { table: { start: tableStart, end: source.length - 1 }, row: 1, column: 2 }, anchor: 0, focus: 0 }
  const plan = core.planFormat(previous, { format: 'image-properties', selection: { start: 0, end: 9 }, properties: { src: 'new-long' }, tracked: false, currentSelection })
  const accepted = core.apply(previous, plan.edits).revision
  expect(accepted.source).toBe(source.replace('old', 'new-long'))
  expect(plan.selection).toEqual({ ...currentSelection, cell: { ...currentSelection.cell, table: { start: tableStart + 5, end: accepted.source.length - 1 } } })
})

it.each([false, true])('preserves backward current selection when an asynchronous image URL completes (tracked=%s)', tracked => {
  const core = createDocumentCore()
  const previous = core.open('![a](old.png) text\n')
  const plan = core.planFormat(previous, {
    format: 'image-properties',
    selection: { start: 0, end: 13 },
    currentSelection: { ranges: [{ anchor: 17, focus: 15 }], primary: 0 },
    properties: { alt: 'a', src: 'new-file.png', title: '' },
    tracked
  })
  expect(core.apply(previous, plan.edits).revision.source).toBe(tracked ? '{~~![a](old.png)~>![a](new-file.png)~~} text\n' : '![a](new-file.png) text\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: tracked ? 43 : 22, focus: tracked ? 41 : 20 }], primary: 0 })
})

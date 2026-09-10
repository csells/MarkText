import { expect, it } from 'vitest'
import { createDocumentCore, imageAltText } from '../src/index.js'

it.each([
  { prefix: 'before ', suffix: ' after\n' },
  { prefix: '', suffix: '\n' }
])('edits an owned HTML image while preserving unrelated attributes and literal CM ($prefix)', ({ prefix, suffix }) => {
  const core = createDocumentCore()
  const image = '<img SRC=\'old.png\' alt="a{++b++}" width=32 data-align="left">'
  const source = prefix + image + suffix
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: prefix.length, end: prefix.length + image.length },
    tracked: false,
    properties: { alt: 'a{++b++}', src: 'new file.png', title: '' }
  })
  const result = core.apply(revision, plan.edits).revision
  const expectedImage = '<img SRC=\'new%20file.png\' alt="a{++b++}" width=32 data-align="left" />'
  expect(result.source).toBe(prefix + expectedImage + suffix)
  expect(result.annotations).toHaveLength(0)
  expect(plan.selection).toEqual({ ranges: [{ anchor: prefix.length + expectedImage.length, focus: prefix.length + expectedImage.length }], primary: 0 })
})

it('exposes HTML image property values and source ranges through the existing owned AST', () => {
  const core = createDocumentCore()
  const source = 'before <img src="a&amp;b.png" alt="\\*a&amp;b{++c++}" title=\'caption\'> after\n'
  const revision = core.open(source)
  const node = core.project(revision, 'markup').syntax.ast.root.children[0]?.children.find(child => child.kind === 'inline-html')
  expect(node?.attributes.tagName).toBe('img')
  expect(node?.attributes.semanticDestination).toBe('a&b.png')
  expect(node?.attributes.semanticTitle).toBe('caption')
  expect(node && imageAltText(node)).toBe('\\*a&b{++c++}')
  expect(node?.attributes.srcValueStart).toBe(17)
  expect(node?.attributes.srcValueEnd).toBe(28)
  expect(revision.annotations).toHaveLength(0)
})

it.each([
  { alt: 'a&amp b &copy; \\*', expected: 'a& b © \\*' },
  { alt: 'a&amp=b &#x80; &#0;', expected: 'a&amp=b € �' }
])('uses HTML attribute entity rules rather than Markdown text rules ($alt)', ({ alt, expected }) => {
  const core = createDocumentCore()
  const revision = core.open(`before <img src="a.png" alt="${alt}"> after\n`)
  const node = core.project(revision, 'markup').syntax.ast.root.children[0]?.children.find(child => child.kind === 'inline-html')
  expect(node && imageAltText(node)).toBe(expected)
})

it('does not mistake a slash in an unquoted HTML attribute for a self-closing delimiter', () => {
  const core = createDocumentCore()
  const revision = core.open('before <img src=x/> after\n')
  const node = core.project(revision, 'markup').syntax.ast.root.children[0]?.children.find(child => child.kind === 'inline-html')
  expect(node?.attributes.semanticDestination).toBe('x/')
  expect(node?.attributes.selfClosing).toBe(false)
})

it('edits quoted, unquoted and missing properties without rewriting other HTML attributes', () => {
  const core = createDocumentCore()
  const source = '<img data-align=left SRC=old.png alt=\'old\' width="32" />\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: source.length - 1 },
    tracked: false,
    properties: { src: 'new.png', alt: 'new \'label\' &copy;', title: 'new "title"' }
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('<img data-align=left SRC="new.png" alt=\'new &#39;label&#39; &amp;copy;\' width="32"  title="new &quot;title&quot;"/>\n')
  const node = core.project(result, 'markup').syntax.ast.root.children[0]
  expect(node?.attributes.semanticAlt).toBe('new \'label\' &copy;')
  expect(node?.attributes.semanticTitle).toBe('new "title"')
})

it('does not change an untouched valid open HTML image tag or its source revision', () => {
  const core = createDocumentCore()
  const source = '<img src="old.png" alt="a">\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: source.length - 1 },
    tracked: true,
    properties: { src: 'old.png', alt: 'a', title: '' }
  })
  expect(plan.edits).toEqual([])
  expect(revision.source).toBe(source)
})

it('tracks the complete HTML image without activating CM-looking attribute text', () => {
  const core = createDocumentCore()
  const source = '<img src="old.png" alt="{++a++}">\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: 0, end: source.length - 1 },
    tracked: true,
    properties: { src: 'new.png', alt: '{++a++}', title: '' }
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('{~~<img src="old.png" alt="{++a++}">~><img src="new.png" alt="{++a++}" />~~}\n')
  expect(result.annotations).toHaveLength(1)
  expect(core.project(result, 'original').markdown).toBe(source)
  expect(core.project(result, 'revised').markdown).toBe('<img src="new.png" alt="{++a++}" />\n')
})

it('keeps HTML property coordinates correct after an earlier source edit', () => {
  const core = createDocumentCore()
  const initial = core.open('prefix\n\nbefore <img src="old.png" alt="a"> after\n')
  const revision = core.apply(initial, [{ start: 0, end: 6, insert: 'longer prefix' }]).revision
  const imageStart = revision.source.indexOf('<img')
  const imageEnd = revision.source.indexOf('>') + 1
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    selection: { start: imageStart, end: imageEnd },
    tracked: false,
    properties: { src: 'new.png', alt: 'b', title: '' }
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('longer prefix\n\nbefore <img src="new.png" alt="b" /> after\n')
})

it.each([false, true])('retains image size/alignment facts and ranges after earlier edits (incremental=%s)', incremental => {
  const core = createDocumentCore()
  const source = 'prefix\n\nbefore <img src="a.png" width="&#49;00" height=50% data-align=left> after\n'
  const initial = core.open(source)
  const revision = incremental ? core.apply(initial, [{ start: 0, end: 6, insert: 'longer prefix' }]).revision : initial
  const syntax = core.project(revision, 'markup').syntax
  const image = syntax.ast.root.children[1]?.children.find(child => child.kind === 'inline-html')
  expect(image?.attributes.semanticWidth).toBe('100')
  expect(image?.attributes.semanticHeight).toBe('50%')
  expect(image?.attributes.semanticAlign).toBe('left')
  for (const [name, expected] of [['width', '&#49;00'], ['height', '50%'], ['data-align', 'left']] as const) {
    const start = image?.attributes[`${name}ValueStart`]
    const end = image?.attributes[`${name}ValueEnd`]
    expect(typeof start).toBe('number')
    expect(typeof end).toBe('number')
    if (typeof start !== 'number' || typeof end !== 'number') throw new Error('Missing parser attribute range')
    expect(core.sourceSlice(revision, { start: syntax.coordinates.toSource(start, 'next'), end: syntax.coordinates.toSource(end, 'previous') })).toBe(expected)
  }
})

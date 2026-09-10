import { expect, it } from 'vitest'
import { createDocumentCore, imageAltText } from '../src/index.js'
import type { MarkdownAstNode } from '../src/index.js'

const images = (node: MarkdownAstNode): MarkdownAstNode[] =>
  node.kind === 'image' || (node.kind === 'inline-html' || node.kind === 'html-block') && node.attributes.tagName === 'img'
    ? [node]
    : node.children.flatMap(images)

it.each([
  { source: '![cat](image.png "caption")\n', expected: '<img src="image.png" alt="cat" title="caption" width="120" />\n' },
  { source: '<IMG alt=cat src="image.png" data-align=left>\n', expected: '<IMG alt=cat src="image.png" data-align=left width="120" />\n' },
  { source: '![cat][ref] ![cat][ref]\n\n[ref]: image.png "caption"\n', expected: '<img src="image.png" alt="cat" title="caption" width="120" /> ![cat][ref]\n\n[ref]: image.png "caption"\n' }
])('authors a native image width through the owned source while retaining siblings: $source', ({ source, expected }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const syntax = core.project(revision, 'markup').syntax
  const image = images(syntax.ast.root)[0]!
  const plan = core.planFormat(revision, {
    format: 'image-properties',
    tracked: false,
    selection: { start: image.range.start, end: image.kind === 'html-block' ? Number(image.attributes.tagEnd) : image.range.end },
    properties: { width: '120' }
  })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe(expected)
  const reopened = core.open(result.source)
  expect(images(core.project(reopened, 'revised').ast.root)[0]?.attributes.semanticWidth).toBe('120')
})

it('patches only the selected repeated HTML image alignment and preserves existing attribute spelling', () => {
  const core = createDocumentCore()
  const first = '<img src="same.png" alt="cat" width=120 data-align=left>'
  const source = `${first} ${first}\n`
  const revision = core.open(source)
  const start = first.length + 1
  const plan = core.planFormat(revision, { format: 'image-properties', tracked: false, selection: { start, end: start + first.length }, properties: { 'data-align': 'center' } })
  expect(core.apply(revision, plan.edits).revision.source).toBe(`${first} <img src="same.png" alt="cat" width=120 data-align="center" />\n`)
})

it('preserves both CM image-label meanings and comments when applying a native width', () => {
  const core = createDocumentCore()
  const source = '![a{++b++}c{>>review this label<<}](image.png)\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, { format: 'image-properties', tracked: false, selection: { start: 0, end: source.length - 1 }, properties: { width: '120' } })
  const result = core.apply(revision, plan.edits).revision
  const reopened = core.open(result.source)
  for (const [mode, alt] of [['original', 'ac'], ['revised', 'abc']] as const) {
    const image = images(core.project(reopened, mode).ast.root)[0]!
    expect(imageAltText(image)).toBe(alt)
    expect(image.attributes.semanticWidth).toBe('120')
  }
  expect(reopened.annotations.map(annotation => annotation.kind)).toEqual(revision.annotations.map(annotation => annotation.kind))
  expect(core.projectComment(reopened, reopened.annotations[1]!).markdown).toBe('review this label')
})

it.each([false, true])('keeps an enclosing suggestion while converting its plain image for layout (tracked=%s)', tracked => {
  const core = createDocumentCore()
  const source = '{++![cat](image.png)++}\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, { format: 'image-properties', tracked, selection: { start: 3, end: source.indexOf('++}') }, properties: { width: '120' } })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('{++<img src="image.png" alt="cat" width="120" />++}\n')
  expect(result.annotations.map(annotation => annotation.kind)).toEqual(['addition'])
  expect(core.project(result, 'original').markdown).toBe('\n')
  expect(imageAltText(images(core.project(result, 'revised').ast.root)[0]!)).toBe('cat')
})

it('tracks layout as one complete image suggestion through the existing compiler', () => {
  const core = createDocumentCore()
  const source = '![cat](image.png)\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, { format: 'image-properties', tracked: true, selection: { start: 0, end: source.length - 1 }, properties: { 'data-align': 'center' } })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('{~~![cat](image.png)~><img src="image.png" alt="cat" data-align="center" />~~}\n')
  expect(core.project(result, 'original').markdown).toBe(source)
  expect(core.project(result, 'revised').markdown).toBe('<img src="image.png" alt="cat" data-align="center" />\n')
})

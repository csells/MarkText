import { expect, it } from 'vitest'
import { createDocumentCore, imageAltText } from '../src/index.js'

it.each([
  { source: 'a]b\n', expected: '![a\\]b](cat.png)\n', alt: 'a]b' },
  { source: 'a[b\n', expected: '![a\\[b](cat.png)\n', alt: 'a[b' },
  { source: 'a\\]b\n', expected: '![a\\]b](cat.png)\n', alt: 'a]b' },
  { source: 'a&#93;b\n', expected: '![a&#93;b](cat.png)\n', alt: 'a]b' },
  { source: '**a]b**\n', expected: '![**a\\]b**](cat.png)\n', alt: 'a]b' },
  { source: 'a{++]++}b\n', expected: '![a{++\\]++}b](cat.png)\n', alt: 'a]b' },
  { source: 'a{++\\]++}b\n', expected: '![a{++\\]++}b](cat.png)\n', alt: 'a]b' },
  { source: 'a{>>keep<<}]{++b++}\n', expected: '![a{>>keep<<}\\]{++b++}](cat.png)\n', alt: 'a]b' }
])('authors one image label from owned selected text: $source', ({ source, expected, alt }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const plan = core.planFormat(revision, { format: 'image', image: { src: 'cat.png', alt: 'unused' }, tracked: false, selection: { ranges: [{ anchor: 0, focus: source.length - 1 }], primary: 0 } })
  const changed = core.apply(revision, plan.edits).revision
  expect(changed.source).toBe(expected)
  const image = core.project(changed, 'markup').syntax.ast.root.children[0]?.children[0]
  expect(image?.kind).toBe('image')
  if (image === undefined) throw new Error('Expected owned image')
  expect(imageAltText(image)).toBe(alt)
  expect(plan.selection).toEqual({ ranges: [{ anchor: expected.length - 1, focus: expected.length - 1 }], primary: 0 })
  const reopened = core.open(expected)
  expect(core.project(reopened, 'markup').syntax.ast.root.children[0]?.children[0]?.kind).toBe('image')
})

it('tracks image label spelling as part of the complete inserted image', () => {
  const core = createDocumentCore()
  const source = 'a]b\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, { format: 'image', image: { src: 'cat.png', alt: '' }, tracked: true, selection: { ranges: [{ anchor: 0, focus: 3 }], primary: 0 } })
  const changed = core.apply(revision, plan.edits).revision
  expect(changed.source).toBe('{~~a]b~>![a\\]b](cat.png)~~}\n')
  expect(core.project(changed, 'original').markdown).toBe(source)
  expect(core.project(changed, 'revised').markdown).toBe('![a\\]b](cat.png)\n')
})

import { describe, expect, it } from 'vitest'
import { createDocumentCore, type MarkdownAstNode } from '../src/index.js'

// MarkText Markdown Profile 2 (specs/language/marktext-markdown-profile-2.md):
// the image layout suffix's grammar (IL1), what stays ordinary text (IL2), and
// the one syntax node that reading never rewrites (IL3).

const images = (node: MarkdownAstNode): MarkdownAstNode[] => node.kind === 'image' ? [node] : node.children.flatMap(images)

const read = (source: string) => {
  const core = createDocumentCore()
  const revision = core.open(`${source}\n`)
  const projection = core.project(revision, 'revised')
  const image = images(projection.ast.root)[0]
  return {
    revision,
    image,
    spelled: image === undefined ? undefined : projection.markdown.slice(image.range.start, image.range.end),
    layout: image === undefined
      ? undefined
      : Object.fromEntries((['semanticWidth', 'semanticHeight', 'semanticAlign'] as const)
        .filter(key => image.attributes[key] !== undefined)
        .map(key => [key, image.attributes[key]]))
  }
}

describe('IL1: the suffix and its fields', () => {
  it.each([
    ['![a](u){width=.5}', { semanticWidth: '.5' }],
    ['![a](u){width=01}', { semanticWidth: '01' }],
    ['![a](u){height=50%}', { semanticHeight: '50%' }],
    ['![a](u){data-align=inline}', { semanticAlign: 'inline' }],
    ['![a](u){data-align=right height=2.25 width=10%}', { semanticWidth: '10%', semanticHeight: '2.25', semanticAlign: 'right' }],
    ['![a](u){ width=1\theight=2 }', { semanticWidth: '1', semanticHeight: '2' }]
  ])('reads %j', (source, layout) => {
    const { spelled, layout: observed } = read(source)
    expect(observed).toEqual(layout)
    expect(spelled).toBe(source)
  })

  it.each([
    '![a][r]{width=1}\n\n[r]: u',
    '![r][]{width=1}\n\n[r]: u',
    '![r]{width=1}\n\n[r]: u'
  ])('attaches to a reference image: %j', source => {
    expect(read(source).layout).toEqual({ semanticWidth: '1' })
  })
})

describe('IL2: what is not a suffix', () => {
  it.each([
    '![a](u){width=5.}',
    '![a](u){width=0}',
    '![a](u){width=-1}',
    '![a](u){width=+1}',
    '![a](u){width=1e3}',
    '![a](u){width="1"}',
    '![a](u){width = 1}',
    '![a](u){Width=1}',
    '![a](u){data-align=Center}',
    '![a](u){color=red}',
    '![a](u){width=1 width=2}',
    '![a](u){}',
    '![a](u){ }',
    '![a](u){width=1',
    '![a](u){width=1\nheight=2}',
    '![a](u)\\{width=1}',
    '![a](u) {width=1}'
  ])('leaves %j as an image followed by text', source => {
    const { spelled, layout } = read(source)
    expect(spelled).toBe('![a](u)')
    expect(layout).toEqual({})
  })

  it.each([
    '[a](u){width=1}',
    '![a][nope]{width=1}',
    '`![a](u){width=1}`',
    '<img src="u">{width=1}'
  ])('does not attach to %j', source => {
    expect(read(source).image).toBeUndefined()
  })

  it('keeps a suffix that would leave its annotation arm as text', () => {
    const { revision, layout } = read('{++![a](u){width=1++}}')
    expect(revision.annotations.map(annotation => annotation.kind)).toEqual(['addition'])
    expect(layout).toEqual({})
  })
})

describe('IL3: one syntax node', () => {
  it('owns the suffix in the image node and never rewrites its source', () => {
    const source = '![a](u){width=320 data-align=center} tail'
    const { revision, image, spelled } = read(source)
    expect(revision.source).toBe(`${source}\n`)
    expect(spelled).toBe('![a](u){width=320 data-align=center}')
    expect(revision.source.slice(Number(image?.attributes.sizeStart), Number(image?.attributes.sizeEnd)))
      .toBe('{width=320 data-align=center}')
  })
})

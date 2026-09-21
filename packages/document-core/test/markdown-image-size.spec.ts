import { expect, it } from 'vitest'
import { createDocumentCore, imageAltText } from '../src/index.js'
import type { MarkdownAstNode } from '../src/index.js'

const images = (node: MarkdownAstNode): MarkdownAstNode[] => node.kind === 'image' ? [node] : node.children.flatMap(images)

it('owns a Markdown image size suffix beside an independently annotated label', () => {
  const core = createDocumentCore()
  const source = '![a{++b++}c{>>label<<}](cat.png){width=320 height=50% data-align=center} tail\n'
  const revision = core.open(source)
  for (const [mode, alt] of [['original', 'ac'], ['revised', 'abc']] as const) {
    const projection = core.project(revision, mode)
    const image = images(projection.ast.root)[0]!
    expect(imageAltText(image)).toBe(alt)
    expect(image.attributes).toMatchObject({ semanticWidth: '320', semanticHeight: '50%', semanticAlign: 'center' })
    expect(projection.markdown.slice(Number(image.attributes.sizeStart), Number(image.attributes.sizeEnd))).toBe('{width=320 height=50% data-align=center}')
    expect(projection.markdown.slice(Number(image.attributes.widthValueStart), Number(image.attributes.widthValueEnd))).toBe('320')
    expect(projection.markdown.slice(image.range.start, image.range.end)).toBe(`![${alt}](cat.png){width=320 height=50% data-align=center}`)
  }
  expect(revision.annotations.map(annotation => annotation.kind)).toEqual(['addition', 'comment'])
})

it('tracks a changed width separately from label suggestions and renders the revised size in Markup', () => {
  const core = createDocumentCore()
  const source = '![a{++b++}c{>>label<<}](cat.png){width=120}\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, { format: 'image-properties', selection: { start: 0, end: source.length - 1 }, tracked: true, properties: { width: '320' } })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('![a{++b++}c{>>label<<}](cat.png){width={~~120~>320~~}}\n')
  expect(result.annotations.map(annotation => annotation.kind)).toEqual(['addition', 'comment', 'substitution'])
  expect(images(core.project(result, 'original').ast.root)[0]?.attributes.semanticWidth).toBe('120')
  expect(images(core.project(result, 'revised').ast.root)[0]?.attributes.semanticWidth).toBe('320')
  expect(images(core.project(result, 'markup').syntax.ast.root)[0]?.attributes.semanticWidth).toBe('320')
  const rejectedLabel = core.resolve(result, result.annotations[0]!, 'reject').revision
  expect(rejectedLabel.source).toBe('![ac{>>label<<}](cat.png){width={~~120~>320~~}}\n')
  const acceptedSize = core.resolve(rejectedLabel, rejectedLabel.annotations[1]!, 'accept').revision
  expect(acceptedSize.source).toBe('![ac{>>label<<}](cat.png){width=320}\n')
})

it.each([
  '{++![x](y){width=20++}}',
  '{++![x](y){width=20 ++}}',
  '{~~![x](y){width=20~>![z](v){width=30~~}}',
  '{++![x](y)++}{width=20}',
  '![x](y){++{width=20++}}'
])('does not complete image layout across an annotation arm boundary: %s', source => {
  const core = createDocumentCore()
  const revision = core.open(source)
  for (const mode of ['original', 'revised', 'markup'] as const) {
    const projection = core.project(revision, mode)
    const ast = projection.kind === 'markup' ? projection.syntax.ast : projection.ast
    for (const image of images(ast.root)) expect(image.attributes.semanticWidth).toBeUndefined()
  }
})

it.each([
  ['width=01', '01', undefined, undefined],
  ['height=.5%', undefined, '.5%', undefined],
  ['data-align=inline width=12.5', '12.5', undefined, 'inline'],
  ['\theight=20.25% width=3 data-align=right ', '3', '20.25%', 'right']
])('recognizes the narrow layout grammar: {%s}', (fields, width, height, align) => {
  const core = createDocumentCore()
  const revision = core.open(`![x](y){${fields}}`)
  const image = images(core.project(revision, 'revised').ast.root)[0]!
  expect(image.attributes.semanticWidth).toBe(width)
  expect(image.attributes.semanticHeight).toBe(height)
  expect(image.attributes.semanticAlign).toBe(align)
  expect(image.range.end).toBe(revision.sourceLength)
})

it.each([
  '{}', '{width=0}', '{width=-1}', '{width=1px}', '{width="1"}', '{width=5.}',
  '{width=1 width=2}', '{width=1 unknown=2}', '{WIDTH=1}', '{width=1\nheight=2}',
  '{data-align=wide}', '{width=1', ' {width=1}', '\\{width=1}', '{height=0%}'
])('retains malformed or separated image layout as ordinary text: %s', suffix => {
  const core = createDocumentCore()
  const revision = core.open(`![x](y)${suffix}`)
  const projection = core.project(revision, 'revised')
  const image = images(projection.ast.root)[0]!
  expect(image.range).toEqual({ start: 0, end: 7 })
  expect(image.attributes.semanticWidth).toBeUndefined()
  expect(image.attributes.semanticHeight).toBeUndefined()
  expect(projection.markdown).toBe(revision.source)
})

it.each([
  '`![x](y){width=20}`',
  '```md\n![x](y){width=20}\n```',
  '    ![x](y){width=20}',
  '<script>![x](y){width=20}</script>',
  '[x](y){width=20}',
  '\\![x](y){width=20}'
])('does not recognize layout outside a Markdown image: %s', source => {
  const core = createDocumentCore()
  const revision = core.open(source)
  expect(images(core.project(revision, 'revised').ast.root)).toEqual([])
})

it.each(['![cat][ref]', '![ref][]', '![ref]'])('preserves layout when changing a reference image destination or title: %s', spelling => {
  const core = createDocumentCore()
  const source = `${spelling}{height=50% width=120}\n\n[ref]: cat.png "old"\n`
  const revision = core.open(source)
  const selection = { start: 0, end: source.indexOf('\n') }
  const plan = core.planFormat(revision, { format: 'image-properties', selection, tracked: false, properties: { src: 'dog.png', title: 'new' } })
  const result = core.apply(revision, plan.edits).revision
  const label = spelling === '![cat][ref]' ? 'cat' : 'ref'
  expect(result.source).toBe(`![${label}](dog.png "new"){height=50% width=120}\n\n[ref]: cat.png "old"\n`)
  expect(images(core.project(result, 'revised').ast.root)[0]?.attributes.semanticWidth).toBe('120')
})

it.each(['![cat][ref]', '![ref][]', '![ref]'])('retains layout and reference resolution after an alt edit: %s', spelling => {
  const core = createDocumentCore()
  const source = `${spelling}{width=120}\n\n[ref]: cat.png\n`
  const revision = core.open(source)
  const plan = core.planFormat(revision, { format: 'image-properties', selection: { start: 0, end: source.indexOf('\n') }, tracked: false, properties: { alt: 'dog' } })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('![dog][ref]{width=120}\n\n[ref]: cat.png\n')
  expect(images(core.project(result, 'revised').ast.root)[0]?.attributes.semanticDestination).toBe('cat.png')
})

it('preserves parser-owned source ranges across earlier edits and a title inserted before the suffix', () => {
  const core = createDocumentCore()
  const first = core.open('prefix\n\n![cat](cat.png){width=120 height=50%}\n')
  const revision = core.apply(first, [{ start: 0, end: 6, insert: 'longer prefix' }]).revision
  const image = images(core.project(revision, 'revised').ast.root)[0]!
  const plan = core.planFormat(revision, { format: 'image-properties', selection: image.range, tracked: false, properties: { title: 'caption', width: '320' } })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('longer prefix\n\n![cat](cat.png "caption"){width=320 height=50%}\n')
  const resized = images(core.project(core.open(result.source), 'revised').ast.root)[0]!
  expect(result.source.slice(Number(resized.attributes.widthValueStart), Number(resized.attributes.widthValueEnd))).toBe('320')
})

it('updates a pending width repeatedly and removes a newly added width without touching label review', () => {
  const core = createDocumentCore()
  const source = '![a{++b++}c{>>label<<}](cat.png)\n'
  let revision = core.open(source)
  for (const [width, expected] of [['120', '![a{++b++}c{>>label<<}](cat.png){++{width=120}++}\n'], ['320', '![a{++b++}c{>>label<<}](cat.png){++{width=320}++}\n'], ['', source]] as const) {
    const syntax = core.project(revision, 'markup').syntax
    const image = images(syntax.ast.root)[0]!
    const plan = core.planFormat(revision, { format: 'image-properties', selection: { start: syntax.coordinates.toSource(image.range.start, 'next'), end: syntax.coordinates.toSource(image.range.end, 'previous') }, tracked: true, properties: { width } })
    revision = core.apply(revision, plan.edits).revision
    expect(revision.source).toBe(expected)
  }
})

it.each([false, true])('resizes after a pending deletion of an existing size (tracked=%s)', tracked => {
  const core = createDocumentCore()
  const source = '![a{++b++}c{>>label<<}](cat.png){--{width=120}--}\n'
  const revision = core.open(source)
  const syntax = core.project(revision, 'markup').syntax
  const image = images(syntax.ast.root)[0]!
  const plan = core.planFormat(revision, { format: 'image-properties', selection: { start: 0, end: syntax.coordinates.toSource(image.range.end, 'previous') }, tracked, properties: { width: '320' } })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe(`![a{++b++}c{>>label<<}](cat.png){--{width=120}--}${tracked ? '{++{width=320}++}' : '{width=320}'}\n`)
  expect(images(core.project(result, 'revised').ast.root)[0]?.attributes.semanticWidth).toBe('320')
  expect(images(core.project(result, 'markup').syntax.ast.root)[0]?.attributes.semanticWidth).toBe('320')
  expect(core.projectComment(result, result.annotations[1]!).markdown).toBe('label')
})

it.each([false, true])('compiles a resized scalar that spans a partial suggestion (tracked=%s)', tracked => {
  const core = createDocumentCore()
  const source = '![a{++b++}c{>>label<<}](cat.png){width=1{~~20~>60~~}}\n'
  const revision = core.open(source)
  const plan = core.planFormat(revision, { format: 'image-properties', selection: { start: 0, end: source.length - 1 }, tracked, properties: { width: '320' } })
  const result = core.apply(revision, plan.edits).revision
  expect(result.diagnostics).toEqual([])
  expect(result.source).toBe(`![a{++b++}c{>>label<<}](cat.png){width=${tracked ? '{~~1{~~20~>60~~}~>320~~}' : '320'}}\n`)
  expect(images(core.project(result, 'revised').ast.root)[0]?.attributes.semanticWidth).toBe('320')
  expect(images(core.project(result, 'markup').syntax.ast.root)[0]?.attributes.semanticWidth).toBe('320')
  if (tracked) expect(images(core.project(result, 'original').ast.root)[0]?.attributes.semanticWidth).toBe('120')
})

it.each([false, true])('keeps the next keystroke after an image restored following a tracked clear (tracked=%s)', tracked => {
  const core = createDocumentCore()
  let revision = core.open('![a{++b++}c{>>label<<}](cat.png){width=120}\n')
  let selection
  for (const width of ['', '320']) {
    const { syntax } = core.project(revision, 'markup')
    const image = images(syntax.ast.root)[0]!
    const plan = core.planFormat(revision, {
      format: 'image-properties',
      selection: { start: 0, end: syntax.coordinates.toSource(image.range.end, 'previous') },
      properties: { width },
      tracked: width === '' || tracked
    })
    revision = core.apply(revision, plan.edits).revision
    selection = plan.selection
  }
  expect(selection).toEqual({ ranges: [{ anchor: revision.sourceLength - 1, focus: revision.sourceLength - 1 }], primary: 0 })
  const input = core.planInput(revision, {
    selection: selection!,
    range: { start: revision.sourceLength - 1, end: revision.sourceLength - 1 },
    inputType: 'insertText',
    data: 'Z',
    options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
  })
  const result = core.apply(revision, core.markupEdits(revision, input.edits)!).revision
  expect(core.project(result, 'revised').markdown).toBe('![abc](cat.png){width=320}Z\n')
  expect(core.projectComment(result, result.annotations[1]!).markdown).toBe('label')
})

it.each([false, true])('restores the complete deleted width field while retaining image height (tracked=%s)', tracked => {
  const core = createDocumentCore()
  let revision = core.open('![a{++b++}c{>>label<<}](cat.png){width=120 height=80}\n')
  for (const width of ['', '320']) {
    const { syntax } = core.project(revision, 'markup')
    const image = images(syntax.ast.root)[0]!
    const plan = core.planFormat(revision, { format: 'image-properties', selection: { start: 0, end: syntax.coordinates.toSource(image.range.end, 'previous') }, properties: { width }, tracked: width === '' || tracked })
    revision = core.apply(revision, plan.edits).revision
  }
  expect(revision.source).toBe(`![a{++b++}c{>>label<<}](cat.png)${tracked ? '{~~{{--width=120--} height=80}~>{width=320 height=80}~~}' : '{width=320 height=80}'}\n`)
  expect(core.project(revision, 'revised').markdown).toBe('![abc](cat.png){width=320 height=80}\n')
  expect(images(core.project(revision, 'markup').syntax.ast.root)[0]?.attributes).toMatchObject({ semanticWidth: '320', semanticHeight: '80' })
  expect(core.project(revision, 'original').markdown).toBe(`![ac](cat.png){width=${tracked ? '120' : '320'} height=80}\n`)
})

it('compiles a combined tracked layout action without overlapping a pending scalar suggestion', () => {
  const core = createDocumentCore()
  const revision = core.open('![a{++b++}c{>>label<<}](cat.png){width=1{++60++}}\n')
  const plan = core.planFormat(revision, { format: 'image-properties', selection: { start: 0, end: revision.sourceLength - 1 }, properties: { width: '640', height: '320' }, tracked: true })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('![a{++b++}c{>>label<<}](cat.png){~~{width=1{++60++}}~>{width=640 height=320}~~}\n')
  expect(core.project(result, 'original').markdown).toBe('![ac](cat.png){width=1}\n')
  expect(core.project(result, 'revised').markdown).toBe('![abc](cat.png){width=640 height=320}\n')
  expect(images(core.project(result, 'markup').syntax.ast.root)[0]?.attributes).toMatchObject({ semanticWidth: '640', semanticHeight: '320' })
})

it('updates multiple fields inside the existing pending layout addition', () => {
  const core = createDocumentCore()
  let revision = core.open('![a{++b++}c{>>label<<}](cat.png)\n')
  for (const properties of [{ width: '120', height: '80' }, { width: '320', height: '160' }]) {
    const { syntax } = core.project(revision, 'markup')
    const image = images(syntax.ast.root)[0]!
    const plan = core.planFormat(revision, { format: 'image-properties', selection: { start: 0, end: syntax.coordinates.toSource(image.range.end, 'previous') }, properties, tracked: true })
    revision = core.apply(revision, plan.edits).revision
  }
  expect(revision.source).toBe('![a{++b++}c{>>label<<}](cat.png){++{width=320 height=160}++}\n')
  expect(core.project(revision, 'original').markdown).toBe('![ac](cat.png)\n')
  expect(core.project(revision, 'revised').markdown).toBe('![abc](cat.png){width=320 height=160}\n')
  expect(images(core.project(revision, 'markup').syntax.ast.root)[0]?.attributes).toMatchObject({ semanticWidth: '320', semanticHeight: '160' })
})

it('adds layout outside the pending deletion at a scalar boundary', () => {
  const core = createDocumentCore()
  const revision = core.open('![a{++b++}c{>>label<<}](cat.png){width=1{--20--}}\n')
  const plan = core.planFormat(revision, { format: 'image-properties', selection: { start: 0, end: revision.sourceLength - 1 }, properties: { 'data-align': 'right' }, tracked: false })
  const result = core.apply(revision, plan.edits).revision
  expect(result.source).toBe('![a{++b++}c{>>label<<}](cat.png){width=1{--20--} data-align=right}\n')
  expect(core.project(result, 'original').markdown).toBe('![ac](cat.png){width=120 data-align=right}\n')
  expect(core.project(result, 'revised').markdown).toBe('![abc](cat.png){width=1 data-align=right}\n')
})

import { expect, it } from 'vitest'
import { renderPublicMarkdownProjectionToHtml } from './support/publicMarkdownHtmlConsumer.js'
import { createDocumentCore, type MarkdownAstNode } from '../src/index.js'
const contexts = (node: MarkdownAstNode): MarkdownAstNode[] => node.attributes['emojiAlias'] === undefined ? node.children.flatMap(contexts) : [node]

it('owns complete, unknown and incomplete emoji context without changing standards text', () => {
  const core = createDocumentCore()
  const source = 'before :smile: :unknown_alias: :smi after'
  const revised = core.project(core.open(source), 'revised')
  expect(contexts(revised.ast.root).map(node => ({ range: node.range, ...node.attributes }))).toEqual([
    expect.objectContaining({ emojiAlias: 'smile', emojiClosed: true, emojiValue: '😄', semanticText: ':smile:' }),
    expect.objectContaining({ emojiAlias: 'unknown_alias', emojiClosed: true, semanticText: ':unknown_alias:' }),
    expect.objectContaining({ emojiAlias: 'smi', emojiClosed: false, semanticText: ':smi' })
  ])
  expect(revised.markdown).toBe(source)
  expect(renderPublicMarkdownProjectionToHtml(revised)).toBe('<p>before :smile: :unknown_alias: :smi after</p>\n')
})

it('retains literal, escaped, word boundary, link destination and Markdown emphasis semantics', () => {
  const core = createDocumentCore()
  const source = 'word:smile: \\:smile: `:smile:` $:smile:$ :_smile_: [label](https://a/:smile:)\n\n```\n:smile:\n```'
  expect(contexts(core.project(core.open(source), 'revised').ast.root)).toEqual([])
})

it('projects one parser-owned alias across a CriticMarkup arm', () => {
  const core = createDocumentCore()
  const revision = core.open('before :s{++mi++}le: after{>>keep<<}')
  expect(contexts(core.project(revision, 'revised').ast.root).map(node => node.attributes['emojiAlias'])).toEqual(['smile'])
  expect(contexts(core.project(revision, 'original').ast.root).map(node => node.attributes['emojiAlias'])).toEqual(['sle'])
  expect(contexts(core.project(revision, 'markup').syntax.ast.root).map(node => node.attributes['emojiAlias'])).toEqual(['smile'])
})

it('retains emphasis semantics while recognizing aliases nested inside emphasis', () => {
  const core = createDocumentCore()
  const revised = core.project(core.open('*before :smile:* :_smile_:'), 'revised')
  expect(contexts(revised.ast.root).map(node => node.attributes['emojiAlias'])).toEqual(['smile'])
  expect(renderPublicMarkdownProjectionToHtml(revised)).toBe('<p><em>before :smile:</em> :<em>smile</em>:</p>\n')
})

it('does not combine substitution arms into a rendered alias', () => {
  const core = createDocumentCore()
  const revision = core.open('{~~:smi~>le:~~}')
  expect(contexts(core.project(revision, 'markup').syntax.ast.root).map(node => ({ alias: node.attributes['emojiAlias'], value: node.attributes['emojiValue'] }))).toEqual([{ alias: 'smi', value: undefined }])
})

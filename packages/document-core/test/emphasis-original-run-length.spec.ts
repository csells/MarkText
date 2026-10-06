import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createDocumentCore, type MarkdownOptions } from '../src/index.js'
import { renderPublicMarkdownProjectionToHtml } from './support/publicMarkdownHtmlConsumer.js'

// Upstream MarkText #5555 pairs emphasis delimiters as cmark does: the rule of
// three and the openers-bottom classes read a delimiter run's original
// length, not what earlier pairings left of it. These cases are upstream's
// own (emphasisDelimiterRuns.spec.ts) plus one from the differential corpus.

interface Example { markdown: string, html: string, section: string, example: number }
const spec = JSON.parse(readFileSync(new URL('./fixtures/commonmark-0.31.2-spec.json', import.meta.url), 'utf8')) as Example[]

const render = (source: string, gfm: boolean): string => {
  const core = createDocumentCore()
  const revision = core.open(source, { gfm, frontMatter: false } as MarkdownOptions)
  return renderPublicMarkdownProjectionToHtml(core.project(revision, 'original'))
}
const inline = (source: string, gfm = true): string =>
  render(`${source}\n`, gfm).replace(/^<p>/u, '').replace(/<\/p>\n$/u, '')

describe('emphasis pairs by original delimiter run length (upstream #5555)', () => {
  it.each([
    ['*foo***bar*', '<em>foo</em>*<em>bar</em>'],
    ['**foo***bar**', '<strong>foo</strong><em>bar</em>*'],
    ['..**a*   a*b', '..*<em>a</em>   a*b']
  ])('%s', (markdown, expected) => {
    expect(inline(markdown)).toBe(expected)
    expect(inline(markdown, false)).toBe(expected)
  })

  it.each([
    ['*a *b* c*', '<em>a <em>b</em> c</em>'],
    ['_a _b_ c_', '<em>a <em>b</em> c</em>'],
    ['*a `x*y` b*', '<em>a <code>x*y</code> b</em>'],
    ['*a [t](/u*v) b*', '<em>a <a href="/u*v">t</a> b</em>'],
    ['*foo [bar* baz]', '<em>foo [bar</em> baz]'],
    ['*[foo*](/uri)', '*<a href="/uri">foo*</a>'],
    ['*_b.__*', '<em>_b.__</em>']
  ])('keeps %s as upstream nests it', (markdown, expected) => {
    expect(inline(markdown)).toBe(expected)
  })

  // Upstream's lexer regressed here to an empty emphasis; CommonMark, the
  // previous upstream and micromark keep the escaped run literal.
  it('keeps a run broken by an escaped asterisk literal', () => {
    expect(inline('a*\\*b')).toBe('a**b')
  })

  it('passes every CommonMark 0.31.2 emphasis example', () => {
    const examples = spec.filter(example => example.section === 'Emphasis and strong emphasis')
    expect(examples.length).toBeGreaterThan(100)
    const failing = examples.filter(example => render(example.markdown, false) !== example.html)
    expect(failing.map(example => example.example)).toEqual([])
  })
})

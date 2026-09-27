import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentRevision } from '../src/index.js'
import { projectionSignature } from '../src/trackedExtent.js'
import { renderPublicMarkdownProjectionToHtml } from './support/publicMarkdownHtmlConsumer.js'

// Block structure that a 6,000-document differential against micromark
// (CommonMark 0.31.2) and marked (upstream MarkText's parser) found Core
// reading differently. Expected HTML is written down from those parsers;
// whitespace between block tags is not significant here.

const canonical = (html: string): string => html
  .replace(/<input([^>]*?)\s*\/?>/gu, (_match, attributes: string) =>
    `<input ${attributes.trim().split(/\s+/u).sort().join(' ')}>`)
  .replace(/\s+/gu, ' ')
  .replace(/\s*(<\/?(?:p|li|ul|ol|blockquote|h[1-6]|pre|table|thead|tbody|tr|th|td|hr \/)[^>]*>)\s*/gu, '$1')
  .trim()

const html = (source: string, gfm = false): string => {
  const core = createDocumentCore()
  const revision = core.open(source, {
    gfm,
    gfmTagFilter: false,
    gfmAutolinks: false,
    frontMatter: false,
    texMathDollars: false,
    texMathGfm: false,
    footnotes: false,
    subscriptAndSuperscript: false
  })
  return canonical(renderPublicMarkdownProjectionToHtml(core.project(revision, 'original')))
}

describe('CommonMark and upstream agree', () => {
  it.each([
    // A `-` run under a paragraph is its setext underline, not an empty item.
    ['Foo\n-\n', '<h2>Foo</h2>'],
    ['Foo\n- \n', '<h2>Foo</h2>'],
    ['bar\n   -\n', '<h2>bar</h2>'],
    ['=\n-\n', '<h2>=</h2>'],
    ['--\n-\n', '<h2>--</h2>'],
    ['Foo\nbar\n-\n', '<h2>Foo bar</h2>'],
    ['> a\n> -\n', '<blockquote><h2>a</h2></blockquote>'],
    ['* b\n   -\n', '<ul><li><h2>b</h2></li></ul>'],
    ['- a\n  -\n', '<ul><li><h2>a</h2></li></ul>'],
    ['- a\n  - \n    b\n', '<ul><li><h2>a</h2>b</li></ul>'],
    // An empty item cannot interrupt a paragraph.
    ['alpha\n+\n', '<p>alpha +</p>'],
    ['alpha\n1.\n', '<p>alpha 1.</p>'],
    // A lazy line is paragraph text even when it looks like an underline.
    ['> q\n=\n', '<blockquote><p>q =</p></blockquote>'],
    ['> q\n--\n', '<blockquote><p>q --</p></blockquote>'],
    ['> q\n=\n=\n', '<blockquote><p>q = =</p></blockquote>'],
    // An empty item's blank line does not end its list.
    ['-\n\n-\n', '<ul><li></li><li></li></ul>'],
    ['+\n\n+\n', '<ul><li></li><li></li></ul>'],
    ['1.\n\n2.\n', '<ol><li></li><li></li></ol>'],
    ['>\n\n-\n2) d\n', '<blockquote></blockquote><ul><li></li></ul><ol start="2"><li>d</li></ol>'],
    // A container opened on the line ends the paragraph before it.
    ['Foo\n>     code\n', '<p>Foo</p><blockquote><pre><code>code </code></pre></blockquote>'],
    ['- a\n>     code\n', '<ul><li>a</li></ul><blockquote><pre><code>code </code></pre></blockquote>'],
    // A container marker is not indented code content.
    ['    x\n>     code\n', '<pre><code>x </code></pre><blockquote><pre><code>code </code></pre></blockquote>'],
    ['    code\n>\n    code\n', '<pre><code>code </code></pre><blockquote></blockquote><pre><code>code </code></pre>'],
    // A setext heading closes its paragraph, so a following item may start.
    ['Foo\n=\n-\n', '<h1>Foo</h1><ul><li></li></ul>'],
    ['bar\n-\n-\n', '<h2>bar</h2><ul><li></li></ul>'],
    ['bar\n=\n+\n', '<h1>bar</h1><ul><li></li></ul>']
  ])('%j', (source, expected) => {
    expect(html(source)).toBe(canonical(expected))
  })
})

describe('where CommonMark and upstream differ (Profile 1)', () => {
  it.each([
    // CommonMark: a lazy continuation line never underlines a list item's
    // paragraph. marked makes these headings inside the item.
    ['- a\n=\n', '<ul><li>a =</li></ul>'],
    ['- a\n--\n', '<ul><li>a --</li></ul>'],
    ['> - y\n=\n', '<blockquote><ul><li>y =</li></ul></blockquote>'],
    // CommonMark: an indented `-` run underlines every paragraph; marked
    // skips it after a line that looks like a list marker.
    ['Foo\n2) d\n   -\n', '<h2>Foo 2) d</h2>'],
    // Upstream: inside a list item an empty or renumbered item nests.
    ['1. alpha\n   1.\n', '<ol><li>alpha<ol><li></li></ol></li></ol>'],
    ['- alpha\n  +\n', '<ul><li>alpha<ul><li></li></ul></li></ul>'],
    // Upstream: a renumbered item stays a lazy line of the quote.
    ['> q\n2) d\n', '<blockquote><p>q 2) d</p></blockquote>']
  ])('%j', (source, expected) => {
    expect(html(source)).toBe(canonical(expected))
  })
})

const reading = (core: ReturnType<typeof createDocumentCore>, revision: DocumentRevision): unknown => ({
  source: revision.source,
  syntax: projectionSignature(core.project(revision, 'markup').syntax.ast.root),
  original: core.project(revision, 'original').markdown,
  annotations: revision.annotations.map(annotation => [annotation.kind, annotation.range.start, annotation.range.end])
})

describe('typing these lines reads as a fresh open', () => {
  it.each([
    ['Foo\n\n', 4, '-'],
    ['Foo\n\n', 4, '='],
    ['Foo\n-\n', 5, ' '],
    ['Foo\n-\n', 5, 'x'],
    ['Foo\n-\n', 4, '1.'],
    ['> q\n\n', 4, '='],
    ['> q\n\n', 4, '--'],
    ['-\n\n-\n', 1, 'a'],
    ['Foo\n\n', 4, '>     code'],
    ['    x\n\n', 6, '>'],
    ['a {++b++}\n\n', 10, '-'],
    ['{++a++}\n-\n\n{--b--}\n', 8, 'x']
  ])('%j at %i types %j', (source, at, insert) => {
    const core = createDocumentCore()
    const previous = core.open(source)
    reading(core, previous)
    const next = core.apply(previous, [{ start: at, end: at, insert }]).revision
    const fresh = createDocumentCore()
    expect(reading(core, next)).toEqual(reading(fresh, fresh.open(next.source)))
  })
})

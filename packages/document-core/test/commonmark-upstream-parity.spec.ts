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
    // Inside an HTML block a marker-only line is content, not a blank line.
    ['<div>\n- \n', '<div>\n-'],
    ['<div>\n1.\n', '<div>\n1.'],
    ['<div>\n> =\n>\n', '<div>\n> =\n>'],
    ['</div>\n> - y\n> -\n', '</div>\n> - y\n> -'],
    // A setext heading closes its paragraph, so a following item may start.
    ['Foo\n=\n-\n', '<h1>Foo</h1><ul><li></li></ul>'],
    ['bar\n-\n-\n', '<h2>bar</h2><ul><li></li></ul>'],
    ['bar\n=\n+\n', '<h1>bar</h1><ul><li></li></ul>'],
    // An open fence owns its line, so a container marker there is code text
    // and the fence spelled after it does not close the block.
    ['```\n>```', '<pre><code>&gt;```\n</code></pre>'],
    ['~~~\n> ~~~\ny\n', '<pre><code>&gt; ~~~\ny\n</code></pre>'],
    ['~~~\n+ ~~~\n', '<pre><code>+ ~~~\n</code></pre>'],
    ['0. ~~~\n   >~~~\n', '<ol start="0"><li><pre><code>&gt;~~~\n</code></pre></li></ol>'],
    // A closer is at least as long as its opener, and a tilde fence's info
    // string may hold a backtick.
    ['```\n`\n', '<pre><code>`\n</code></pre>'],
    ['````\n```\n', '<pre><code>```\n</code></pre>'],
    ['~~~`\n', '<pre><code class="language-`"></code></pre>'],
    // An unfinished reference definition is still the paragraph it began:
    // its lines continue lazily, take a setext underline, and end where a
    // block interrupts the paragraph.
    ['1. [\ny\n', '<ol><li>[ y</li></ol>'],
    ['> [\nc\n', '<blockquote><p>[ c</p></blockquote>'],
    ['[\n3) y\n', '<p>[ 3) y</p>'],
    ['[\n-\n', '<h2>[</h2>'],
    ['[a\nb\n-\n', '<h2>[a b</h2>'],
    ['2. [\n   -\n', '<ol start="2"><li><h2>[</h2></li></ol>'],
    ['[f]:\n1.\n', ''],
    ['[a]:\n> /u\n', '<p>[a]:</p><blockquote><p>/u</p></blockquote>'],
    ['- [a]:\n  /u\n  [a]\n', '<ul><li><a href="/u">a</a></li></ul>'],
    // A container opened earlier on the line has ended the paragraph, so an
    // empty or renumbered item after it is a list.
    ['> y\n* 0.\n', '<blockquote><p>y</p></blockquote><ul><li><ol start="0"><li></li></ol></li></ul>'],
    ['> .\n- 2.\n', '<blockquote><p>.</p></blockquote><ul><li><ol start="2"><li></li></ol></li></ul>'],
    // So does an item that holds only such an item (micromark alone keeps
    // the inner marker as text).
    ['a\n- -\n', '<p>a</p><ul><li><ul><li></li></ul></li></ul>'],
    ['a\n+ 0.\n', '<p>a</p><ul><li><ol start="0"><li></li></ol></li></ul>'],
    // Upstream nests an empty or renumbered item under a list item's own
    // paragraph only; one in a block quote inside the item keeps the rule.
    ['- a\n  > q\n  > 2) d\n', '<ul><li>a<blockquote><p>q 2) d</p></blockquote></li></ul>'],
    ['1. > |\n   > 3)\n', '<ol><li><blockquote><p>| 3)</p></blockquote></li></ol>'],
    // Four columns in, a `---` or `#` line continues the paragraph.
    ['> a\n>     ---\n', '<blockquote><p>a ---</p></blockquote>'],
    ['> a\n    ***\nb\n', '<blockquote><p>a *** b</p></blockquote>'],
    ['> a\n    # h\n', '<blockquote><p>a # h</p></blockquote>'],
    ['- a\n      ***\n', '<ul><li>a ***</li></ul>'],
    ['- \\\n      ---\n', '<ul><li><br />\n---</li></ul>'],
    // A blank line ends a block quote, so one reopened after it with code or
    // HTML is a second quote.
    ['>\n\n>     x\n', '<blockquote></blockquote><blockquote><pre><code>x\n</code></pre></blockquote>'],
    ['> a\n\n>     x\n', '<blockquote><p>a</p></blockquote><blockquote><pre><code>x\n</code></pre></blockquote>'],
    ['>\n\n><e>\n', '<blockquote></blockquote><blockquote><e></blockquote>'],
    ['>\n\n>```\n', '<blockquote></blockquote><blockquote><pre><code></code></pre></blockquote>'],
    // A code span, link or raw tag may close on a later line of a list item
    // or block quote; the container prefixes between are not its content.
    ['- `a\n  b`\n', '<ul><li><code>a b</code></li></ul>'],
    ['> `a\n> b`\n', '<blockquote><p><code>a b</code></p></blockquote>'],
    ['1. `\n`\n', '<ol><li><code> </code></li></ol>'],
    ['> [a\n> b](/u)\n', '<blockquote><p><a href="/u">a\nb</a></p></blockquote>'],
    ['- a `b\n  c` [d\n  e](/f)\n', '<ul><li>a <code>b c</code> <a href="/f">d\ne</a></li></ul>'],
    ['- [a\n  b]\n\n[a b]: /u\n', '<ul><li><a href="/u">a\nb</a></li></ul>'],
    ['- <span\n  a="b">\n', '<ul><li><span\na="b"></li></ul>'],
    // After a lazy line, a list item still ends the paragraph a code span
    // opened in, so its backtick closes nothing there.
    ['1. `\na\n3. `c`\n', '<ol><li>` a</li><li><code>c</code></li></ol>'],
    // A title on a definition's own line completes it.
    ['[f]: /u "t"\n"s"\n[f]\n', '<p>&quot;s&quot;\n<a href="/u" title="t">f</a></p>'],
    ['[f]:l ""\n""\n', '<p>&quot;&quot;</p>'],
    // An unclosed quote after a definition is no title of it.
    ['[ref]\n\n[ref]:l\n"\n', '<p><a href="l">ref</a></p><p>&quot;</p>'],
    ['[f]: /u ""\n[f]\n', '<p><a href="/u">f</a></p>'],
    // A lazy line after a complete definition stays in its containers.
    ['> [f]: /u\ns\n', '<blockquote><p>s</p></blockquote>'],
    ['1. [f]: /u\no\n', '<ol><li>o</li></ol>'],
    ['> [f]: /u "t"\n"s"\n', '<blockquote><p>&quot;s&quot;</p></blockquote>']
  ])('%j', (source, expected) => {
    expect(html(source)).toBe(canonical(expected))
  })

  it.each([
    // GFM reads a paragraph's last line as the header of a table below it.
    ['Foo\n| a | b |\n|---|---|\n', '<p>Foo</p><table><thead><tr><th>a</th><th>b</th></tr></thead></table>'],
    // Another block ends the table.
    ['| a | b |\n|---|---|\n# h\n', '<table><thead><tr><th>a</th><th>b</th></tr></thead></table><h1>h</h1>'],
    ['| a | b |\n|---|---|\n***\n', '<table><thead><tr><th>a</th><th>b</th></tr></thead></table><hr />'],
    // A task marker begins a paragraph; an underlined one is heading text.
    ['- [ ] t\n  =\n', '<ul><li><h1>[ ] t</h1></li></ul>'],
    ['x|y\n-|-\n> 3)\n', '<table><thead><tr><th>x</th><th>y</th></tr></thead></table><blockquote><ol start="3"><li></li></ol></blockquote>'],
    // A row without a pipe is one cell; so is a delimiter row with a colon.
    ['a\n-|\nb\n', '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>'],
    ['a|b\n-|-\n|\n', '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td></td><td></td></tr></tbody></table>'],
    ['a\n:-\n', '<table><thead><tr><th align="left">a</th></tr></thead></table>'],
    ['Foo\nbar\n-|\n', '<p>Foo</p><table><thead><tr><th>bar</th></tr></thead></table>'],
    ['a\n---\n', '<h2>a</h2>'],
    // A definition the lane read on a later line is no table row.
    ['> + `\n-|\n>   -\n>   [t]: /u\n', '<blockquote><ul><li><table><thead><tr><th>`</th></tr></thead><tbody><tr><td>-</td></tr></tbody></table></li></ul></blockquote>'],
    // The header is paragraph text, never another block's line.
    ['|\n-|\n', '<p>|\n-|</p>'],
    ['~~~\n-|\n', '<pre><code>-|\n</code></pre>'],
    ['#\n-|\n', '<h1></h1><p>-|</p>'],
    ['    o\n-|\n', '<pre><code>o\n</code></pre><p>-|</p>'],
    // A delimiter row four columns in, or on a lazy line, is paragraph text.
    ['x|y\n    -|-\n', '<p>x|y\n-|-</p>'],
    ['> a|b\n-|-\n', '<blockquote><p>a|b\n-|-</p></blockquote>'],
    // Strikethrough pairs tilde runs of one length only.
    ['~l~~\n', '<p>~l~~</p>'],
    ['~~l~\n', '<p>~~l~</p>'],
    ['~l~ ~~m~~\n', '<p><del>l</del> <del>m</del></p>']
  ])('GFM %j', (source, expected) => {
    expect(html(source, true)).toBe(canonical(expected))
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
    ['> q\n2) d\n', '<blockquote><p>q 2) d</p></blockquote>'],
    // Upstream: a complete reference definition stands alone, so an indented
    // line after it is code and a `-` opens a list. CommonMark reads both as
    // text of the paragraph the definition began.
    ['[a]: /u\n    x\n', '<pre><code>x\n</code></pre>'],
    ['[a]: /u\n-\n', '<ul><li></li></ul>'],
    ['> [f]: "\n    *\n', '<blockquote><pre><code>*\n</code></pre></blockquote>']
  ])('%j', (source, expected) => {
    expect(html(source)).toBe(canonical(expected))
  })

  it.each([
    // Upstream: a lazy line ends a quoted table and continues the quote as a
    // paragraph. GFM ends the quote with the table.
    ['> a|b\n> -|-\nc|d\n', '<blockquote><table><thead><tr><th>a</th><th>b</th></tr></thead></table><p>c|d</p></blockquote>'],
    // Upstream: a lazy line in a list item is a row of the item's table, or
    // its delimiter row.
    ['- a|b\n  -|-\nc|d\n', '<ul><li><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>c</td><td>d</td></tr></tbody></table></li></ul>'],
    ['- a|b\n-|-\n', '<ul><li><table><thead><tr><th>a</th><th>b</th></tr></thead></table></li></ul>'],
    // Upstream: a definition's destination may be a delimiter-looking line.
    // GFM starts a table under its label.
    ['[f]:\n-|\n', '']
  ])('GFM %j', (source, expected) => {
    expect(html(source, true)).toBe(canonical(expected))
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
    ['<div>\n\n', 6, '- '],
    ['- [ ] t\n\n', 8, '  ='],
    ['Foo\n\n|---|---|\n', 4, '| a | b |'],
    ['a {++b++}\n\n', 10, '-'],
    ['{++a++}\n-\n\n{--b--}\n', 8, 'x'],
    ['~~~\n\ny\n', 4, '> ~~~'],
    ['```\n\n', 4, '`'],
    ['1. [\n\n', 5, 'y'],
    ['[\n\n', 2, '-'],
    ['[f]:\n\n', 5, '1.'],
    ['> y\n\n', 4, '* 0.'],
    ['a\n\n', 2, '- -'],
    ['- a\n  > q\n\n', 10, '  > 2) d'],
    ['> a\n\n', 4, '    ---'],
    ['>\n\n', 3, '>     x'],
    ['>\n\n', 3, '><e>'],
    ['- `a\n\n', 5, '  b`'],
    ['> [a\n\n', 5, '> b](/u)'],
    ['a\n\n', 2, ':-'],
    ['1. `\na\n\n', 7, '3. `c`'],
    ['[f]: /u "t"\n\n', 12, '"s"'],
    ['> [f]: /u\n\n', 10, 's'],
    ['1. [f]: /u\n\n', 11, 'o'],
    ['> a|b\n> -|-\n\n', 12, 'c|d']
  ])('%j at %i types %j', (source, at, insert) => {
    const core = createDocumentCore()
    const previous = core.open(source)
    reading(core, previous)
    const next = core.apply(previous, [{ start: at, end: at, insert }]).revision
    const fresh = createDocumentCore()
    expect(reading(core, next)).toEqual(reading(fresh, fresh.open(next.source)))
  })
})

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
    // An empty item's blank line ends it however far it is indented.
    ['-\n  \n  x\n', '<ul><li></li></ul><p>x</p>'],
    ['1)\n\t\n   >\n', '<ol><li></li></ol><blockquote></blockquote>'],
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
    // Where upstream would nest a bare marker under an item's paragraph, it
    // is heading text when the paragraph goes on to a setext underline.
    ['2) .\n   3.\n   =\n', '<ol start="2"><li><h1>. 3.</h1></li></ol>'],
    ['2) _\n   5)\n   -\n', '<ol start="2"><li><h2>_ 5)</h2></li></ol>'],
    ['- a\n  +\n  b\n  =\n', '<ul><li><h1>a + b</h1></li></ul>'],
    // Only a marker inside the item's text: a sibling list starts as before.
    ['3) c\n-\n-\n', '<ol start="3"><li>c</li></ol><ul><li></li><li></li></ul>'],
    ['+ ]\n1.\n-\n', '<ul><li>]</li></ul><ol><li></li></ol><ul><li></li></ul>'],
    ['> - a\n>   4.\n>   =\n', '<blockquote><ul><li><h1>a 4.</h1></li></ul></blockquote>'],
    // Once a list has opened in an item, its later paragraphs read markers
    // as CommonMark does.
    ['* -\n\n  |\n  4.\n', '<ul><li><ul><li></li></ul><p>| 4.</p></li></ul>'],
    ['- - a\n\n  |\n  2) x\n', '<ul><li><ul><li>a</li></ul><p>| 2) x</p></li></ul>'],
    ['1. - a\n\n   b\n   2) c\n', '<ol><li><ul><li>a</li></ul><p>b 2) c</p></li></ol>'],
    // A complete HTML tag on a lazy line interrupts the quoted paragraph and
    // opens an HTML block inside the quote.
    ['> a\n<n>\n', '<blockquote><p>a</p><n></blockquote>'],
    ['>|\n<l>\n* ;\n', '<blockquote><p>|</p><l></blockquote><ul><li>;</li></ul>'],
    ['> `a\n<n>\n> b`\n', '<blockquote><p>`a</p><n>\nb`</blockquote>'],
    ['> > a\n<n>\n', '<blockquote><blockquote><p>a</p><n></blockquote></blockquote>'],
    // A closing tag keeps its lazy line in a list item, and a marker inside
    // an item's fence or HTML block is its content.
    ['1. ]\n</e>\n', '<ol><li>]\n</e></li></ol>'],
    ['0. ~~~\n   -\n', '<ol start="0"><li><pre><code>-\n</code></pre></li></ol>'],
    ['+ <e>\n  +\n', '<ul><li><e>\n+</li></ul>'],
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
    ['> <span\n> a="b">\n', '<blockquote><p><span\na="b"></p></blockquote>'],
    ['> x <span\n> a="b"\n> c="d"> y\n', '<blockquote><p>x <span\na="b"\nc="d"> y</p></blockquote>'],
    ['<span\n# h>\n', '<p>&lt;span</p><h1>h&gt;</h1>'],
    ['> [a\n> b]\n>\n> [a b]: /u\n', '<blockquote><p><a href="/u">a\nb</a></p></blockquote>'],
    ['> [x][a\n> b]\n>\n> [a b]: /u\n', '<blockquote><p><a href="/u">x</a></p></blockquote>'],
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
    // An ordered item's `[ ]` with nothing after it is the item's text.
    ['3) [ ] \n', '<ol start="3"><li>[ ]</li></ol>'],
    ['1. a\n2. [ ] \n', '<ol><li>a</li><li>[ ]</li></ol>'],
    ['1. [ ] \n   x\n', '<ol><li>[ ]\nx</li></ol>'],
    // With text after it the marker is a task's, as GFM reads it.
    ['1. [ ] x\n', '<ol><li><input disabled="" type="checkbox"> x</li></ol>'],
    ['x|y\n-|-\n> 3)\n', '<table><thead><tr><th>x</th><th>y</th></tr></thead></table><blockquote><ol start="3"><li></li></ol></blockquote>'],
    // A row without a pipe is one cell; so is a delimiter row with a colon.
    ['a\n-|\nb\n', '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>'],
    ['a|b\n-|-\n|\n', '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td></td><td></td></tr></tbody></table>'],
    ['a\n:-\n', '<table><thead><tr><th align="left">a</th></tr></thead></table>'],
    ['Foo\nbar\n-|\n', '<p>Foo</p><table><thead><tr><th>bar</th></tr></thead></table>'],
    ['a\n---\n', '<h2>a</h2>'],
    // A table interrupts the paragraph above its header, so a complete HTML
    // tag there starts an HTML block, as it would anywhere else.
    ['a\n<l>\n-|\n', '<p>a</p><l>\n-|'],
    ['> a\n> <l>\n> -|\n', '<blockquote><p>a</p><l>\n-|</blockquote>'],
    // A code span pairs backticks inside one cell only.
    ['`||`c`\n-|-|-\n', '<table><thead><tr><th>`</th><th></th><th><code>c</code></th></tr></thead></table>'],
    ['b|`|`c`\n-|-|-\n', '<table><thead><tr><th>b</th><th>`</th><th><code>c</code></th></tr></thead></table>'],
    // A definition cannot start inside a table: that line is a row.
    ['a|b\n-|-\n[r]: /u\n', '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>[r]: /u</td><td></td></tr></tbody></table>'],
    // A table's rows end where indented code, or a bullet or `1.` item
    // followed by a space, begins.
    ['a|b\n-|-\n    x\n', '<table><thead><tr><th>a</th><th>b</th></tr></thead></table><pre><code>x\n</code></pre>'],
    ['a|b\n-|-\nc|d\n\tx\n', '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>c</td><td>d</td></tr></tbody></table><pre><code>x\n</code></pre>'],
    ['a|b\n-|-\n- \n', '<table><thead><tr><th>a</th><th>b</th></tr></thead></table><ul><li></li></ul>'],
    ['a|b\n-|-\n1. \n', '<table><thead><tr><th>a</th><th>b</th></tr></thead></table><ol><li></li></ol>'],
    ['- a|b\n  -|-\n      x\n', '<ul><li><table><thead><tr><th>a</th><th>b</th></tr></thead></table><pre><code>x\n</code></pre></li></ul>'],
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
    ['- a\n  4.\n      =\n', '<ul><li>a<ol start="4"><li>=</li></ol></li></ul>'],
    // Upstream: a lazy `=` after a bare marker that would nest still keeps
    // the marker as text, and the `=` is text as CommonMark reads it.
    ['- a\n  4.\n=\n', '<ul><li>a 4. =</li></ul>'],
    // Upstream: a fenced list marker does not open a list in the item, so
    // a later paragraph still nests an empty item.
    ['- ```\n  - x\n  ```\n  b\n  4.\n', '<ul><li><pre><code>- x\n</code></pre>b<ol start="4"><li></li></ol></li></ul>'],
    // Upstream: a renumbered item stays a lazy line of the quote.
    ['> q\n2) d\n', '<blockquote><p>q 2) d</p></blockquote>'],
    // Upstream: the same line ends a list item, and everything inside it.
    // micromark keeps it in the item.
    ['- a\n<n>\n', '<ul><li>a</li></ul><n>'],
    ['> - a\n<n>\n', '<blockquote><ul><li>a</li></ul><n></blockquote>'],
    ['- > a\n<n>\n', '<ul><li><blockquote><p>a</p></blockquote></li></ul><n>'],
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
    // Upstream: `-` alone, `1.` alone or a renumbered item after a table
    // is a row. GFM starts a list there.
    ['a|b\n-|-\n-\n', '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>-</td><td></td></tr></tbody></table>'],
    ['a|b\n-|-\n2. x\n', '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>2. x</td><td></td></tr></tbody></table>'],
    ['> a|b\n> -|-\n    x\n', '<blockquote><table><thead><tr><th>a</th><th>b</th></tr></thead></table><pre><code>x\n</code></pre></blockquote>'],
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
    ['1. a\n\n', 5, '2. [ ] '],
    ['3) [ ] \n', 7, 'x'],
    ['- [ ] x\n1. y\n', 11, '[ ] '],
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
    ['> a\n\n', 4, '<n>'],
    ['- a\n\n', 4, '<n>'],
    ['-\n  \n', 5, '  x'],
    ['> <span\n\n', 8, '> a="b">'],
    ['2) .\n   3.\n\n', 11, '   ='],
    ['* -\n\n  |\n\n', 9, '  4.'],
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
    ['> a|b\n> -|-\n\n', 12, 'c|d'],
    ['a|b\n-|-\n\n', 8, '    x'],
    ['a|b\n-|-\n\n', 8, '- '],
    ['a|b\n-|-\nc|d\n', 12, '\n    x']
  ])('%j at %i types %j', (source, at, insert) => {
    const core = createDocumentCore()
    const previous = core.open(source)
    reading(core, previous)
    const next = core.apply(previous, [{ start: at, end: at, insert }]).revision
    const fresh = createDocumentCore()
    expect(reading(core, next)).toEqual(reading(fresh, fresh.open(next.source)))
  })
})

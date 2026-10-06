import { describe, expect, it } from 'vitest'

import { projectPandocExport } from '@/documentConsumers/pandocExportProjection'
import type { PandocJsonNode } from '@shared/types/files'

// Plan 0012 G40: every Pandoc export is built from Core's parse. The expected
// nodes are what pandoc's own `gfm` reader makes of the same Markdown, which is
// what upstream MarkText exported, except where the cases below say otherwise.

const str = (c: string): PandocJsonNode => ({ t: 'Str', c })
const space: PandocJsonNode = { t: 'Space' }
const attr = (id = '', classes: string[] = [], pairs: string[][] = []): unknown => [id, classes, pairs]
const para = (...c: PandocJsonNode[]): PandocJsonNode => ({ t: 'Para', c })
const plain = (...c: PandocJsonNode[]): PandocJsonNode => ({ t: 'Plain', c })
const words = (text: string): PandocJsonNode[] =>
  text.split(' ').flatMap((word, index) => (index > 0 ? [space, str(word)] : [str(word)]))

const blocks = (source: string, options = {}, target = 'html'): PandocJsonNode[] =>
  projectPandocExport(source, options, target).blocks
const inlines = (source: string, options = {}): unknown => {
  const [first] = blocks(source, options)
  return first?.c
}

describe('Pandoc AST from Core for ordinary Markdown (G40)', () => {
  it('writes ATX and setext headings with pandoc\'s GitHub identifiers', () => {
    expect(blocks('# Head `code` **b**\n\nSetext\n======\n\n## A -- B\n')).toEqual([
      {
        t: 'Header',
        c: [1, attr('head-code-b'), [str('Head'), space, { t: 'Code', c: [attr(), 'code'] }, space, { t: 'Strong', c: [str('b')] }]]
      },
      { t: 'Header', c: [1, attr('setext'), [str('Setext')]] },
      { t: 'Header', c: [2, attr('a----b'), words('A -- B')] }
    ])
  })

  it('numbers repeated identifiers per base, as GitHub does', () => {
    const ids = blocks('# a\n\n# a\n\n# a-1\n\n# !!!\n\n# \n\n# a<br>b\n\n# Hi :smile:\n').map(
      (block) => (block.c as [number, [string]])[1][0]
    )
    expect(ids).toEqual(['a', 'a-1', 'a-1', '', '-1', 'a-b', 'hi-smile'])
  })

  it('writes emphasis, strong, strikethrough and inline code', () => {
    expect(inlines('Para *em* _em2_ **st** ~~del~~ `c`\n')).toEqual([
      str('Para'),
      space,
      { t: 'Emph', c: [str('em')] },
      space,
      { t: 'Emph', c: [str('em2')] },
      space,
      { t: 'Strong', c: [str('st')] },
      space,
      { t: 'Strikeout', c: [str('del')] },
      space,
      { t: 'Code', c: [attr(), 'c'] }
    ])
  })

  it('merges neighbouring text the way pandoc\'s builder does', () => {
    expect(inlines('a&amp;b \\* &copy;\n')).toEqual([str('a&b'), space, str('*'), space, str('©')])
  })

  it('writes links, images and every autolink with their targets and titles', () => {
    expect(
      inlines('[l](http://a "t") ![i *j*](p.png "T") <http://auto> <a@b.com> www.bare.com https://x.y c@d.com\n')
    ).toEqual([
      { t: 'Link', c: [attr(), [str('l')], ['http://a', 't']] },
      space,
      { t: 'Image', c: [attr(), [str('i'), space, { t: 'Emph', c: [str('j')] }], ['p.png', 'T']] },
      space,
      { t: 'Link', c: [attr(), [str('http://auto')], ['http://auto', '']] },
      space,
      { t: 'Link', c: [attr(), [str('a@b.com')], ['mailto:a@b.com', '']] },
      space,
      { t: 'Link', c: [attr(), [str('www.bare.com')], ['http://www.bare.com', '']] },
      space,
      { t: 'Link', c: [attr(), [str('https://x.y')], ['https://x.y', '']] },
      space,
      { t: 'Link', c: [attr(), [str('c@d.com')], ['mailto:c@d.com', '']] }
    ])
  })

  it('keeps a link\'s path as written rather than percent-encoded', () => {
    expect(inlines('[a](<my file.md>) ![b](pics/\u00fc.png)\n')).toEqual([
      { t: 'Link', c: [attr(), [str('a')], ['my file.md', '']] },
      space,
      { t: 'Image', c: [attr(), [str('b')], ['pics/\u00fc.png', '']] }
    ])
  })

  it('keeps nested strong nested and whitespace from a character reference literal', () => {
    expect(inlines('****foo**** &#9;x\n')).toEqual([
      { t: 'Strong', c: [{ t: 'Strong', c: [str('foo')] }] },
      space,
      str('\tx')
    ])
  })

  it('resolves reference links and drops their definitions', () => {
    expect(blocks('[ref]: http://ref "T"\n\nA [ref] and [text][ref].\n')).toEqual([
      para(
        str('A'),
        space,
        { t: 'Link', c: [attr(), [str('ref')], ['http://ref', 'T']] },
        space,
        str('and'),
        space,
        { t: 'Link', c: [attr(), [str('text')], ['http://ref', 'T']] },
        str('.')
      )
    ])
  })

  it('writes fenced code with its language and indented code without one', () => {
    expect(blocks('```js title\ncode\n```\n\n    indented\n\n```\n\n```\n')).toEqual([
      { t: 'CodeBlock', c: [attr('', ['js']), 'code'] },
      { t: 'CodeBlock', c: [attr(), 'indented'] },
      { t: 'CodeBlock', c: [attr(), ''] }
    ])
  })

  it('keeps the last newline of a fence left open to the end of the document', () => {
    expect(blocks('> ```\n> aaa\n\n```\nbbb\n')).toEqual([
      { t: 'BlockQuote', c: [{ t: 'CodeBlock', c: [attr(), 'aaa'] }] },
      { t: 'CodeBlock', c: [attr(), 'bbb\n'] }
    ])
  })

  it('writes a diagram as the code block pandoc reads it as', () => {
    expect(blocks('```mermaid\ngraph\n```\n')).toEqual([
      { t: 'CodeBlock', c: [attr('', ['mermaid']), 'graph'] }
    ])
  })

  it('writes block quotes, thematic breaks and hard and soft breaks', () => {
    expect(blocks('> quote\n\n---\n\nx  \nhard\\\nsoft\nline\n')).toEqual([
      { t: 'BlockQuote', c: [para(str('quote'))] },
      { t: 'HorizontalRule' },
      para(str('x'), { t: 'LineBreak' }, str('hard'), { t: 'LineBreak' }, str('soft'), { t: 'SoftBreak' }, str('line'))
    ])
  })

  it('keeps ordered lists\' start, delimiter and tightness', () => {
    expect(blocks('1) one\n2) two\n\n- x\n\n3. a\n\n   b\n4. c\n')).toEqual([
      {
        t: 'OrderedList',
        c: [[1, { t: 'Decimal' }, { t: 'OneParen' }], [[plain(str('one'))], [plain(str('two'))]]]
      },
      { t: 'BulletList', c: [[plain(str('x'))]] },
      {
        t: 'OrderedList',
        c: [[3, { t: 'Decimal' }, { t: 'Period' }], [[para(str('a')), para(str('b'))], [para(str('c'))]]]
      }
    ])
  })

  it('writes task items as the ballot boxes pandoc uses', () => {
    expect(blocks('- [ ] task\n- [x] done\n')).toEqual([
      {
        t: 'BulletList',
        c: [[plain(str('☐'), space, str('task'))], [plain(str('☒'), space, str('done'))]]
      }
    ])
  })

  it('writes tables with column alignment', () => {
    const cell = (text: string): unknown => [attr(), { t: 'AlignDefault' }, 1, 1, [plain(str(text))]]
    expect(blocks('| a | b | c |\n|:--|--:|:-:|\n| 1 | 2 | 3 |\n')).toEqual([
      {
        t: 'Table',
        c: [
          attr(),
          [null, []],
          [
            [{ t: 'AlignLeft' }, { t: 'ColWidthDefault' }],
            [{ t: 'AlignRight' }, { t: 'ColWidthDefault' }],
            [{ t: 'AlignCenter' }, { t: 'ColWidthDefault' }]
          ],
          [attr(), [[attr(), [cell('a'), cell('b'), cell('c')]]]],
          [[attr(), 0, [], [[attr(), [cell('1'), cell('2'), cell('3')]]]]],
          [attr(), []]
        ]
      }
    ])
  })

  it('writes footnotes where they are referenced, when the preference enables them', () => {
    const source = 'A[^1] b[^x].\n\n[^1]: Note *one*.\n'
    expect(blocks(source, { footnotes: true })).toEqual([
      para(
        str('A'),
        { t: 'Note', c: [para(str('Note'), space, { t: 'Emph', c: [str('one')] }, str('.'))] },
        space,
        str('b[^x].')
      )
    ])
    expect(blocks(source, { footnotes: false })).toEqual([
      para(str('A[^1]'), space, str('b[^x].')),
      para(str('[^1]:'), space, str('Note'), space, { t: 'Emph', c: [str('one')] }, str('.'))
    ])
  })

  it('passes raw HTML through as html', () => {
    expect(blocks('<div>\nhtml\n</div>\n\ninline <b>x</b>\n')).toEqual([
      { t: 'RawBlock', c: ['html', '<div>\nhtml\n</div>\n'] },
      para(str('inline'), space, { t: 'RawInline', c: ['html', '<b>'] }, str('x'), { t: 'RawInline', c: ['html', '</b>'] })
    ])
  })

  it('writes inline, display and block math as pandoc\'s dollar math', () => {
    expect(blocks('$x^2$ and $$y$$\n\n$$\nE=mc^2\n$$\n')).toEqual([
      para(
        { t: 'Math', c: [{ t: 'InlineMath' }, 'x^2'] },
        space,
        str('and'),
        space,
        { t: 'Math', c: [{ t: 'DisplayMath' }, 'y'] }
      ),
      para({ t: 'Math', c: [{ t: 'DisplayMath' }, '\nE=mc^2\n'] })
    ])
  })

  // #5566: the export reads exactly the math delimiters the Markdown preferences enable.
  it('writes math for each delimiter the math preferences enable, and text otherwise', () => {
    const inlineMath = { t: 'Math', c: [{ t: 'InlineMath' }, 'x'] }
    expect(inlines('a $x$\n', { texMathDollars: false })).toEqual([str('a'), space, str('$x$')])
    expect(inlines('a \\(x\\)\n', { texMathSingleBackslash: true })).toEqual([str('a'), space, inlineMath])
    expect(inlines('a \\(x\\)\n', { texMathSingleBackslash: false })).toEqual([str('a'), space, str('(x)')])
    expect(inlines('a \\\\(x\\\\)\n', { texMathDoubleBackslash: true })).toEqual([str('a'), space, inlineMath])
    expect(inlines('a $`x`$\n', { texMathGfm: true })).toEqual([str('a'), space, inlineMath])
    expect(blocks('\\[x\\]\n', { texMathSingleBackslash: true })).toEqual([
      para({ t: 'Math', c: [{ t: 'DisplayMath' }, 'x'] })
    ])
  })

  it('writes superscript and subscript only when the preference enables them', () => {
    expect(inlines('H~2~O x^2^\n', { subscriptAndSuperscript: true })).toEqual([
      str('H'),
      { t: 'Subscript', c: [str('2')] },
      str('O'),
      space,
      str('x'),
      { t: 'Superscript', c: [str('2')] }
    ])
    expect(inlines('x^2^\n', { subscriptAndSuperscript: false })).toEqual([str('x^2^')])
  })

  it('writes emoji as pandoc\'s emoji span and leaves unknown names as text', () => {
    expect(inlines(':smile: :notanemoji:\n')).toEqual([
      { t: 'Span', c: [attr('', ['emoji'], [['data-emoji', 'smile']]), [str('😄')]] },
      space,
      str(':notanemoji:')
    ])
  })

  it('writes an image\'s layout suffix as its size', () => {
    expect(inlines('![a](x.png){width=320 height=50%}\n')).toEqual([
      { t: 'Image', c: [attr('', [], [['width', '320'], ['height', '50%']]), [str('a')], ['x.png', '']] }
    ])
  })
})

describe('Pandoc metadata from front matter (G40)', () => {
  const meta = (yaml: string): Record<string, unknown> =>
    projectPandocExport(`---\n${yaml}---\n\nx\n`, {}, 'html').meta

  it('reads YAML the way pandoc does, with string values as Markdown', () => {
    expect(
      meta(
        'title: Hello *world*\nauthor: [a, "*b*"]\nmap: {k: v}\nflag: yes\noff: False\nn: 007\nf: 2.50\nnone: ~\nempty:\nquoted: "true"\nignored_: x\n'
      )
    ).toEqual({
      title: { t: 'MetaInlines', c: [str('Hello'), space, { t: 'Emph', c: [str('world')] }] },
      author: {
        t: 'MetaList',
        c: [
          { t: 'MetaInlines', c: [str('a')] },
          { t: 'MetaInlines', c: [{ t: 'Emph', c: [str('b')] }] }
        ]
      },
      map: { t: 'MetaMap', c: { k: { t: 'MetaInlines', c: [str('v')] } } },
      flag: { t: 'MetaBool', c: true },
      off: { t: 'MetaBool', c: false },
      n: { t: 'MetaInlines', c: [str('7')] },
      f: { t: 'MetaInlines', c: [str('2.5')] },
      none: { t: 'MetaString', c: '' },
      empty: { t: 'MetaString', c: '' },
      quoted: { t: 'MetaInlines', c: [str('true')] }
    })
  })

  it('keeps a block scalar as blocks and flattens other blocks into lines', () => {
    expect(meta('abstract: |\n  one\n\n  - two\nlines: "p1\\n\\n# h"\n')).toEqual({
      abstract: {
        t: 'MetaBlocks',
        c: [para(str('one')), { t: 'BulletList', c: [[plain(str('two'))]] }]
      },
      lines: { t: 'MetaInlines', c: [str('p1'), { t: 'LineBreak' }, str('h'), { t: 'LineBreak' }] }
    })
  })

  it('keeps CriticMarkup in a value literal, as Core keeps front matter', () => {
    expect(meta('title: "{++a {--b--}++} `{==c==}`"\n')).toEqual({
      title: {
        t: 'MetaInlines',
        c: [str('{++a'), space, str('{--b--}++}'), space, { t: 'Code', c: [attr(), '{==c==}'] }]
      }
    })
  })

  it('keeps front matter out of the body', () => {
    expect(blocks('---\ntitle: T\n---\n\nx\n')).toEqual([para(str('x'))])
  })

  it('exports no metadata for YAML it cannot read', () => {
    expect(projectPandocExport('---\ntitle: [unclosed\n---\n\nx\n', {}, 'html')).toEqual({
      meta: {},
      blocks: [para(str('x'))]
    })
  })
})

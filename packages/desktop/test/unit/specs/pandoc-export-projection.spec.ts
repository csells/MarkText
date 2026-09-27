import { describe, expect, it } from 'vitest'

import {
  PANDOC_NEUTRAL_AUTHOR,
  projectPandocExport
} from '@/documentConsumers/pandocExportProjection'
import type { PandocJsonNode } from '@shared/types/files'

// Plan 0012 G40: Pandoc receives what Core makes of the document. Every
// format but .docx reads the Revised projection; .docx carries suggestions
// as Word tracked changes and comments as Word comments.

const ALL_FORMS =
  'Keep {++added++} {--removed--} {~~old~>new~~} {==marked==}{>>why<<} {==lit==} end{>>note<<}\n'

const str = (c: string): PandocJsonNode => ({ t: 'Str', c })
const space: PandocJsonNode = { t: 'Space' }
const tracked = (kind: 'insertion' | 'deletion', content: PandocJsonNode[]): PandocJsonNode => ({
  t: 'Span',
  c: [['', [kind], [['author', 'unknown']]], content]
})
const commentStart = (id: string, body: PandocJsonNode[]): PandocJsonNode => ({
  t: 'Span',
  c: [['', ['comment-start'], [['id', id], ['author', 'unknown']]], body]
})
const commentEnd = (id: string): PandocJsonNode => ({
  t: 'Span',
  c: [['', ['comment-end'], [['id', id]]], []]
})

const docxBlocks = (source: string, options = {}): PandocJsonNode[] => {
  const input = projectPandocExport(source, options, 'docx')
  if (input.document === undefined) throw new Error('docx export carries no tracked document')
  return input.document.blocks
}

describe('Pandoc export input from Core (G40)', () => {
  it('uses pandoc\'s default author for every change and comment', () => {
    expect(PANDOC_NEUTRAL_AUTHOR).toBe('unknown')
  })

  it.each(['odt', 'rtf', 'epub', 'latex', 'rst', 'org', 'mediawiki', 'textile'])(
    '%s reads the Revised projection, not raw CriticMarkup',
    (target) => {
      const input = projectPandocExport(ALL_FORMS, {}, target)
      expect(input.markdown).toBe('Keep added  new marked lit end\n')
      expect(input.document).toBeUndefined()
    }
  )

  it('keeps plain Markdown exactly as written for every format, docx included', () => {
    const source = '# Title\r\n\r\nSome *text* with `{code}`.\r\n'
    for (const target of ['docx', 'rst']) {
      expect(projectPandocExport(source, {}, target)).toEqual({ markdown: source })
    }
  })

  it('writes all five forms as tracked changes, comments and a highlight', () => {
    expect(docxBlocks(ALL_FORMS)).toEqual([
      {
        t: 'Para',
        c: [
          str('Keep'),
          space,
          tracked('insertion', [str('added')]),
          space,
          tracked('deletion', [str('removed')]),
          space,
          tracked('deletion', [str('old')]),
          tracked('insertion', [str('new')]),
          space,
          commentStart('0', [str('why')]),
          str('marked'),
          commentEnd('0'),
          space,
          { t: 'Span', c: [['', ['mark'], []], [str('lit')]] },
          space,
          str('end'),
          commentStart('1', [str('note')]),
          commentEnd('1')
        ]
      }
    ])
  })

  it('keeps a suggestion inside the emphasis it was written in', () => {
    expect(docxBlocks('*a{++b++}* c\n')).toEqual([
      {
        t: 'Para',
        c: [{ t: 'Emph', c: [str('a'), tracked('insertion', [str('b')])] }, space, str('c')]
      }
    ])
  })

  it('wraps formatting that lies wholly inside a suggestion', () => {
    expect(docxBlocks('{--a **b**--}\n')).toEqual([
      {
        t: 'Para',
        c: [tracked('deletion', [str('a'), space, { t: 'Strong', c: [str('b')] }])]
      }
    ])
  })

  it('renders the comment body as Markdown', () => {
    expect(docxBlocks('x{>>see *this*<<}\n')).toEqual([
      {
        t: 'Para',
        c: [
          str('x'),
          commentStart('0', [str('see'), space, { t: 'Emph', c: [str('this')] }]),
          commentEnd('0')
        ]
      }
    ])
  })

  it('spans a commented highlight across paragraphs', () => {
    expect(docxBlocks('{==a\n\nb==}{>>c<<}\n')).toEqual([
      { t: 'Para', c: [commentStart('0', [str('c')]), str('a')] },
      { t: 'Para', c: [str('b'), commentEnd('0')] }
    ])
  })

  it('tracks a deletion across paragraphs in each of them', () => {
    expect(docxBlocks('x{--a\n\nb--}y\n')).toEqual([
      { t: 'Para', c: [str('x'), tracked('deletion', [str('a')])] },
      { t: 'Para', c: [tracked('deletion', [str('b')]), str('y')] }
    ])
  })

  it('writes text inserted and then deleted as a deletion inside an insertion', () => {
    expect(docxBlocks('{++a{--b--}++}\n')).toEqual([
      {
        t: 'Para',
        c: [
          tracked('insertion', [str('a')]),
          tracked('insertion', [tracked('deletion', [str('b')])])
        ]
      }
    ])
  })

  it('keeps an inserted heading a heading', () => {
    expect(docxBlocks('{++# New\n\ntext++}\n')).toEqual([
      { t: 'Header', c: [1, ['new', [], []], [tracked('insertion', [str('New')])]] },
      { t: 'Para', c: [tracked('insertion', [str('text')])] }
    ])
  })

  it('writes a suggested code block as tracked lines of code', () => {
    expect(docxBlocks('{++```js\none\ntwo\n```\n++}\n')).toEqual([
      {
        t: 'Para',
        c: [
          tracked('insertion', [
            { t: 'Code', c: [['', [], []], 'one'] },
            { t: 'LineBreak' },
            { t: 'Code', c: [['', [], []], 'two'] }
          ])
        ]
      }
    ])
  })

  it('leaves CriticMarkup inside code literal', () => {
    expect(docxBlocks('`{++x++}` {++y++}\n')).toEqual([
      {
        t: 'Para',
        c: [{ t: 'Code', c: [['', [], []], '{++x++}'] }, space, tracked('insertion', [str('y')])]
      }
    ])
  })

  it('keeps a comment in a table cell in that cell', () => {
    const [table] = docxBlocks('| a | b |\n|---|---|\n| c{>>n<<} | {--d--} |\n')
    expect(table?.t).toBe('Table')
    const [, , , , bodies] = table!.c as unknown[]
    const [[, , , [[, cells]]]] = bodies as [[unknown, number, unknown[], [[unknown, unknown[]]]]]
    expect((cells as unknown[][]).map((cell) => cell[4])).toEqual([
      [{ t: 'Plain', c: [str('c'), commentStart('0', [str('n')]), commentEnd('0')] }],
      [{ t: 'Plain', c: [tracked('deletion', [str('d')])] }]
    ])
  })

  it('hands front matter over as metadata, not text', () => {
    const input = projectPandocExport('---\ntitle: T\n---\n{++x++}\n', {}, 'docx')
    expect(input.document?.frontMatter).toBe('title: T\n')
    expect(input.document?.blocks).toEqual([
      { t: 'Para', c: [tracked('insertion', [str('x')])] }
    ])
  })

  it('never passes raw CriticMarkup to pandoc', () => {
    const serialized = JSON.stringify(docxBlocks(ALL_FORMS))
    for (const marker of ['{++', '++}', '{--', '{~~', '~>', '{==', '{>>', '<<}']) {
      expect(serialized).not.toContain(marker)
    }
  })
})

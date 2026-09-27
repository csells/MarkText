import { describe, expect, it } from 'vitest'
import {
  createDocumentCore,
  type DocumentRevision,
  type MarkdownAstNode
} from '../src/index.js'

// A footnote definition's body is ordinary paragraph text: the five
// CriticMarkup forms are active in it, and its code spans, math, autolinks and
// raw HTML own marker-looking text exactly as they do in any paragraph.

const options = { footnotes: true } as const

const kinds = (revision: DocumentRevision): string[] =>
  revision.annotations.map(annotation => annotation.kind)

const nodesOfKind = (node: MarkdownAstNode, kind: string): MarkdownAstNode[] => [
  ...(node.kind === kind ? [node] : []),
  ...node.children.flatMap(child => nodesOfKind(child, kind))
]

/** The same body read as a footnote definition and as a plain paragraph. */
function footnoteAndParagraph(body: string) {
  const core = createDocumentCore()
  const footnote = core.open(`x[^a]\n\n[^a]: ${body}\n`, options)
  const paragraph = core.open(`x[^a]\n\n${body}\n`, options)
  const asFootnote = (markdown: string): string =>
    markdown.replace(/^x\[\^a\]\n\n/u, 'x[^a]\n\n[^a]: ')
  return { core, footnote, paragraph, asFootnote }
}

describe('CriticMarkup inside footnote definitions', () => {
  it.each([
    ['an Addition', 'one {++two++} three'],
    ['a Deletion', 'one {--two--} three'],
    ['a Substitution', 'one {~~two~>deux~~} three'],
    ['a Highlight', 'one {==two==} three'],
    ['a Comment', 'one {>>note<<} three'],
    ['a highlighted Comment', 'one {==two==}{>>note<<} three'],
    ['all five forms', 'A {++add++} {--del--} {~~old~>new~~} {==hi==}{>>note<<} end.']
  ])('reads %s in a footnote body as it reads in a paragraph', (_name, body) => {
    const { core, footnote, paragraph, asFootnote } = footnoteAndParagraph(body)

    expect(kinds(footnote)).toEqual(kinds(paragraph))
    expect(kinds(footnote).length).toBeGreaterThan(0)
    expect(footnote.diagnostics).toEqual([])
    for (const view of ['original', 'revised'] as const) {
      expect(core.project(footnote, view).markdown, view)
        .toBe(asFootnote(core.project(paragraph, view).markdown))
    }
    const revised = core.project(footnote, 'revised').ast.root
    expect(nodesOfKind(revised, 'footnote-definition')).toHaveLength(1)
    expect(nodesOfKind(revised, 'footnote-reference')).toHaveLength(1)
  })

  it('marks footnote body text with its annotation in the Markup view', () => {
    const core = createDocumentCore()
    const source = 'x[^a]\n\n[^a]: one {++two++} three\n'
    const revision = core.open(source, options)
    const markup = core.project(revision, 'markup')
    const marked = markup.events.filter(event => event.kind !== 'text')
    expect(marked.length).toBeGreaterThan(0)
    expect(kinds(revision)).toEqual(['addition'])
    const [addition] = revision.annotations
    expect(source.slice(addition!.range.start, addition!.range.end)).toBe('{++two++}')
  })

  it.each([
    ['a code span', 'see `{++x++}` here', 'inline-code'],
    ['a double-backtick code span', 'see ``{--x--}`` here', 'inline-code'],
    ['inline math', 'see $\\{++x++}$ here', 'inline-math'],
    ['an autolink', 'see <http://a.b/{++x++}> here', 'link'],
    ['raw inline HTML', 'see <span title="{++x++}">t</span> here', 'html-inline']
  ])('keeps markers literal inside %s in a footnote body', (_name, body, nodeKind) => {
    const { core, footnote, paragraph } = footnoteAndParagraph(body)

    expect(kinds(paragraph)).toEqual([])
    expect(kinds(footnote)).toEqual([])
    const source = `x[^a]\n\n[^a]: ${body}\n`
    expect(core.project(footnote, 'original').markdown).toBe(source)
    expect(core.project(footnote, 'revised').markdown).toBe(source)
    const definition = nodesOfKind(core.project(footnote, 'markup').syntax.ast.root, 'footnote-definition')[0]
    expect(definition).toBeDefined()
    const paragraphKinds = nodesOfKind(core.project(paragraph, 'markup').syntax.ast.root, nodeKind)
    expect(nodesOfKind(definition!, nodeKind)).toHaveLength(paragraphKinds.length)
  })

  it('reads a code span and an annotation side by side in a footnote body', () => {
    const core = createDocumentCore()
    const source = '[^a]: `{++code++}` and {++real++}\n'
    const revision = core.open(source, options)
    expect(kinds(revision)).toEqual(['addition'])
    expect(core.project(revision, 'original').markdown).toBe('[^a]: `{++code++}` and \n')
    expect(core.project(revision, 'revised').markdown).toBe('[^a]: `{++code++}` and real\n')
  })

  it('keeps markers inside the footnote label literal', () => {
    const core = createDocumentCore()
    const source = '[^{++a++}]: body\n'
    const revision = core.open(source, options)
    expect(kinds(revision)).toEqual([])
    expect(core.project(revision, 'revised').markdown).toBe(source)
  })

  it('reads an annotation that begins right after the label colon', () => {
    const core = createDocumentCore()
    const revision = core.open('[^a]:{++x++} y\n', options)
    expect(kinds(revision)).toEqual(['addition'])
    expect(core.project(revision, 'original').markdown).toBe('[^a]: y\n')
  })

  it('reads annotations across continuation lines of one footnote paragraph', () => {
    const core = createDocumentCore()
    const source = '[^a]: first {++line\n    second++} line\n'
    const revision = core.open(source, options)
    expect(kinds(revision)).toEqual(['addition'])
    expect(core.project(revision, 'original').markdown).toBe('[^a]: first  line\n')
    expect(core.project(revision, 'revised').markdown).toBe('[^a]: first line\n    second line\n')
  })

  it('reads a code span across continuation lines as a list item reads it', () => {
    const core = createDocumentCore()
    const revision = core.open('[^a]: a `x\n  {++y++}` b\n', options)
    const item = core.open('- a `x\n  {++y++}` b\n', options)
    expect(kinds(revision)).toEqual([])
    expect(kinds(item)).toEqual([])
    const definition = nodesOfKind(core.project(revision, 'markup').syntax.ast.root, 'footnote-definition')[0]
    const listItem = nodesOfKind(core.project(item, 'markup').syntax.ast.root, 'list-item')[0]
    expect(nodesOfKind(definition!, 'inline-code')).toHaveLength(nodesOfKind(listItem!, 'inline-code').length)
  })

  it('does not carry a code span past a blank line in a footnote body', () => {
    const core = createDocumentCore()
    const source = '[^a]: a `x\n\n  {++y++}` b\n'
    const revision = core.open(source, options)
    expect(kinds(revision)).toEqual(['addition'])
  })

  it('does not carry a code span out of a footnote into the next paragraph', () => {
    const core = createDocumentCore()
    const source = '[^a]: a `x\n\n{++y++}` b\n'
    const revision = core.open(source, options)
    expect(kinds(revision)).toEqual(['addition'])
  })

  it('reads annotations in every footnote definition of a document', () => {
    const core = createDocumentCore()
    const source = 'a[^1] b[^2]\n\n[^1]: {++one++}\n[^2]: {--two--}\n\n[^3]: {~~x~>y~~}\n'
    const revision = core.open(source, options)
    expect(kinds(revision)).toEqual(['addition', 'deletion', 'substitution'])
    expect(core.project(revision, 'revised').markdown)
      .toBe('a[^1] b[^2]\n\n[^1]: one\n[^2]: \n\n[^3]: y\n')
    expect(core.project(revision, 'original').markdown)
      .toBe('a[^1] b[^2]\n\n[^1]: \n[^2]: two\n\n[^3]: x\n')
  })

  it('lets an annotation span from one footnote definition into the next, as it spans list items', () => {
    const core = createDocumentCore()
    const source = '[^a]: one {++two\n\n[^b]: three++} four\n'
    const revision = core.open(source, options)
    expect(kinds(revision)).toEqual(['addition'])
    expect(core.project(revision, 'original').markdown).toBe('[^a]: one  four\n')
    expect(core.project(revision, 'revised').markdown).toBe('[^a]: one two\n\n[^b]: three four\n')
    const listCore = createDocumentCore()
    const list = listCore.open('- one {++two\n\n- three++} four\n', options)
    expect(kinds(list)).toEqual(['addition'])
  })

  it('lets an annotation opened in a footnote close in a following paragraph, as in a list item', () => {
    const core = createDocumentCore()
    const source = '[^a]: one {++two\n\nthree++} four\n'
    const revision = core.open(source, options)
    expect(kinds(revision)).toEqual(['addition'])
    expect(core.project(revision, 'revised').markdown).toBe('[^a]: one two\n\nthree four\n')
    expect(core.project(revision, 'original').markdown).toBe('[^a]: one  four\n')
  })

  it('leaves footnote bodies unchanged when footnotes are off', () => {
    const core = createDocumentCore()
    const revision = core.open('[^a]: {++x++}\n')
    expect(kinds(revision)).toEqual(['addition'])
  })

  it('tracks typing in a footnote body as an Addition inside the footnote', () => {
    const core = createDocumentCore()
    const source = 'x[^a]\n\n[^a]: one two\n'
    const revision = core.open(source, options)
    const offset = source.indexOf('two')
    const edited = core.track(revision, { start: offset, end: offset, insert: 'new ' }).revision
    expect(kinds(edited)).toEqual(['addition'])
    expect(edited.source).toBe('x[^a]\n\n[^a]: one {++new ++}two\n')
    expect(core.project(edited, 'original').markdown).toBe(source)
    expect(core.project(edited, 'revised').markdown).toBe('x[^a]\n\n[^a]: one new two\n')
  })

  it('tracks a deletion in a footnote body as a Deletion inside the footnote', () => {
    const core = createDocumentCore()
    const source = 'x[^a]\n\n[^a]: one two three\n'
    const revision = core.open(source, options)
    const start = source.indexOf('two')
    const edited = core.track(revision, { start, end: start + 4, insert: '' }).revision
    expect(kinds(edited)).toEqual(['deletion'])
    expect(edited.source).toBe('x[^a]\n\n[^a]: one {--two --}three\n')
    expect(core.project(edited, 'revised').markdown).toBe('x[^a]\n\n[^a]: one three\n')
  })

  it('accepts and rejects a suggestion in a footnote body', () => {
    const source = '[^a]: one {++two ++}three\n'
    for (const [decision, expected] of [['accept', '[^a]: one two three\n'], ['reject', '[^a]: one three\n']] as const) {
      const core = createDocumentCore()
      const revision = core.open(source, options)
      expect(core.resolve(revision, revision.annotations[0]!, decision).revision.source).toBe(expected)
    }
  })
})

describe('edits in footnote bodies read as a fresh open', () => {
  const documents = [
    'x[^a] y[^b]\n\n[^a]: one {++two++} three\n\n[^b]: four `{--five--}` six\n    seven {==eight==}{>>c<<}\n\ntail\n',
    '[^a]: `code\n  more` {~~a~>b~~}\n[^b]: plain\n',
    'p\n\n[^a]: one {++two\n\n[^b]: three++} four\n'
  ]
  const inserts = ['x', ' ', '\n', '\n\n', '{++n++}', '{--', '++}', '`', '    ', '[^c]: ', '$']

  it.each(documents.map((source, index) => ({ source, index })))('document $index', ({ source }) => {
    let seed = 7
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    for (let round = 0; round < 40; round += 1) {
      const core = createDocumentCore()
      let revision = core.open(source, options)
      for (let step = 0; step < 4; step += 1) {
        const length = revision.sourceLength
        const start = Math.floor(random() * (length + 1))
        const end = random() < 0.6 ? start : Math.min(length, start + 1 + Math.floor(random() * 5))
        const insert = end > start && random() < 0.5 ? '' : inserts[Math.floor(random() * inserts.length)]!
        const next = revision.source.slice(0, start) + insert + revision.source.slice(end)
        const label = `${JSON.stringify(revision.source)} [${start}, ${end}) ${JSON.stringify(insert)}`
        const commit = core.apply(revision, [{ start, end, insert }], { projections: ['markup'] })
        const oracle = createDocumentCore()
        const fresh = oracle.open(next, options)
        expect(commit.revision.source, label).toBe(next)
        expect(commit.revision.annotations, label).toEqual(fresh.annotations)
        expect(commit.revision.diagnostics, label).toEqual(fresh.diagnostics)
        expect(core.project(commit.revision, 'markup').syntax.ast, label)
          .toEqual(oracle.project(fresh, 'markup').syntax.ast)
        revision = commit.revision
      }
    }
  })
})

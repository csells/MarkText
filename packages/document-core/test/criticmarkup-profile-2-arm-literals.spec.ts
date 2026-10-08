import { describe, expect, it } from 'vitest'

import {
  createDocumentCore,
  type CriticMarkupAnnotation,
  type DocumentProjectionName,
  type DocumentRevision
} from '../src/index.js'

// MarkText CriticMarkup Profile 2 (specs/language/marktext-criticmarkup-profile-2.md):
// rule L2c lets a line-start arm boundary end a block literal opened in that
// arm, and the C3/L2b amendments make arm definitions global in the reader
// view that keeps the arm.

interface AstNode {
  readonly kind: string
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly children: readonly AstNode[]
}

const nodesOf = (root: AstNode): AstNode[] => {
  const found: AstNode[] = []
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) continue
    found.push(node)
    pending.push(...[...node.children].reverse())
  }
  return found
}

const shape = (node: AstNode): string =>
  node.children.length === 0
    ? node.kind
    : `${node.kind}[${node.children.map(shape).join(',')}]`

const blockShape = (node: AstNode): string =>
  `${node.kind}[${node.children
    .filter(child => !['text', 'soft-break'].includes(child.kind))
    .map(blockShape).join(',')}]`

const readerAst = (
  core: ReturnType<typeof createDocumentCore>,
  revision: DocumentRevision,
  view: 'original' | 'revised'
): AstNode => core.project(revision, view).ast.root as AstNode

const markupAst = (
  core: ReturnType<typeof createDocumentCore>,
  revision: DocumentRevision
): AstNode => core.project(revision, 'markup').syntax.ast.root as AstNode

const linkDestinations = (root: AstNode): unknown[] =>
  nodesOf(root)
    .filter(node => node.kind === 'link')
    .map(node => node.attributes['rawDestination'])

describe('L2c: a line-start arm boundary ends a block literal opened in the arm', () => {
  it.each([
    {
      name: 'type 6 HTML old arm before a line-start separator at EOF',
      source: '{~~<div>\nabc\n</div>\n~>new\n~~}',
      original: '<div>\nabc\n</div>\n',
      revised: 'new\n'
    },
    {
      name: 'unclosed fence in a new arm',
      source: '{~~old~>```x\n~~}',
      original: 'old',
      revised: '```x\n```\n'
    },
    {
      name: 'type 6 HTML new arm at EOF',
      source: '{~~old~><div>\nabc\n~~}',
      original: 'old',
      revised: '<div>\nabc\n'
    },
    {
      name: 'type 7 HTML Addition at EOF',
      source: '{++<custom-tag>\nabc\n++}',
      original: '',
      revised: '<custom-tag>\nabc\n'
    },
    {
      name: 'fenced Addition followed by prose',
      source: '{++```x\ncode\n++}\nafter',
      original: '\nafter',
      revised: '```x\ncode\n```\nafter'
    }
  ])('closes the annotation for $name', example => {
    const core = createDocumentCore()
    const revision = core.open(example.source)
    expect(revision.annotations).toHaveLength(1)
    expect(revision.annotations[0]?.range)
      .toEqual({ start: 0, end: example.source.lastIndexOf('}') + 1 })
    expect(revision.diagnostics).toEqual([])
    expect(core.project(revision, 'original').markdown).toBe(example.original)
    expect(core.project(revision, 'revised').markdown).toBe(example.revised)
  })

  it('ends the in-arm fence so following Markdown is not code', () => {
    const core = createDocumentCore()
    const revision = core.open('{++```x\ncode\n++}\nafter')
    expect(shape(readerAst(core, revision, 'revised')))
      .toBe('document[code-block[text],paragraph[text]]')
    expect(shape(markupAst(core, revision)))
      .toBe('document[code-block[text],paragraph[text]]')
    const untracked = core.open('```x\ncode\n```\nafter')
    expect(shape(readerAst(core, untracked, 'revised')))
      .toBe(shape(readerAst(core, revision, 'revised')))
  })

  it.each([
    {
      name: 'list item',
      source: '- {++```x\n  code\n  ++}\n  after\n',
      revised: '- ```x\n  code\n  ```\n  after\n',
      shape: 'document[list[list-item[code-block[],paragraph[]]]]'
    },
    {
      name: 'block quote',
      source: '> {++```x\n> code\n> ++}\n> after\n',
      revised: '> ```x\n> code\n> ```\n> after\n',
      shape: 'document[blockquote[code-block[],paragraph[]]]'
    }
  ])('accepts the closer after the $name container prefix', example => {
    const core = createDocumentCore()
    const revision = core.open(example.source)
    expect(revision.annotations.map(annotation => annotation.kind))
      .toEqual(['addition'])
    expect(core.project(revision, 'revised').markdown).toBe(example.revised)
    expect(blockShape(readerAst(core, revision, 'revised'))).toBe(example.shape)
  })

  // A `$$` line an arm opens reads on to the first `$$` after it, wherever
  // that is; a line-start closer ends it at the arm instead, where it is
  // text, so it neither takes in what follows the annotation nor pairs with
  // a math block after it (B15).
  it.each([
    { name: 'an Addition', source: 'P\n\n{++x\n\n$$\ny\n\nw\n++}\n\n{++Q++}\n\n$$\nz\n$$\n', kinds: ['addition', 'addition'], view: 'revised' },
    { name: 'a Deletion', source: 'P\n\n{--x\n\n$$\ny\n--}\n\n{++Q++}\n\n$$\nz\n$$\n', kinds: ['deletion', 'addition'], view: 'original' },
    { name: 'a Highlight', source: 'P\n\n{==x\n\n$$\ny\n==}{>>c<<}\n\n{++Q++}\n\n$$\nz\n$$\n', kinds: ['highlight', 'comment', 'addition'], view: 'revised' }
  ] as const)('ends an in-arm math block at a line-start closer of $name', example => {
    const core = createDocumentCore()
    const revision = core.open(example.source)
    expect(revision.annotations.map(annotation => annotation.kind)).toEqual(example.kinds)
    expect(revision.diagnostics).toEqual([])
    const math = (root: AstNode) => nodesOf(root).filter(node => node.kind === 'math-block')
    expect(math(markupAst(core, revision))).toHaveLength(1)
    expect(math(readerAst(core, revision, example.view))).toHaveLength(1)
    // The arm's `$$` stays text when the view is read as a document.
    const projected = core.project(revision, example.view).markdown
    const reread = core.open(projected)
    expect(blockShape(readerAst(core, reread, 'revised')))
      .toBe(blockShape(readerAst(core, revision, example.view)))
  })

  it('keeps an indented or mid-line closer inside the in-arm literal', () => {
    const core = createDocumentCore()
    for (const source of [
      '{++```\nx ++}\n```\n++}',
      '{++```\n ++}\n```\n++}'
    ]) {
      const revision = core.open(source)
      expect(revision.annotations[0]?.range, source)
        .toEqual({ start: 0, end: source.length })
      expect(nodesOf(readerAst(core, revision, 'revised'))
        .filter(node => node.kind === 'code-block')).toHaveLength(1)
    }
  })

  it.each([
    '```\n++}\n```\n',
    '```\n{++a++}\n```\n',
    '{++a++}\n\n```\n++}\n```\n',
    '<div>\n++}\n</div>\n'
  ])('keeps L1 for a literal opened outside any arm: %j', source => {
    const core = createDocumentCore()
    const revision = core.open(source)
    expect(revision.annotations.filter(annotation =>
      annotation.range.start >= source.indexOf('\n'))).toEqual([])
    const literal = nodesOf(readerAst(core, revision, 'revised')).find(node =>
      node.kind === 'code-block' || node.kind === 'html-block')
    expect(literal).toBeDefined()
  })

  it('never ends the literal at an escaped boundary token', () => {
    const core = createDocumentCore()
    const source = '{++```x\n\\++}\n++}'
    const revision = core.open(source)
    expect(revision.annotations[0]?.range).toEqual({ start: 0, end: source.length })
    expect(core.project(revision, 'revised').markdown).toBe('```x\n\\++}\n```\n')
  })

  it('ends the literal only at the innermost annotation\'s own boundary token', () => {
    const core = createDocumentCore()
    const source = '{~~a{++```x\n~>b\n++}~>c~~}'
    const revision = core.open(source)
    const tree = (annotation: CriticMarkupAnnotation): unknown =>
      [annotation.kind, annotation.range.start, annotation.range.end, annotation.arms.flatMap(arm => arm.annotations.map(tree))]
    expect(revision.annotations.map(tree)).toEqual([['substitution', 0, source.length, [['addition', 4, 19, []]]]])
    expect(revision.diagnostics).toEqual([])
    expect(core.project(revision, 'revised').markdown).toBe('c')
  })

  it('reaches the same revision incrementally as a full parse', () => {
    const steps = [
      { before: '{++```x\ncode\n+}\nafter', at: 13, insert: '+' },
      { before: '{++```x\ncode\n\nafter', at: 13, insert: '++}' },
      { before: '- {++```x\n  code\n  ++}\n  after\n', at: 20, insert: 'x' },
      { before: '{~~old~>```x\n~}', at: 13, insert: '~' },
      { before: '{++<div>\nabc\n++}\nafter\n', at: 13, insert: ' ' }
    ]
    const views: DocumentProjectionName[] = ['original', 'revised']
    for (const step of steps) {
      const core = createDocumentCore()
      const opened = core.open(step.before)
      const edited = core.apply(opened, [{
        start: step.at,
        end: step.at,
        insert: step.insert
      }]).revision
      const fresh = createDocumentCore().open(edited.source)
      const freshCore = createDocumentCore()
      const reopened = freshCore.open(edited.source)
      expect(edited.annotations, edited.source).toEqual(fresh.annotations)
      expect(edited.diagnostics, edited.source).toEqual(fresh.diagnostics)
      for (const view of views) {
        const incremental = core.project(edited, view)
        const full = freshCore.project(reopened, view)
        if (incremental.kind !== 'markdown' || full.kind !== 'markdown') {
          throw new Error('Expected Markdown projections')
        }
        expect(incremental.markdown, `${edited.source} ${view}`).toBe(full.markdown)
        expect(incremental.ast, `${edited.source} ${view}`).toEqual(full.ast)
      }
    }
  })

  it('lets Track Changes record an edit inside an EOF-terminated literal', () => {
    const core = createDocumentCore()
    for (const example of [
      { source: '<div>word</div>\n', at: 7, revised: '<div>woXrd</div>\n' },
      { source: '```js\nword', at: 8, revised: '```js\nwoXrd' }
    ]) {
      const revision = core.open(example.source)
      const edit = core.trackedEdit(revision, {
        start: example.at,
        end: example.at,
        insert: 'X'
      })
      expect(edit, example.source).toBeDefined()
      const tracked = core.apply(revision, edit === undefined ? [] : [edit]).revision
      expect(tracked.annotations).toHaveLength(1)
      const untracked = core.open(example.revised)
      expect(shape(readerAst(core, tracked, 'original')))
        .toBe(shape(readerAst(core, revision, 'revised')))
      expect(shape(readerAst(core, tracked, 'revised')))
        .toBe(shape(readerAst(core, untracked, 'revised')))
    }
  })
})

describe('C3: arm definitions are global in the reader view that keeps the arm', () => {
  it('resolves an Addition definition in Revised exactly like the untracked document', () => {
    const core = createDocumentCore()
    const revision = core.open('{++[a]: /u\n++}\n\n[a]\n')
    const untracked = core.open('[a]: /u\n\n[a]\n')
    expect(linkDestinations(readerAst(core, revision, 'revised'))).toEqual(['/u'])
    expect(linkDestinations(readerAst(core, untracked, 'revised'))).toEqual(['/u'])
    expect(core.project(revision, 'revised').markdown).toBe('[a]: /u\n\n\n[a]\n')
    expect(linkDestinations(readerAst(core, revision, 'original'))).toEqual([])
    // Markup keeps arm-local definitions.
    expect(linkDestinations(markupAst(core, revision))).toEqual([])
  })

  it('resolves a reference before the Addition that defines it', () => {
    const core = createDocumentCore()
    const revision = core.open('[a]\n\n{++[a]: /u\n++}\n')
    expect(linkDestinations(readerAst(core, revision, 'revised'))).toEqual(['/u'])
  })

  it('resolves a Deletion definition only in Original', () => {
    const core = createDocumentCore()
    const revision = core.open('{--[a]: /u\n--}\n\n[a]\n')
    expect(linkDestinations(readerAst(core, revision, 'original'))).toEqual(['/u'])
    expect(linkDestinations(readerAst(core, revision, 'revised'))).toEqual([])
    expect(linkDestinations(markupAst(core, revision))).toEqual([])
  })

  it('resolves each Substitution arm definition in its own view', () => {
    const core = createDocumentCore()
    const revision = core.open('{~~[a]: /o\n~>[a]: /n\n~~}\n\n[a]\n')
    expect(linkDestinations(readerAst(core, revision, 'original'))).toEqual(['/o'])
    expect(linkDestinations(readerAst(core, revision, 'revised'))).toEqual(['/n'])
  })

  it('keeps Highlight definitions arm-local', () => {
    const core = createDocumentCore()
    const revision = core.open('{==[a]: /u\n==}\n\n[a]\n')
    expect(linkDestinations(readerAst(core, revision, 'revised'))).toEqual([])
    expect(core.project(revision, 'revised').markdown).toContain('\\[a]')
  })

  it('keeps Comment payload definitions isolated in every view', () => {
    const core = createDocumentCore()
    const revision = core.open('{>>[a]: /u\n<<}\n\n[a]\n')
    expect(linkDestinations(readerAst(core, revision, 'revised'))).toEqual([])
    expect(linkDestinations(readerAst(core, revision, 'original'))).toEqual([])
  })

  it('applies first-definition-wins across the whole view', () => {
    const core = createDocumentCore()
    expect(linkDestinations(readerAst(core, core.open('[a]: /first\n\n{++[a]: /second\n++}\n\n[a]\n'), 'revised')))
      .toEqual(['/first'])
    expect(linkDestinations(readerAst(core, core.open('{++[a]: /second\n++}\n\n[a]: /first\n\n[a]\n'), 'revised')))
      .toEqual(['/second'])
  })

  it('resolves an Addition footnote definition in Revised', () => {
    const core = createDocumentCore()
    const revision = core.open('{++[^1]: note\n++}\n\nx[^1]\n', { footnotes: true })
    const reference = nodesOf(readerAst(core, revision, 'revised'))
      .find(node => node.kind === 'footnote-reference')
    expect(reference?.attributes).toMatchObject({ resolved: true })
    expect(core.project(revision, 'revised').markdown).toBe('[^1]: note\n\n\nx[^1]\n')
  })
})

describe('L2b: tracked-change closers stand against an in-arm definition', () => {
  it.each([
    { source: '{++[a]:++}\n', kind: 'addition', revised: 'document[paragraph[text]]' },
    { source: '{++[a]: ++}\n', kind: 'addition', revised: 'document[paragraph[text]]' },
    { source: '{--[a]:--}\n', kind: 'deletion', revised: 'document' },
    { source: '{~~x~>[a]:~~}\n', kind: 'substitution', revised: 'document[paragraph[text]]' },
    { source: '{++[a]: /u "t++}\n', kind: 'addition', revised: 'document[paragraph[text]]' }
  ])('forms $source with the unfinished definition as text', example => {
    const core = createDocumentCore()
    const revision = core.open(example.source)
    expect(revision.annotations.map(annotation => annotation.kind))
      .toEqual([example.kind])
    expect(revision.diagnostics).toEqual([])
    expect(shape(readerAst(core, revision, 'revised'))).toBe(example.revised)
  })

  it.each([
    '{++[a]: /u++}\n\n[a]\n',
    '- {++[a]: /u\n\n  [a]\n++}\n',
    '{++[a]: /u++} {--z--}\n\n[a]\n',
    '> {++[a]: /u++}\n\n[a]\n',
    '{~~x~>[a]: /u~~}\n\n[a]\n',
    '{++[a]:\n/u++}\n\n[a]\n'
  ])('ends the definition at the closer in %j', source => {
    const core = createDocumentCore()
    const revision = core.open(source)
    expect(revision.annotations[0]?.range.start).toBe(source.indexOf('{'))
    expect(linkDestinations(readerAst(core, revision, 'revised'))).toEqual(['/u'])
  })

  it('keeps definition precedence for a Comment closer (L1)', () => {
    const core = createDocumentCore()
    const revision = core.open('{>>[ref]: https://example.com/local<<}')
    expect(revision.annotations).toEqual([])
  })

  it('keeps an escaped closer inside the definition destination', () => {
    const core = createDocumentCore()
    const revision = core.open('{++[a]: /u\\++} x++}\n')
    expect(revision.annotations[0]?.range)
      .toEqual({ start: 0, end: '{++[a]: /u\\++} x++}'.length })
  })
})

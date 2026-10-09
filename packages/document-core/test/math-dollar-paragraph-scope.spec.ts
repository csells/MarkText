import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { planFromDocumentParse } from '../src/internal/documentCoreInspection.js'

// A `$$` line that continues a paragraph is paragraph text: a math block
// cannot interrupt a paragraph, and inline math ends with its paragraph, as
// upstream's math extension reads it (blockRule starts a block; inlineRule
// never spans a line). Only a `$$` line that starts a block opens display
// math that runs across blank lines.

const lines = (count: number, line: (index: number) => string): string => Array.from({ length: count }, (_, index) => line(index)).join('\n')
const math = '$$\n' + lines(5, index => `x_{${index}} + y`) + '\n$$'
const code = '```js\n' + lines(12, index => `const value${index} = compute(${index})`) + '\n```'

function blockKinds(source: string): string[] {
  const core = createDocumentCore()
  return core.project(core.open(source), 'markup').syntax.ast.root.children.map(node => node.kind)
}

function original(source: string): string {
  const core = createDocumentCore()
  return core.project(core.open(source), 'original').markdown
}

describe('a $$ line that continues a paragraph', () => {
  it('leaves a later math block its own', () => {
    expect(blockKinds('a\n$$\n\n$$\nx\n$$\n')).toEqual(['paragraph', 'math-block'])
    expect(blockKinds('a\n$$\n\n```\nq\n```\n\n$$\nx\n$$\n')).toEqual(['paragraph', 'code-block', 'math-block'])
  })

  it('is not protected against a math block a Substitution proposes after it', () => {
    const substitution = '{~~$$\nx_0\n$$~>$$\nx_0x\n$$~~}'
    for (const before of ['a\n$$\n\n', 'a\n$$\n\n```js\nq\n```\n\n', 'a\ny\n$$\n\n']) {
      expect(original(`${before}${substitution}\n`)).not.toContain('\\$')
    }
  })

  it('reads a tracked key in a later math block alike in a window and the document', () => {
    const source = [math, math, code, math, '# Heading', lines(8, index => `    indented ${index}`),
      '<div>\n' + lines(5, index => `html ${index}`) + '\n</div>', '# Heading', 'A paragraph of ordinary words.'].join('\n\n') + '\n'
    // Typing `q` into the first opener leaves its closing `$$` in a paragraph.
    const regional = (core: DocumentCore): DocumentRevision =>
      core.apply(core.open(source), [{ start: 1, end: 1, insert: 'q' }], { projections: ['markup'] }).revision
    const plan = (core: DocumentCore) => {
      const revision = regional(core)
      const caret = revision.source.indexOf('x_{2}', revision.source.indexOf('```\n\n$$')) + 3
      const input = {
        range: { start: caret, end: caret },
        selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
        inputType: 'insertText',
        data: 'x',
        options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
      } as DocumentInputAction
      return core.inputEdits(revision, input, core.planInput(revision, input, { tracked: true }), true)
    }
    const control = createDocumentCore()
    planFromDocumentParse(control)
    const windowed = plan(createDocumentCore())
    expect(windowed).toEqual(plan(control))
    // The `q` shifts the block one place on.
    const block = source.indexOf('```\n\n$$') + 5 + 1
    expect(windowed?.map(edit => [edit.start, edit.end])).toEqual([[block, block + math.length]])
  })
})

// A line that starts inside display math is the math's text: a fence run
// there opens no fence, though the math closes later on the line, so the
// text after the math reads its suggestions (B19).
describe('a fence run on a line inside display math', () => {
  it.each(['~~~', '```'])('opens no fence with %s', run => {
    const source = `$$\nx\n${run}$$\n\nplain {++two++}\n`
    const core = createDocumentCore()
    const revision = core.open(source)
    expect(revision.annotations.map(annotation => annotation.kind)).toEqual(['addition'])
  })
})

// A `$$` that begins a suggestion arm's first line stands alone on the line
// the arm reads, as in the projection that lays the arm out, so a fence run
// inside its math is math text there too, and no fence closer is planned
// into the projection after the arm.
describe('display math opening a suggestion arm', () => {
  it.each([
    '{~~$$\nx\n~~~y\n$$\n~>$$\nz\n$$\n~~}\n',
    '{~~$$\nx\n~~~y\n$$~>$$\nz\n$$~~}\n',
    '{++$$\n~~~y\n$$\n++}\n\nplain\n'
  ])('reads a fence run in it as math text in %j', source => {
    const core = createDocumentCore()
    const markup = core.project(core.open(source), 'markup')
    const kinds = markup.syntax.ast.root.children.map(node => node.kind)
    expect(kinds).not.toContain('code-block')
    expect(kinds).toContain('math-block')
  })
})

// A line inside display math is the math's text: a list or quote marker
// there opens no container, at the top level, in a container or in an arm,
// as upstream reads a math block's lines whole.
describe('a container marker on a line inside display math', () => {
  it.each([
    ['$$\na\n- y\n$$\n', 'a\n- y\n'],
    ['$$\na\n\n> y\n$$\n', 'a\n\n> y\n'],
    ['> $$\n> a\n>\n> - y\n> $$\n', 'a\n\n- y\n'],
    ['- $$\n  a\n  + y\n  $$\n', 'a\n+ y\n'],
    ['{~~a~>$$\ny_1\n\n- y\n$$~~}\n', 'y_1\n\n- y\n']
  ])('is math text in %j', (source, content) => {
    const core = createDocumentCore()
    const markup = core.project(core.open(source), 'markup')
    const math: unknown[] = []
    const visit = (node: { kind: string, attributes?: unknown, children?: readonly unknown[] }): void => {
      if (node.kind === 'math-block') math.push((node.attributes as { content?: string } | undefined)?.content)
      for (const child of node.children ?? []) visit(child as typeof node)
    }
    visit(markup.syntax.ast.root)
    expect(math).toContain(content)
  })
})

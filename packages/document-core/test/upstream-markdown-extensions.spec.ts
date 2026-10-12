import { describe, expect, it } from 'vitest'
import { createDocumentCore, type MarkdownOptions } from '../src/index.js'

// Upstream MarkText's opt-in extensions (#2552, #954): `==highlight==`,
// GitLab's inline diff and its `>>>` fenced blockquote. The cases mirror
// packages/muya's markSyntax, inlineDiffSyntax and multilineBlockquote specs.

interface Node {
  readonly kind: string
  readonly range: { readonly start: number, readonly end: number }
  readonly attributes: Readonly<Record<string, unknown>>
  readonly children: readonly Node[]
}

/** The document's nodes as `kind(source)` for leaves and `kind[children]` for containers. */
const tree = (source: string, options: Partial<MarkdownOptions> = {}): string => {
  const core = createDocumentCore()
  const markup = core.project(core.open(source, options), 'markup')
  const spelled = (node: Node): string =>
    source.slice(
      markup.syntax.coordinates.toSource(node.range.start, 'next'),
      markup.syntax.coordinates.toSource(node.range.end, 'previous')
    )
  const show = (node: Node): string =>
    node.children.length === 0
      ? `${node.kind}(${JSON.stringify(spelled(node))})`
      : `${node.kind}[${node.children.map(show).join(' ')}]`
  return (markup.syntax.ast.root as unknown as Node).children.map(show).join(' ')
}

const kinds = (source: string, options: Partial<MarkdownOptions> = {}): string[] => {
  const core = createDocumentCore()
  const markup = core.project(core.open(source, options), 'markup')
  const found: string[] = []
  const visit = (node: Node): void => {
    found.push(node.kind)
    node.children.forEach(visit)
  }
  ;(markup.syntax.ast.root as unknown as Node).children.forEach(visit)
  return found
}

const on = { highlightSyntax: true, inlineDiff: true, multilineBlockquote: true } as const

describe('==highlight==', () => {
  it('is literal text while highlightSyntax is off', () => {
    expect(kinds('a ==hi== b\n')).not.toContain('mark')
  })

  it('reads a highlight with inline Markdown inside when on', () => {
    expect(tree('a ==hi== b\n', on)).toBe('paragraph[text("a ") mark[text("hi")] text(" b")]')
    expect(tree('==**bold** and `code`==\n', on))
      .toBe('paragraph[mark[strong[text("bold")] text(" and ") inline-code("`code`")]]')
  })

  it('does not read empty, space-padded or unclosed runs', () => {
    for (const source of ['====\n', 'a == b\n', '== x==\n', '==x ==\n', '==x\n']) {
      expect(kinds(source, on), source).not.toContain('mark')
    }
    expect(kinds('==x==\n', on)).toContain('mark')
  })

  it('leaves a code span to the code span', () => {
    expect(tree('`==x==`\n', on)).toBe('paragraph[inline-code("`==x==`")]')
  })

  it('keeps an even backslash run inside and an escaped closer literal', () => {
    expect(kinds('==a\\\\==\n', on)).toContain('mark')
    expect(kinds('==a\\==\n', on)).not.toContain('mark')
  })
})

describe('GitLab inline diff', () => {
  it('reads the four paired forms only while inlineDiff is on', () => {
    for (const source of ['{+ add +}', '[+ add +]', '{- del -}', '[- del -]']) {
      expect(tree(`${source}\n`, on), source).toBe(`paragraph[inline-diff(${JSON.stringify(source)})]`)
      expect(kinds(`${source}\n`), source).not.toContain('inline-diff')
    }
  })

  it('rejects mixed delimiters, an empty or blank body, and a line break', () => {
    for (const source of ['{+ add +]\n', '[+ add +}\n', '{- del -]\n', '{++}\n', '[- -]\n', '{+ +}\n', '{+ a\nb +}\n']) {
      expect(kinds(source, on), source).not.toContain('inline-diff')
    }
  })

  it('keeps its body as text and leaves a code span to the code span', () => {
    expect(tree('{+ **bold** <b>x</b> +}\n', on)).toBe('paragraph[inline-diff("{+ **bold** <b>x</b> +}")]')
    expect(tree('`{+ x +}`\n', on)).toBe('paragraph[inline-code("`{+ x +}`")]')
  })

  it('marks additions and deletions with their body', () => {
    const core = createDocumentCore()
    const markup = core.project(core.open('a {+ new +} b [-old-]\n', on), 'markup')
    const diffs = (markup.syntax.ast.root as unknown as Node).children[0]!.children
      .filter(node => node.kind === 'inline-diff')
      .map(node => [node.attributes.diff, node.attributes.content])
    expect(diffs).toEqual([['addition', ' new '], ['deletion', 'old']])
  })
})

describe('upstream extensions beside CriticMarkup', () => {
  // Owner decision, 2026-10-12: CriticMarkup keeps its meaning in the three
  // shapes upstream's opt-in syntax would also read.
  it('keeps {++x++}, {--x--} and {==x==} CriticMarkup with each preference off and on', () => {
    for (const options of [{}, on, { inlineDiff: true }, { highlightSyntax: true }]) {
      for (const [source, kind] of [['{++x++}', 'addition'], ['{--x--}', 'deletion'], ['{==x==}', 'highlight']]) {
        const found = kinds(`a ${source} b\n`, options)
        expect(found, `${source} ${JSON.stringify(options)}`).not.toContain('inline-diff')
        expect(found, `${source} ${JSON.stringify(options)}`).not.toContain('mark')
        const core = createDocumentCore()
        const revision = core.open(`a ${source} b\n`, options)
        expect(revision.annotations.map(annotation => annotation.kind), source).toEqual([kind])
      }
    }
  })

  it('reads upstream spellings and CriticMarkup side by side in one paragraph', () => {
    const source = 'a {+x+} {++y++} [-z-] {--w--} ==v== {==u==} b\n'
    const core = createDocumentCore()
    const revision = core.open(source, on)
    expect(revision.annotations.map(annotation => annotation.kind))
      .toEqual(['addition', 'deletion', 'highlight'])
    const found = kinds(source, on)
    expect(found.filter(kind => kind === 'inline-diff')).toHaveLength(2)
    expect(found.filter(kind => kind === 'mark')).toHaveLength(1)
  })
})

describe('>>> fenced blockquote', () => {
  const fenced = '>>>\nline one\n\nline two\n>>>\n'

  it('reads the fence as one blockquote of its blocks when on', () => {
    expect(tree(fenced, on)).toBe('blockquote[paragraph[text("line one")] paragraph[text("line two")]]')
    expect(tree('>>>\n- a\n- b\n>>>\n', on)).toBe('blockquote[list[list-item[paragraph[text("a")]] list-item[paragraph[text("b")]]]]')
  })

  it('keeps the fence one literal paragraph when off', () => {
    const core = createDocumentCore()
    const markup = core.project(core.open(fenced), 'markup')
    const blocks = (markup.syntax.ast.root as unknown as Node).children
    expect(blocks.map(block => block.kind)).toEqual(['paragraph'])
    expect(kinds(fenced)).not.toContain('blockquote')
  })

  it('leaves other quote spellings to CommonMark', () => {
    expect(kinds('>>> foo\n', on)).toContain('blockquote')
    expect(tree('>>> foo\n', on)).toBe('blockquote[blockquote[blockquote[paragraph[text("foo")]]]]')
    expect(tree('> a\n>>>\nb\n', on)).not.toContain('fence')
  })

  it('lets a fence follow a paragraph and stay out of code', () => {
    expect(tree('intro\n>>>\nquoted\n>>>\n', on)).toBe('paragraph[text("intro")] blockquote[paragraph[text("quoted")]]')
    expect(kinds('```\n>>>\n>>>\n```\n', on)).not.toContain('blockquote')
  })

  it('re-reads the fence when the preference changes and after edits across it', () => {
    const core = createDocumentCore()
    const off = core.open(fenced)
    const shape = (revision: ReturnType<typeof core.open>) =>
      (core.project(revision, 'markup').syntax.ast.root as unknown as Node).children.map(block => block.kind)
    expect(shape(off)).toEqual(['paragraph'])
    const turnedOn = core.apply(off, [], { markdown: { multilineBlockquote: true } }).revision
    expect(shape(turnedOn)).toEqual(['blockquote'])
    // Typing inside the fence keeps one quote around both paragraphs.
    const edited = core.apply(turnedOn, [{ start: 12, end: 12, insert: 'x' }]).revision
    expect(edited.source.slice(0, 14)).toBe('>>>\nline onex\n')
    expect(shape(edited)).toEqual(['blockquote'])
    // Removing the closer leaves CommonMark's reading.
    const unclosed = core.apply(edited, [{ start: edited.source.length - 4, end: edited.source.length, insert: '' }]).revision
    expect(shape(unclosed)).not.toEqual(['blockquote'])
  })
})

describe('Enter on a >>> line', () => {
  const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
  const enter = (source: string, at: number, markdown: Partial<MarkdownOptions>) => {
    const core = createDocumentCore()
    const previous = core.open(source, markdown)
    const action = { selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, range: { start: at, end: at }, inputType: 'insertParagraph', data: null, options } as const
    const plan = core.planInput(previous, action)
    const edits = core.inputEdits(previous, action, plan, false)
    if (edits === undefined) throw new Error('Expected untracked edits')
    const commit = core.apply(previous, edits)
    const selection = core.reconcileInput(previous, plan, commit, action).selection
    const caret = selection !== undefined && 'ranges' in selection ? selection.ranges[selection.primary]?.anchor : undefined
    const blocks = (core.project(commit.revision, 'markup').syntax.ast.root as unknown as Node).children
    return { source: commit.revision.source, caret, blocks: blocks.map(block => `${block.kind}[${block.children.map(child => child.kind).join(' ')}]`) }
  }

  it('opens an empty fenced quote holding the caret when on, as upstream does', () => {
    expect(enter('>>>\n', 3, { multilineBlockquote: true })).toEqual({
      source: '>>>\n\n>>>\n',
      caret: 4,
      blocks: ['blockquote[paragraph]']
    })
  })

  it('keeps CommonMark\'s Enter while off', () => {
    expect(enter('>>>\n', 3, {}).source).not.toBe('>>>\n\n>>>\n')
  })
})

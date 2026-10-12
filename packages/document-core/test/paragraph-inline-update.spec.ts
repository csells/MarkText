import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'

const paired = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

/** Types `keys` from `at`; a backspace key deletes the unit before the caret. */
const typeAt = (source: string, at: number, keys: string, tracked = false) => {
  const core = createDocumentCore()
  let revision: DocumentRevision = core.open(source)
  let caret = at
  for (const key of keys) {
    const deletion = key === '\b'
    const action: DocumentInputAction = {
      selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
      range: deletion ? { start: caret - 1, end: caret } : { start: caret, end: caret },
      inputType: deletion ? 'deleteContentBackward' : 'insertText',
      data: deletion ? null : key,
      options: paired
    }
    const plan = core.planInput(revision, action)
    const edits = core.inputEdits(revision, action, plan, tracked)
    if (edits === undefined) throw new Error(`Input ${JSON.stringify(key)} was refused`)
    const commit = core.apply(revision, edits)
    const selection = core.reconcileInput(revision, plan, commit, action).selection
    if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
    caret = selection.ranges[selection.primary]!.focus
    revision = commit.revision
  }
  return revision.source.slice(0, caret) + '|' + revision.source.slice(caret)
}

const view = (source: string, name: 'original' | 'revised'): string => {
  const core = createDocumentCore()
  return core.project(core.open(source), name).markdown
}

type Node = { readonly kind: string, readonly attributes: Readonly<Record<string, unknown>>, readonly children: readonly Node[] }
const meaningful = ['level', 'ordered', 'start', 'task', 'checked', 'semanticText']
/** The blocks and text a source parses to, apart from its spelling and list tightness. */
const meaning = (source: string): string => {
  const core = createDocumentCore()
  const write = (node: Node): string => {
    const facts = meaningful.filter(name => node.attributes[name] !== undefined).map(name => `${name}=${JSON.stringify(node.attributes[name])}`)
    return `${node.kind}(${facts.join(',')})[${node.children.map(write).join(',')}]`
  }
  return write(core.project(core.open(source), 'markup').syntax.ast.root as Node)
}

// Bytes and caret (`|`) recorded from upstream Muya (8d6c198c) for the same
// input with default preferences; `\b` is Backspace. ADR 0007:
// where upstream re-spells lines the input leaves in place, `expected`
// keeps their bytes and means what upstream's `upstream` bytes mean.
const upstream = [
  // A later line reads as a list item on any input anywhere in the paragraph.
  { source: 'a\n2. b\n', at: 1, keys: 'x', expected: 'ax\n\n2. |b\n' },
  { source: 'a\n2. b\n', at: 0, keys: 'x', expected: 'xa\n\n2. |b\n' },
  { source: 'a\n2. b\n', at: 6, keys: 'x', expected: 'a\n\n2. |bx\n' },
  { source: 'a\n2. b\n', at: 5, keys: 'x', expected: 'a\n\n2. |xb\n' },
  { source: 'a\n2. b\n', at: 4, keys: 'x', expected: 'a\n2.x| b\n' },
  { source: 'a\n1999. b\n', at: 1, keys: 'x', expected: 'ax\n\n1999. |b\n' },
  { source: 'a\n2) b\n', at: 1, keys: 'x', expected: 'ax\n\n2) |b\n' },
  { source: 'a\n*\n', at: 3, keys: ' ', expected: 'a\n\n* |\n' },
  { source: 'a\n+\n', at: 3, keys: ' ', expected: 'a\n\n+ |\n' },
  { source: 'a\n1.\n', at: 4, keys: ' ', expected: 'a\n\n1. |\n' },
  { source: 'a\n2.\n', at: 4, keys: ' ', expected: 'a\n\n2. |\n' },
  { source: 'a\n2.\n', at: 4, keys: '  ', expected: 'a\n\n2.  |\n' },
  { source: 'a\nb\n', at: 2, keys: '2. ', expected: 'a\n\n2. |b\n' },
  // Upstream's list takes the last marker line and trims the paragraph before it.
  { source: 'a\n2. b\n3. c\n', at: 1, keys: 'x', expected: 'ax\n2. b\n\n3. |c\n' },
  { source: 'a\n2. b\n3. c\nd\n', at: 1, keys: 'x', upstream: 'ax\n2. b\n\n3. |c\n   d\n', expected: 'ax\n2. b\n\n3. |c\nd\n' },
  { source: 'a\n2. b\n#c\n', at: 1, keys: 'x', upstream: 'ax\n\n2. |b\n   #c\n', expected: 'ax\n\n2. |b\n#c\n' },
  { source: 'a\n2. b\nc\n', at: 1, keys: 'x', upstream: 'ax\n\n2. |b\n   c\n', expected: 'ax\n\n2. |b\nc\n' },
  { source: 'a\n2.  b\n', at: 1, keys: 'x', expected: 'ax\n\n2. |b\n' },
  { source: 'a\n2.     b\n', at: 1, keys: 'x', expected: 'ax\n\n2. | b\n' },
  { source: 'a  \n2. b\n', at: 1, keys: 'x', upstream: 'ax\n\n2. |b\n', expected: 'ax  \n\n2. |b\n' },
  { source: 'a\n   2. b\n', at: 1, keys: 'x', expected: 'ax\n\n2. |b\n' },
  { source: 'a\n2. b\n\nnext\n', at: 1, keys: 'x', expected: 'ax\n\n2. |b\n\nnext\n' },
  { source: 'before\n\na\n2. b\n', at: 9, keys: 'x', expected: 'before\n\nax\n\n2. |b\n' },
  // Deleting also re-evaluates the paragraph.
  { source: 'a\n2. b\n', at: 3, keys: '\b', expected: 'a\n|. b\n' },
  { source: 'a\n2. b\n', at: 6, keys: '\b', expected: 'a\n\n2. |\n' },
  { source: 'ab\n2. b\n', at: 2, keys: '\b', expected: 'a\n\n2. |b\n' },
  { source: 'a\n2. b\n', at: 1, keys: '\b', expected: '\n\n2. |b\n' },
  { source: 'a\n2.x b\n', at: 5, keys: '\b', expected: 'a\n\n2. |b\n' },
  { source: 'a\n2\\. b\n', at: 4, keys: '\b', expected: 'a\n\n2. |b\n' },
  { source: 'a\n\\# b\n', at: 3, keys: '\b', upstream: 'a\n\n|# b\n', expected: 'a\n|# b\n' },
  // Headings keep only their own line.
  { source: 'a\n#b\nc\n', at: 3, keys: ' ', upstream: 'a\n\n# |b\n\nc\n', expected: 'a\n# |b\nc\n' },
  { source: 'a\n  #b\n', at: 5, keys: ' ', upstream: 'a\n\n# |b\n', expected: 'a\n# |b\n' },
  // A quote takes the following lines; its caret stays before the quoted
  // text, as on a first line (upstream's later-line caret slips into it).
  { source: 'first\nsecond\n', at: 6, keys: '>', upstream: 'first\n\n> |second\n', expected: 'first\n> |second\n' },
  { source: 'a\nbc\nd\n', at: 2, keys: '>', upstream: 'a\n\n> |bc\n> d\n', expected: 'a\n> |bc\nd\n' },
  { source: 'a\nbc\n', at: 2, keys: ' >', upstream: 'a\n\n> |bc\n', expected: 'a\n> |bc\n' },
  { source: 'a\nb\n', at: 2, keys: '  >', upstream: 'a\n\n> |b\n', expected: 'a\n> |b\n' },
  { source: 'aaaa\nb\n', at: 5, keys: '>', upstream: 'aaaa\n\n> |b\n', expected: 'aaaa\n> |b\n' },
  { source: 'aaaa\nb\nc\n', at: 5, keys: '>', upstream: 'aaaa\n\n> |b\n> c\n', expected: 'aaaa\n> |b\nc\n' },
  { source: 'aaaa\nb\nccccccc\n', at: 5, keys: '>', upstream: 'aaaa\n\n> |b\n> ccccccc\n', expected: 'aaaa\n> |b\nccccccc\n' },
  { source: 'b\n', at: 0, keys: '>', expected: '> |b\n' },
  // Thematic breaks and setext underlines.
  { source: 'a\n**\n', at: 4, keys: '*', upstream: 'a\n\n***|*\n', expected: 'a\n***|*\n' },
  { source: 'a\n**\nc\n', at: 4, keys: '*', upstream: 'a\n\n***|*\n\nc\n', expected: 'a\n***|*\nc\n' },
  { source: 'aaaa\n**\n', at: 7, keys: '*', upstream: 'aaaa\n\n***|*\n', expected: 'aaaa\n***|*\n' },
  { source: 'a\n__\n', at: 4, keys: '_', upstream: 'a\n\n___|_\n', expected: 'a\n___|_\n' },
  { source: 'a\n=== x\n', at: 1, keys: 'y', expected: 'ay|\n===\n' },
  { source: 'a\n--- x\n', at: 1, keys: 'y', expected: 'ay|\n---\n' },
  { source: 'a\n=== x\nb\n', at: 1, keys: 'y', upstream: 'ay|\n===\n\nb\n', expected: 'ay|\n===\nb\n' },
  { source: 'a\nb\n=== x\n', at: 1, keys: 'y', expected: 'ay\nb|\n===\n' },
  // An earlier setext match wins over a later list line, as upstream's order.
  { source: 'a\n2. b\n=== x\n', at: 1, keys: 'x', expected: 'ax\n2. b|\n===\n' },
  // Text that stays paragraph.
  { source: 'a\n[ ] b\n', at: 1, keys: 'x', expected: 'ax|\n[ ] b\n' },
  { source: '[ ] a\n', at: 5, keys: 'x', expected: '[ ] ax|\n' },
  { source: 'a\n    b\n', at: 1, keys: 'x', expected: 'ax|\n    b\n' },
  { source: 'a\n*\n', at: 1, keys: 'x', expected: 'ax|\n*\n' },
  // Task items.
  { source: '[ ] b\n', at: 0, keys: '- ', expected: '- [ ] |b\n' },
  { source: '- [ ]a\n', at: 5, keys: ' ', expected: '- [ ] |a\n' },
  { source: '* [ ]a\n', at: 5, keys: ' ', expected: '* [ ] |a\n' },
  { source: '1. [ ]a\n', at: 6, keys: ' ', expected: '1. [ ] |a\n' },
  { source: '- [X]a\n', at: 5, keys: ' ', expected: '- [x] |a\n' },
  { source: '- [ ]a\n', at: 5, keys: '  ', expected: '- [ ]  |a\n' },
  { source: '- [ ]a\n- b\n', at: 5, keys: ' ', expected: '- [ ] |a\n\n- b\n' },
  { source: '- [ ]a\n- b\n- c\n', at: 5, keys: ' ', expected: '- [ ] |a\n\n- b\n- c\n' },
  { source: '- a\n- [ ]b\n', at: 9, keys: ' ', expected: '- a\n\n- [ ] |b\n' },
  { source: '- a\n- [ ]b\n- c\n', at: 9, keys: ' ', expected: '- a\n\n- [ ] |b\n\n- c\n' },
  { source: '- a\n- [ ]b\n- c\n- d\n', at: 9, keys: ' ', expected: '- a\n\n- [ ] |b\n\n- c\n\n- d\n' },
  // The loose list split off after the task item separates its items' blocks.
  { source: '- a\n  - y\n- [ ]b\n- c\n  - z\n', at: 15, keys: ' ', expected: '- a\n  - y\n\n- [ ] |b\n\n- c\n\n  - z\n' },
  { source: '- a\n- [ ]b\n- c\n  - z\n- d\n  > q\n', at: 9, keys: ' ', expected: '- a\n\n- [ ] |b\n\n- c\n\n  - z\n\n- d\n\n  > q\n' },
  { source: '- [ ]a\n  - x\n', at: 5, keys: ' ', expected: '- [ ] |a\n\n  - x\n' },
  { source: '- [ ]a\n  b\n', at: 5, keys: ' ', expected: '- [ ] |a\n  b\n' },
  { source: '- x\n  - a\n  - [ ]b\n', at: 17, keys: ' ', expected: '- x\n  - a\n\n  - [ ] |b\n' },
  { source: '> - a\n> - [ ]b\n', at: 13, keys: ' ', expected: '> - a\n>\n> - [ ] |b\n' },
  // Containers write their prefix on each new line.
  { source: '> a\n> 2. b\n', at: 3, keys: 'x', expected: '> ax\n>\n> 2. |b\n' },
  { source: '> a\n> 2. b\n> c\n', at: 3, keys: 'x', upstream: '> ax\n>\n> 2. |b\n>    c\n', expected: '> ax\n>\n> 2. |b\n> c\n' },
  { source: '> a\n> b\n', at: 6, keys: '>', upstream: '> a\n>\n> > |b\n', expected: '> a\n> > |b\n' },
  { source: '- a\n  b\n', at: 6, keys: '>', upstream: '- a\n\n  > |b\n', expected: '- a\n  > |b\n' },
  // Upstream parses these later list lines as nested lists already.
  { source: '- a\n  2. b\n', at: 3, keys: 'x', expected: '- ax|\n  2. b\n' },
  { source: '- a\n  2. b\n- c\n', at: 3, keys: 'x', expected: '- ax|\n  2. b\n- c\n' },
  { source: '1. a\n   2) b\n', at: 4, keys: 'x', expected: '1. ax|\n   2) b\n' },
  { source: '> - a\n>   2. b\n', at: 5, keys: 'x', expected: '> - ax|\n>   2. b\n' },
  // Blocks that are not paragraphs demote as their text dictates.
  { source: '# foo\n', at: 0, keys: '>', expected: '> |# foo\n' },
  { source: '> # foo\n', at: 2, keys: '>', expected: '> > |# foo\n' },
  { source: '# foo\n', at: 0, keys: '- ', expected: '- |# foo\n' },
  { source: '# foo\n', at: 0, keys: '1. ', expected: '1. |# foo\n' },
  { source: '# foo\n', at: 5, keys: 'x', expected: '# foox|\n' },
  { source: '# foo\n', at: 1, keys: '\b', expected: '| foo\n' },
  { source: '# foo\n', at: 2, keys: '\b', expected: '#|foo\n' },
  { source: '## foo\n', at: 1, keys: '\b', expected: '|# foo\n' },
  { source: '***\n', at: 3, keys: '\b', expected: '**|\n' },
  { source: '***\n', at: 3, keys: 'x', expected: '***x|\n' },
  { source: '---\n', at: 3, keys: 'x', expected: '---x|\n' },
  { source: 'a\n===\n', at: 1, keys: 'x', expected: 'ax|\n===\n' },
  { source: 'a\n2. b\n===\n', at: 1, keys: 'x', expected: 'ax|\n2. b\n===\n' },
  // Annotation delimiters upstream reads as text stay in place.
  { source: '{++a\n2. b++}\n', at: 4, keys: 'x', expected: '{++ax\n\n2. |b++}\n' },
  { source: 'a {++x++}\n2. b\n', at: 1, keys: 'y', expected: 'ay {++x++}\n\n2. |b\n' }
]

describe('a paragraph re-evaluates its block type after every input as upstream', () => {
  it.each(upstream)('$keys at $at of $source', ({ source, at, keys, expected }) => {
    expect(typeAt(source, at, keys)).toBe(expected)
  })

  it.each(upstream.filter(row => 'upstream' in row))('$keys at $at of $source means what upstream wrote', row => {
    expect(meaning(row.expected.replace('|', ''))).toBe(meaning((row as { upstream: string }).upstream.replace('|', '')))
  })

  it.each(upstream.filter(({ source, expected }) => expected.replace('|', '') !== source && !source.includes('{')))(
    'tracks $keys at $at of $source with the same revised text', ({ source, at, keys, expected }) => {
      const tracked = typeAt(source, at, keys, true).replace('|', '')
      expect(view(tracked, 'original')).toBe(source)
      expect(view(tracked, 'revised')).toBe(expected.replace('|', ''))
    })
})

describe('inline update beyond upstream bytes', () => {
  it('tells apart spellings that parse differently', () => {
    expect(meaning('a\n\n* \n')).not.toBe(meaning('a\n* \n'))
    expect(meaning('a\n\n# b\n')).not.toBe(meaning('a\n\nb\n'))
    expect(meaning('> a\nb\n')).toBe(meaning('> a\n> b\n'))
    expect(meaning('> a\nb\n')).not.toBe(meaning('> a\n\nb\n'))
  })

  it('writes the blank line CommonMark needs and nothing more', () => {
    expect(typeAt('> a\nlazy\n', 2, '# ')).toBe('> # |a\n> lazy\n')
    expect(typeAt('> text\nlazy\n', 2, '- ')).toBe('> - |text\nlazy\n')
    expect(typeAt('- a\n  b\nlazy\n', 2, '# ')).toBe('- # |a\n  b\nlazy\n')
  })

  it('keeps the document line ending in the blank line it writes', () => {
    expect(typeAt('a\r\n2. b\r\n', 1, 'x')).toBe('ax\r\n\r\n2. |b\r\n')
    expect(typeAt('> a\r\n> 2. b\r\n', 3, 'x')).toBe('> ax\r\n>\r\n> 2. |b\r\n')
  })

  it('sees through annotation delimiters as block syntax does', () => {
    // Upstream reads `{++` as text and keeps this line in the paragraph; the
    // parser reads it as the line's list marker, so the input converts it.
    expect(typeAt('a\n{++2. b++}\n', 1, 'y')).toBe('ay\n\n{++2. |b++}\n')
    expect(view(typeAt('a\n{++2. b++}\n', 1, 'y').replace('|', ''), 'revised')).toBe('ay\n\n2. b\n')
  })

  it('reads a quote prefix written inside an addition as the container prefix', () => {
    expect(typeAt('{++> plain\n> second++}\n', 19, '!')).toBe('{++> plain\n> second!|++}\n')
    expect(typeAt('{++> plain\n> 2. b++}\n', 5, 'x')).toBe('{++> xplain\n>\n> 2. |b++}\n')
  })

  it('respells a lazy continuation line into the quote', () => {
    // Upstream's parser already split this lazy line into its own list.
    expect(typeAt('> a\n2. b\n', 3, 'x')).toBe('> ax\n>\n> 2. |b\n')
  })
})

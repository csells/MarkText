import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
  type InitialModelSelection,
  type ParseConfiguration
} from '@marktext/document-core'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

function selection(start: number): InitialModelSelection {
  return Object.freeze({
    anchor: Object.freeze({ offset: start, affinity: 'next' as const }),
    focus: Object.freeze({ offset: start, affinity: 'next' as const })
  })
}

async function open(
  source: string,
  at: number
): Promise<DocumentSession> {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    initialSelection: selection(at)
  })
}

async function convertToParagraph(
  source: string,
  at: number
): Promise<string> {
  const session = await open(source, at)
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected an editable selection')
  }
  const result = await session.dispatch({
    kind: 'convert-block',
    target,
    conversion: { kind: 'paragraph' }
  }).completion
  if (result.kind !== 'committed') {
    throw new Error(`Conversion was ${result.kind}`)
  }
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  return snapshot.revision.source
}

// G40: the conversion payload of a literal block comes from the
// parser-emitted content extent (contentStart/contentEnd), never from a
// second lex of the block source. These pins hold the payload semantics
// byte-exactly, LF and CRLF, while the regex battery is deleted.
describe('literal block conversion payloads', () => {
  it.each([
    {
      name: 'fenced code',
      source: '```js\nconst a = 1\n```\n',
      at: 2,
      expected: 'const a = 1\n'
    },
    {
      name: 'fenced code CRLF',
      source: '```\r\nBody\r\n```\r\n',
      at: 2,
      expected: 'Body\r\n'
    },
    {
      name: 'math block',
      source: '$$\nx = y\n$$\n',
      at: 2,
      expected: 'x = y\n'
    },
    {
      name: 'math block CRLF',
      source: '$$\r\nx = y\r\n$$\r\n',
      at: 2,
      expected: 'x = y\r\n'
    },
    {
      name: 'front matter',
      source: '---\na: value\n---\nBody\n',
      at: 1,
      expected: 'a: value\nBody\n'
    },
    {
      name: 'authored div wrapper',
      source: '<div>\nInner\n</div>\n',
      at: 2,
      expected: 'Inner\n'
    },
    {
      name: 'indented code',
      source: '    indented line\n',
      at: 2,
      expected: 'indented line\n'
    }
  ])('converts $name to a paragraph payload', async(row) => {
    expect(await convertToParagraph(row.source, row.at)).toBe(row.expected)
  })

  it('keeps a multi-line fenced payload intact', async() => {
    expect(await convertToParagraph('```\none\ntwo\n```\n', 2))
      .toBe('one\ntwo\n')
  })

  // Container payloads come from the emitted line index: content begins at
  // each line's contentOffset, past every recognized prefix.
  it.each([
    {
      name: 'blockquote lines',
      source: '> a\n> b\n',
      at: 2,
      expected: 'a\nb\n'
    },
    {
      name: 'blockquote CRLF',
      source: '> a\r\n> b\r\n',
      at: 2,
      expected: 'a\r\nb\r\n'
    },
    {
      name: 'list items',
      source: '- one\n- two\n',
      at: 2,
      expected: 'one\ntwo\n'
    },
    {
      name: 'list item with continuation',
      source: '- one\n  cont\n',
      at: 2,
      expected: 'one\ncont\n'
    },
    {
      name: 'task list markers',
      source: '- [ ] one\n- [x] two\n',
      at: 6,
      expected: 'one\ntwo\n'
    },
    {
      name: 'ordered list',
      source: '1. one\n2. two\n',
      at: 3,
      expected: 'one\ntwo\n'
    }
  ])('converts $name to a paragraph payload', async(row) => {
    expect(await convertToParagraph(row.source, row.at)).toBe(row.expected)
  })

  // The loose/tight toggle works over the emitted inter-item gaps.
  it('tightens a loose list by collapsing every gap', async() => {
    const session = await open('- one\n\n- two\n\n\n- three\n', 2)
    const target = session.snapshot().revision.selection
    if (target === null) throw new Error('Expected a selection')
    await session.dispatch({
      kind: 'convert-block',
      target,
      conversion: { kind: 'loose-list-item' }
    }).completion
    const snapshot = session.snapshot()
    if (snapshot.kind !== 'complete') throw new Error('Expected complete')
    expect(snapshot.revision.source).toBe('- one\n- two\n- three\n')
  })
})

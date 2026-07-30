import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
  type EditorIntent,
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

function selection(start: number, end = start): InitialModelSelection {
  return Object.freeze({
    anchor: Object.freeze({ offset: start, affinity: 'next' as const }),
    focus: Object.freeze({
      offset: end,
      affinity: end === start ? 'next' as const : 'previous' as const
    })
  })
}

async function open(
  source: string,
  initialSelection: InitialModelSelection
): Promise<DocumentSession> {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    initialSelection
  })
}

function targetOf(session: DocumentSession) {
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected an editable Markup selection')
  }
  return target
}

async function expectOneStep(
  session: DocumentSession,
  intent: EditorIntent,
  expected: string,
  original: string
): Promise<void> {
  await expect(session.dispatch(intent).completion).resolves.toMatchObject({
    kind: 'committed',
    transition: {
      cause: 'source-edit',
      history: 'record'
    }
  })
  expect(session.snapshot().revision.source).toBe(expected)
  await expect(session.dispatch({ kind: 'undo' }).completion)
    .resolves.toMatchObject({
      kind: 'committed',
      transition: {
        cause: 'undo',
        history: 'none'
      }
    })
  expect(session.snapshot().revision.source).toBe(original)
}

// G29: the conversion payload must come from the parser-emitted setext
// structure (`style: 'setext'` plus the inline content extent), never from an
// ATX-only re-lex. The re-lex kept the underline in the payload, so a
// converted `Title\n-----\n` committed `# Title\n-----\n` — whose reparse
// contains a thematic break the author never wrote.
describe('setext heading block conversion', () => {
  it('converts an equals-underlined heading without leaking the underline', async() => {
    const source = 'Title\n=====\n'
    const session = await open(source, selection(2))

    await expectOneStep(
      session,
      {
        kind: 'convert-block',
        target: targetOf(session),
        conversion: { kind: 'heading', level: 2 }
      },
      '## Title\n',
      source
    )
  })

  it('never injects a thematic break from a dash underline', async() => {
    const source = 'Title\n-----\n'
    const session = await open(source, selection(2))

    await expectOneStep(
      session,
      {
        kind: 'convert-block',
        target: targetOf(session),
        conversion: { kind: 'heading', level: 1 }
      },
      '# Title\n',
      source
    )
  })

  it('converts a setext heading to a paragraph by dropping the underline', async() => {
    const source = 'Title\n=====\n'
    const session = await open(source, selection(2))

    await expectOneStep(
      session,
      {
        kind: 'convert-block',
        target: targetOf(session),
        conversion: { kind: 'paragraph' }
      },
      'Title\n',
      source
    )
  })

  it('joins multi-line setext content into one heading line', async() => {
    const source = 'Title\nsecond\n=====\n'
    const session = await open(source, selection(2))

    await expectOneStep(
      session,
      {
        kind: 'convert-block',
        target: targetOf(session),
        conversion: { kind: 'heading', level: 2 }
      },
      '## Title second\n',
      source
    )
  })

  it('demotes a setext heading through heading-shift without the underline', async() => {
    const source = 'Title\n=====\n'
    const session = await open(source, selection(2))

    await expectOneStep(
      session,
      {
        kind: 'convert-block',
        target: targetOf(session),
        conversion: { kind: 'heading-shift', direction: 'demote' }
      },
      '## Title\n',
      source
    )
  })

  it('keeps CRLF spelling through a setext conversion', async() => {
    const source = 'Title\r\n=====\r\n'
    const session = await open(source, selection(2))

    await expectOneStep(
      session,
      {
        kind: 'convert-block',
        target: targetOf(session),
        conversion: { kind: 'heading', level: 3 }
      },
      '### Title\r\n',
      source
    )
  })
})

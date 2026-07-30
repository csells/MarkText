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

function sourceOf(session: DocumentSession): string {
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  return snapshot.revision.source
}

function markupTarget(session: DocumentSession) {
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected an editable selection')
  }
  return target
}

async function type(session: DocumentSession, text: string): Promise<void> {
  for (const scalar of text) {
    const result = await session.dispatch({
      kind: 'insert-text',
      target: markupTarget(session),
      text: scalar
    }).completion
    if (result.kind !== 'committed') {
      throw new Error(`Typing ${JSON.stringify(scalar)} was ${result.kind}`)
    }
  }
}

async function undoAllSources(
  session: DocumentSession
): Promise<readonly string[]> {
  const states: string[] = []
  let guard = 0
  while (session.historyState().canUndo && guard < 50) {
    await session.dispatch({ kind: 'undo' }).completion
    states.push(sourceOf(session))
    guard += 1
  }
  return states
}

// G33: the section 2 History module owns the one-gesture-one-entry
// coalescing rule. Consecutive single-scalar insertions extend the open
// entry while each lands at the caret the previous one left and the scalar
// does not start a new word after whitespace; any other intent, selection
// move, undo, or persistence seals it.
describe('typed-run history coalescing', () => {
  it('coalesces a typed word into one entry', async() => {
    const session = await open('\n', selection(0))
    await type(session, 'hello')
    expect(sourceOf(session)).toBe('hello\n')

    expect(await undoAllSources(session)).toEqual(['\n'])
  })

  it('breaks the run at a new word after whitespace', async() => {
    const session = await open('\n', selection(0))
    await type(session, 'hello world')

    expect(await undoAllSources(session)).toEqual(['hello \n', '\n'])
  })

  it('seals the run at any non-insert intent', async() => {
    const session = await open('\n', selection(0))
    await type(session, 'ab')
    await session.dispatch({
      kind: 'delete-text',
      target: { ...markupTarget(session), ...selection(1, 2) }
    }).completion
    await type(session, 'c')

    // 'ab' is one entry, the delete is one, then 'c' — which cannot join
    // across the delete.
    expect(await undoAllSources(session)).toEqual(['a\n', 'ab\n', '\n'])
  })

  it('seals the run when the caret moves', async() => {
    const session = await open('\n', selection(0))
    await type(session, 'ab')
    await session.select({
      ...markupTarget(session),
      ...selection(0)
    })
    await type(session, 'x')
    expect(sourceOf(session)).toBe('xab\n')

    expect(await undoAllSources(session)).toEqual(['ab\n', '\n'])
  })

  it('redo restores the whole coalesced run', async() => {
    const session = await open('\n', selection(0))
    await type(session, 'hello')
    await session.dispatch({ kind: 'undo' }).completion
    expect(sourceOf(session)).toBe('\n')

    await session.dispatch({ kind: 'redo' }).completion
    expect(sourceOf(session)).toBe('hello\n')
  })

  it('keeps a multi-scalar insertion as its own entry', async() => {
    const session = await open('\n', selection(0))
    await type(session, 'ab')
    await session.dispatch({
      kind: 'insert-text',
      target: markupTarget(session),
      text: 'pasted'
    }).completion
    await type(session, 'c')

    expect(await undoAllSources(session)).toEqual([
      'abpasted\n',
      'ab\n',
      '\n'
    ])
  })

  it('does not resurrect a redo tail through coalescing', async() => {
    const session = await open('\n', selection(0))
    await type(session, 'ab')
    await session.dispatch({ kind: 'undo' }).completion
    expect(sourceOf(session)).toBe('\n')
    await type(session, 'x')
    expect(sourceOf(session)).toBe('x\n')
    expect(session.historyState().canRedo).toBe(false)

    expect(await undoAllSources(session)).toEqual(['\n'])
  })
})

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

function targetOf(session: DocumentSession) {
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected an editable Markup selection')
  }
  return target
}

// G27: one gesture creates one history entry with an exact edit set. A
// mutation whose candidate is byte-identical to its base corresponds to no
// gesture — it must not mint a revision or record an entry, and per
// non-negotiable 10 it rejects visibly rather than no-oping silently.
describe('zero-delta mutations commit nothing', () => {
  it('rejects converting a heading to the level it already has', async() => {
    const session = await open('# Title\n', selection(2))
    const before = session.historyState()

    await expect(session.dispatch({
      kind: 'convert-block',
      target: targetOf(session),
      conversion: { kind: 'heading', level: 1 }
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'no-source-change'
    })

    const after = session.historyState()
    expect(after.canUndo).toBe(false)
    expect(after.headIdentity).toBe(before.headIdentity)
    expect(session.snapshot().revision.source).toBe('# Title\n')

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'rejected',
        reason: 'nothing-to-undo'
      })
  })

  it('rejects converting a paragraph to a paragraph', async() => {
    const session = await open('Body\n', selection(2))

    await expect(session.dispatch({
      kind: 'convert-block',
      target: targetOf(session),
      conversion: { kind: 'paragraph' }
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'no-source-change'
    })
    expect(session.historyState().canUndo).toBe(false)
  })

  it('still records a real conversion normally', async() => {
    const session = await open('# Title\n', selection(2))

    await expect(session.dispatch({
      kind: 'convert-block',
      target: targetOf(session),
      conversion: { kind: 'heading', level: 2 }
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: { history: 'record' }
    })
    expect(session.snapshot().revision.source).toBe('## Title\n')
    expect(session.historyState().canUndo).toBe(true)
  })
})

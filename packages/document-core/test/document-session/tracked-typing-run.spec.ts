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

function targetOf(session: DocumentSession) {
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected a Markup selection')
  }
  return target
}

async function commit(
  session: DocumentSession,
  intent: EditorIntent
): Promise<void> {
  await expect(session.dispatch(intent).completion).resolves.toMatchObject({
    kind: 'committed'
  })
}

describe('DocumentSession tracked typing runs', () => {
  it('coalesces a typed word over a selection into one substitution', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('head base tail'),
      parseConfiguration: TEST_CONFIGURATION,
      trackChanges: true,
      initialSelection: selection(5, 9)
    })
    await commit(session, {
      kind: 'replace-text',
      target: targetOf(session),
      text: 'e'
    })
    for (const character of 'dited') {
      await commit(session, {
        kind: 'insert-text',
        target: targetOf(session),
        text: character
      })
    }
    expect(session.snapshot().revision.source).toBe(
      'head {~~base~>edited~~} tail'
    )
  })

  it('coalesces a typed word at a caret into one addition', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('head tail'),
      parseConfiguration: TEST_CONFIGURATION,
      trackChanges: true,
      initialSelection: selection(5)
    })
    for (const character of 'word ') {
      await commit(session, {
        kind: 'insert-text',
        target: targetOf(session),
        text: character
      })
    }
    expect(session.snapshot().revision.source).toBe(
      'head {++word ++}tail'
    )
  })
})

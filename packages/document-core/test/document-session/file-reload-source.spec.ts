import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('DocumentSession main-owned file reload', () => {
  it('records exact file source as one history entry and undoes exactly', async() => {
    const before = '{++before++}\r\n'
    const after = '{--after--}\r\n'
    const session = await createDocumentSession({
      source: createSourceSnapshot(before),
      parseConfiguration: TEST_CONFIGURATION
    })

    await expect(session.dispatch({
      kind: 'reload-source-from-file',
      source: after
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: {
        cause: 'source-edit',
        history: 'record'
      }
    })
    expect(session.snapshot().revision.source).toBe(after)

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'committed',
        transition: { cause: 'undo', history: 'none' }
      })
    expect(session.snapshot().revision.source).toBe(before)

    await expect(session.dispatch({ kind: 'redo' }).completion)
      .resolves.toMatchObject({
        kind: 'committed',
        transition: { cause: 'redo', history: 'none' }
      })
    expect(session.snapshot().revision.source).toBe(after)
  })

  it('rejects unchanged file source without recording history', async() => {
    const source = '{==same==}'
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: TEST_CONFIGURATION
    })
    const before = session.snapshot()

    await expect(session.dispatch({
      kind: 'reload-source-from-file',
      source
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'no-source-change',
      snapshot: before
    })
    expect(session.snapshot()).toBe(before)
    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'rejected',
        reason: 'nothing-to-undo'
      })
  })
})

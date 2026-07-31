import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  DocumentExecutionCancelledError,
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
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

describe('DocumentSession main-owned file reload', () => {
  it('rejects a renderer-origin reload: the intent is host-only', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('a\n'),
      parseConfiguration: TEST_CONFIGURATION
    })
    // A renderer edits source through authenticated ranges and can never
    // supply a whole-document replacement; only the host origin may.
    expect(() => session.dispatch({
      kind: 'reload-source-from-file',
      source: 'b\n'
    })).toThrow(/host-only/)
    expect(session.snapshot().revision.source).toBe('a\n')
  })

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
    }, undefined, 'host').completion).resolves.toMatchObject({
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
    }, undefined, 'host').completion).resolves.toMatchObject({
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

  it('cancels candidate facts before publishing or recording the revision', async() => {
    let latestSourceUnits = 0
    let cancelAt = Number.POSITIVE_INFINITY
    const session = await createDocumentSession({
      source: createSourceSnapshot('before'),
      parseConfiguration: TEST_CONFIGURATION,
      executionControl: {
        checkpoint: progress => {
          latestSourceUnits = progress.sourceUnits
          if (progress.sourceUnits >= cancelAt) {
            throw new DocumentExecutionCancelledError()
          }
        }
      }
    })
    const before = session.snapshot()
    const candidate = 'x'.repeat(65_536)
    // A full-source commit performs the candidate hash and canonical parser
    // pass before its facts stage. Arm inside that third candidate pass.
    cancelAt = latestSourceUnits + candidate.length * 2 +
      PARSE_SOURCE_CHECKPOINT_INTERVAL * 2

    const result = await session.dispatch({
      kind: 'reload-source-from-file',
      source: candidate
    }, undefined, 'host').completion

    expect(result).toMatchObject({ kind: 'cancelled', reason: 'cancelled' })
    expect(latestSourceUnits).toBe(cancelAt)
    expect(session.snapshot()).toBe(before)
    expect(session.snapshot().revision.source).toBe('before')
    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'rejected',
        reason: 'nothing-to-undo'
      })
  })
})

import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createMemoryDocumentSessionJournalStorage,
  createSourceSnapshot,
  DOCUMENT_RESOURCE_POLICY_V1,
  type DocumentSessionJournalCommit,
  type DocumentSessionJournalMutation,
  type DocumentSessionJournalStorage,
  type ParseConfiguration
} from '@marktext/document-core'
import { hostedRunnerTimeout } from '../helpers/hostedRunnerTimeout.js'

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

describe('maximum-document durable journal performance', () => {
  it('commits and reopens one same-length edit without recopying source into CAS records', async() => {
    const retained = createMemoryDocumentSessionJournalStorage()
    const casUnits: number[] = []
    const casEvents: Array<{
      readonly at: number
      readonly duration: number
      readonly manifestUnits: number
      readonly contentUnits: number
    }> = []
    const storage: DocumentSessionJournalStorage = Object.freeze({
      read: retained.read,
      async compareExchange(
        key: string,
        expectedRevision: number | null,
        mutation: DocumentSessionJournalMutation
      ): Promise<DocumentSessionJournalCommit | null> {
        casUnits.push(mutation.data.length)
        const at = performance.now()
        const result = await retained.compareExchange(
          key,
          expectedRevision,
          mutation
        )
        casEvents.push(Object.freeze({
          at,
          duration: performance.now() - at,
          manifestUnits: mutation.data.length,
          contentUnits: mutation.contents.reduce(
            (units, content) => units + content.data.length,
            0
          )
        }))
        return result
      }
    })
    const source = 'a'.repeat(
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
    )
    const key = 'maximum-document-journal-performance'
    const options = {
      source: createSourceSnapshot(source),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 0, affinity: 'next' as const },
        focus: { offset: 1, affinity: 'previous' as const }
      },
      durability: { key, storage }
    }
    const session = await createDocumentSession(options)
    const target = session.snapshot().revision.selection
    if (target === null) throw new Error('Expected an authenticated selection')
    const writesBeforeDispatch = casUnits.length

    const startedAt = performance.now()
    const outcome = await session.dispatch({
      kind: 'replace-text',
      target,
      text: 'b'
    }).completion
    const elapsedMs = performance.now() - startedAt
    const dispatchCasEvents = casEvents
      .slice(writesBeforeDispatch)
      .map(event => Object.freeze({
        ...event,
        at: event.at - startedAt
      }))
    expect(outcome.kind).toBe('committed')
    expect(
      elapsedMs,
      JSON.stringify({ elapsedMs, dispatchCasEvents })
    ).toBeLessThanOrEqual(500)
    expect(casUnits.slice(writesBeforeDispatch)).not.toHaveLength(0)
    expect(
      Math.max(...casUnits.slice(writesBeforeDispatch))
    ).toBeLessThanOrEqual(262_144)

    const reopened = await createDocumentSession(options)
    expect(reopened.snapshot().revision.source.length).toBe(source.length)
    expect(reopened.snapshot().revision.source.startsWith('ba')).toBe(true)
    expect((await reopened.dispatch({ kind: 'undo' }).completion).kind)
      .toBe('committed')
    expect(reopened.snapshot().revision.source).toBe(source)
  }, hostedRunnerTimeout(60_000))
})

import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

/**
 * The current revision's canonical source, read synchronously.
 *
 * The editor asks "what does the document say?" from synchronous places — a
 * change handler marking a tab dirty, history bookkeeping — and the answer is
 * already sitting in the revision the snapshot describes. Requiring a flush
 * lease for those reads forces the caller to be async for information the engine
 * has in hand.
 *
 * Persistence is different and keeps the lease: saving needs a settled,
 * consistent read, which is what `flush` and `preparePersistence` exist to give.
 * This is for reading, not for writing to disk.
 */

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

async function openSession(source: string) {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
    initialView: 'markup',
    trackChanges: false,
    initialSelection: {
      anchor: { offset: 0, affinity: 'next' },
      focus: { offset: 0, affinity: 'next' }
    }
  })
}

describe('snapshot canonical source', () => {
  it('is the document byte for byte', async() => {
    for (const source of [
      '# Title\n\nHello.\n',
      'a{++x++}b\n',
      'no trailing newline',
      'crlf\r\nlines\r\n'
    ]) {
      const session = await openSession(source)
      expect(session.snapshot().revision.source).toBe(source)
    }
  })

  it('keeps CriticMarkup markers the reader does not see', async() => {
    const session = await openSession('a{++x++}b\n')
    const snapshot = session.snapshot()
    expect(snapshot.livePlan.runs.map((run) => run.text).join('')).toBe('axb\n')
    expect(snapshot.revision.source).toBe('a{++x++}b\n')
  })

  it('tracks the revision after an edit', async() => {
    const session = await openSession('a\n')
    const selection = session.snapshot().revision.selection
    if (selection === null) throw new Error('Expected a selection')
    const caret = { offset: 1, affinity: 'next' } as const
    const ticket = session.dispatch({
      kind: 'insert-text',
      target: { ...selection, anchor: caret, focus: caret },
      text: 'b'
    })
    await ticket.admission
    await ticket.completion
    expect(session.snapshot().revision.source).toBe('ab\n')
  })

  it('agrees with the leased read used for persistence', async() => {
    const session = await openSession('a{++x++}b\n')
    const flushed = await session.flush('materialize').completion
    if (flushed.kind !== 'flushed') throw new Error('expected a flush')
    let leased = ''
    for await (const chunk of flushed.source.readChunks()) leased += chunk.text
    await flushed.source.release('consumer-finished').completion
    // Two ways to read the same revision must not disagree; if they could, the
    // saved file and the dirty-state would describe different documents.
    expect(session.snapshot().revision.source).toBe(leased)
  })
})

import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration,
  type SessionTransition
} from '@marktext/document-core'
import { requireCompleteSnapshot } from '../helpers/completeSnapshot.js'

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

describe('DocumentSession', () => {
  async function exerciseInsertUndoLease(): Promise<void> {
    const session = await createDocumentSession({
      source: createSourceSnapshot('ac'),
      parseConfiguration: TEST_CONFIGURATION,
      configuration: {
        authoringTextPolicy: 'nearest-owner-eol-v1'
      },
      initialView: 'markup',
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      }
    })
    const observed: SessionTransition[] = []
    const subscription = session.subscribe((transition) => {
      observed.push(transition)
    })
    const before = session.snapshot()
    const target = before.revision.selection
    if (target === null) {
      throw new Error('Expected an initial selection')
    }

    const insert = session.dispatch({
      kind: 'insert-text',
      target,
      text: 'b'
    })

    expect(insert.clientSequence).toBe(1)
    expect(observed).toHaveLength(0)
    expect(await insert.admission).toEqual({
      kind: 'admitted',
      sequence: 1,
      submittedAgainst: before.revision.id
    })

    const inserted = await insert.completion
    if (inserted.kind !== 'committed') {
      throw new Error('Expected insertion to commit')
    }
    const insertTransition = inserted.transition
    const afterInsert = requireCompleteSnapshot(insertTransition.after)

    expect(insertTransition).toMatchObject({
      kind: 'revision-changed',
      cause: 'source-edit',
      history: 'record',
      revision: {
        base: before.revision.id,
        next: afterInsert.revision.id
      },
      effects: []
    })
    expect(afterInsert.revision.sourceLength).toBe(3)
    expect(afterInsert.revision.diagnostics.count).toBe(0)
    expect(afterInsert.revision.selection).toEqual({
      session: before.revision.session,
      revision: afterInsert.revision.id,
      view: 'markup',
      anchor: { offset: 2, affinity: 'next' },
      focus: { offset: 2, affinity: 'next' }
    })
    expect(observed).toEqual([insertTransition])

    const undo = session.dispatch({ kind: 'undo' })
    expect(undo.clientSequence).toBe(2)
    expect(await undo.admission).toEqual({
      kind: 'admitted',
      sequence: 2,
      submittedAgainst: afterInsert.revision.id
    })

    const undone = await undo.completion
    if (undone.kind !== 'committed') {
      throw new Error('Expected undo to commit')
    }
    const undoTransition = undone.transition
    const afterUndo = requireCompleteSnapshot(undoTransition.after)

    expect(undoTransition).toMatchObject({
      kind: 'revision-changed',
      cause: 'undo',
      history: 'none',
      revision: {
        base: afterInsert.revision.id,
        next: afterUndo.revision.id
      },
      effects: []
    })
    expect(afterUndo.revision.id).not.toBe(before.revision.id)
    expect(afterUndo.revision.sourceLength).toBe(2)
    expect(afterUndo.revision.selection).toEqual({
      session: before.revision.session,
      revision: afterUndo.revision.id,
      view: 'markup',
      anchor: { offset: 1, affinity: 'next' },
      focus: { offset: 1, affinity: 'next' }
    })
    expect(observed).toEqual([insertTransition, undoTransition])

    const flush = session.flush('materialize')
    expect(flush.clientSequence).toBe(3)

    const flushed = await flush.completion
    if (flushed.kind !== 'flushed') {
      throw new Error('Expected a flushed revision')
    }
    expect(flushed.watermark).toBe(2)
    expect(flushed.revision.id).toBe(afterUndo.revision.id)
    expect(flushed.source.revision.selection).toEqual(afterUndo.revision.selection)

    let exactSource = ''
    for await (const chunk of flushed.source.readChunks()) {
      exactSource += chunk.text
    }
    expect(exactSource).toBe('ac')

    expect(await flushed.source.release('consumer-finished').completion).toEqual({
      kind: 'released',
      lease: flushed.source.id
    })
    subscription.dispose()
  }

  it('commits insertion, maps its caret, undoes, and leases exact source', exerciseInsertUndoLease)
})

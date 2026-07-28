import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration,
  type SessionTransition
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

describe('DocumentSession retained input', () => {
  async function retainsAStaleAdmittedInsertion(): Promise<void> {
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
    const originalTarget = session.snapshot().revision.selection
    if (originalTarget === null) {
      throw new Error('Expected an initial selection')
    }

    const first = session.dispatch({
      kind: 'insert-text',
      target: originalTarget,
      text: 'b'
    })
    expect((await first.completion).kind).toBe('committed')
    const current = session.snapshot()

    const transitions: SessionTransition[] = []
    session.subscribe((transition) => {
      transitions.push(transition)
    })

    const exactText = 'Z\r\n𝄞{++x++}'
    const mutableIntent = {
      kind: 'insert-text' as const,
      target: {
        session: originalTarget.session,
        revision: originalTarget.revision,
        view: 'markup' as const,
        anchor: { ...originalTarget.anchor },
        focus: { ...originalTarget.focus }
      },
      text: exactText
    }
    const second = session.dispatch({
      ...mutableIntent
    })
    const flush = session.flush('materialize')

    mutableIntent.text = 'mutated'
    mutableIntent.target.anchor.offset = 0
    mutableIntent.target.focus.offset = 0

    expect(await second.admission).toEqual({
      kind: 'admitted',
      sequence: 2,
      submittedAgainst: current.revision.id
    })
    const rejected = await second.completion
    if (rejected.kind !== 'rejected') {
      throw new Error('Expected the stale insertion to be retained as rejected input')
    }
    expect(rejected.reason).toBe('stale-selection')
    expect(rejected.retainedDraft).toMatchObject({
      ticketIds: [second.id],
      sequence: 2,
      submittedAgainst: current.revision.id,
      text: exactText,
      target: originalTarget,
      reason: 'stale-selection',
      status: 'blocked',
      allowedActions: ['retry', 'discard']
    })
    expect(rejected.snapshot.pending.status).toBe('blocked')
    expect(rejected.snapshot.pending.retained).toEqual([rejected.retainedDraft])

    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({
      kind: 'session-state-changed',
      coalescing: 'break',
      before: {
        revision: {
          id: rejected.snapshot.revision.id,
          sourceLength: rejected.snapshot.revision.sourceLength
        }
      },
      after: rejected.snapshot
    })
    expect(transitions[0]?.before.id).not.toBe(transitions[0]?.after.id)

    const blocked = await flush.completion
    if (blocked.kind !== 'blocked') {
      throw new Error('Expected retained input to block a source lease')
    }
    expect(blocked).toMatchObject({
      watermark: 2,
      reason: 'pending-input',
      retainedDrafts: [rejected.retainedDraft]
    })
    expect('source' in blocked).toBe(false)
    expect(session.snapshot()).toBe(rejected.snapshot)
  }

  it(
    'retains exact admitted text and blocks flush when rebasing cannot be proved',
    retainsAStaleAdmittedInsertion
  )
})

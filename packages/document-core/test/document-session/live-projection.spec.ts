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
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('DocumentSession live projections', () => {
  it('publishes parser-derived read-only views and hands Markup selection back exactly', async() => {
    const source = 'A {++new++} {--old--} {~~before~>after~~}\n'
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 2, affinity: 'next' },
        focus: { offset: 5, affinity: 'previous' }
      }
    })
    const marked = session.snapshot()

    await expect(session.dispatch({
      kind: 'set-projection',
      projection: 'original'
    }).completion).resolves.toMatchObject({
      kind: 'state-changed'
    })
    const original = session.snapshot()
    expect(original).toMatchObject({
      kind: 'complete',
      projection: 'original',
      displayPlan: { view: 'original', editable: false },
      reviewIndex: {
        authoring: {
          canCreateAddition: false,
          canCreateDeletion: false,
          canCreateSubstitution: false,
          canCreateHighlight: false,
          canCreateComment: false
        }
      }
    })
    if (original.kind !== 'complete') throw new Error('Expected Original')
    expect(original.displayPlan.runs.map((run) => run.text).join(''))
      .toBe('A  old before\n')
    expect(original.displayDocument.source).toBe('A  old before\n')
    expect(original.revision.source).toBe(source)

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'rejected',
        reason: 'read-only-projection'
      })
    expect(session.snapshot()).toBe(original)

    await expect(session.dispatch({
      kind: 'set-projection',
      projection: 'revised'
    }).completion).resolves.toMatchObject({ kind: 'state-changed' })
    const revised = session.snapshot()
    if (revised.kind !== 'complete') throw new Error('Expected Revised')
    expect(revised.displayPlan.runs.map((run) => run.text).join(''))
      .toBe('A new  after\n')

    await expect(session.dispatch({
      kind: 'set-projection',
      projection: 'marked'
    }).completion).resolves.toMatchObject({ kind: 'state-changed' })
    expect(session.snapshot()).toMatchObject({
      kind: 'complete',
      projection: 'marked',
      revision: {
        selection: marked.revision.selection
      }
    })
  })
})

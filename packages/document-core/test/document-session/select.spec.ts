import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import { completeSnapshot } from '../helpers/completeSnapshot.js'

/**
 * Moving the caret.
 *
 * Selection was set when a document opened and then only moved as a side effect
 * of an edit, so a WYSIWYG editor had no way to place the caret from a click or
 * an arrow key. The session has to own that: the caret is a document position
 * the engine already holds, and a view keeping its own copy would be a second
 * source of truth for it.
 *
 * A selection change is session state, not a new revision — the document did not
 * change — so it commits nothing, records no history, and leaves retained drafts
 * alone. It is validated like any other position: an offset outside the document
 * is a caller error, not something to clamp silently.
 */

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

const caret = (offset: number) => ({
  anchor: { offset, affinity: 'next' as const },
  focus: { offset, affinity: 'next' as const }
})

describe('session selection', () => {
  it('moves the caret to a model offset', async() => {
    const session = await openSession('Hello world.\n')
    session.select(caret(5))
    const selection = session.snapshot().revision.selection
    expect(selection?.anchor.offset).toBe(5)
    expect(selection?.focus.offset).toBe(5)
  })

  it('selects a range', async() => {
    const session = await openSession('Hello world.\n')
    session.select({
      anchor: { offset: 0, affinity: 'next' },
      focus: { offset: 5, affinity: 'previous' }
    })
    const selection = session.snapshot().revision.selection
    expect(selection?.anchor.offset).toBe(0)
    expect(selection?.focus.offset).toBe(5)
  })

  it('commits no revision — the document did not change', async() => {
    const session = await openSession('Hello world.\n')
    const before = completeSnapshot(session)
    session.select(caret(5))
    const after = completeSnapshot(session)
    expect(after.revision.id).toBe(before.revision.id)
    expect(after.livePlan.runs.map((run) => run.text).join(''))
      .toBe(before.livePlan.runs.map((run) => run.text).join(''))
  })

  it('rejects an offset outside the document', async() => {
    const session = await openSession('abc\n')
    // Clamping would put the caret somewhere the caller did not ask for and
    // hide whatever produced the bad offset.
    expect(() => session.select(caret(99))).toThrow()
    expect(() => session.select(caret(-1))).toThrow()
  })

  it('keeps the caret usable for the next edit', async() => {
    const session = await openSession('Hello world.\n')
    session.select(caret(5))
    const selection = session.snapshot().revision.selection
    if (selection === null) {
      throw new Error('Expected a selection')
    }
    const ticket = session.dispatch({
      kind: 'insert-text',
      target: selection,
      text: ' there'
    })
    expect((await ticket.admission).kind).toBe('admitted')
    await ticket.completion
    // Typing goes where the caret was placed, which is the whole point.
    expect(completeSnapshot(session).livePlan.runs.map((run) => run.text).join(''))
      .toBe('Hello there world.\n')
  })
})

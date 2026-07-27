import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
  type ParseConfiguration
} from '@marktext/document-core'
import { completeSnapshot } from '../helpers/completeSnapshot.js'

/**
 * Replacing a range.
 *
 * Typing over a selection is one gesture, so it must be one revision and one
 * undo. Composing it from a delete and an insert made it two, which is the gap
 * the view recorded.
 *
 * It needs no compound-intent machinery: the revision kernel already takes an
 * edit as `{ start, end, insert }`, so a replacement is a single edit that
 * happens to remove and add at once. The earlier framing — "several edits
 * committed as one history entry" — was solving a problem that did not exist.
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

async function openSession(source: string): Promise<DocumentSession> {
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

function modelText(session: DocumentSession): string {
  return completeSnapshot(session).livePlan.runs.map((run) => run.text).join('')
}

async function replace(
  session: DocumentSession,
  start: number,
  end: number,
  text: string
): Promise<void> {
  const selection = session.snapshot().revision.selection
  if (selection === null) {
    throw new Error('Expected a selection')
  }
  const ticket = session.dispatch({
    kind: 'replace-text',
    target: {
      ...selection,
      anchor: { offset: start, affinity: 'next' },
      focus: { offset: end, affinity: 'previous' }
    },
    text
  })
  const admission = await ticket.admission
  if (admission.kind !== 'admitted') {
    throw new Error(`Replace was not admitted: ${JSON.stringify(admission)}`)
  }
  await ticket.completion
}

describe('replace text', () => {
  it('swaps a range for new text', async() => {
    const session = await openSession('Hello brave world.\n')
    await replace(session, 6, 12, 'kind ')
    expect(modelText(session)).toBe('Hello kind world.\n')
  })

  it('undoes in one step, because it was one gesture', async() => {
    const session = await openSession('Hello brave world.\n')
    await replace(session, 6, 12, 'kind ')
    const undo = session.dispatch({ kind: 'undo' })
    expect((await undo.admission).kind).toBe('admitted')
    await undo.completion
    expect(modelText(session)).toBe('Hello brave world.\n')
  })

  it('commits exactly one revision', async() => {
    const session = await openSession('abcdef\n')
    const before = session.snapshot().revision.id
    await replace(session, 1, 4, 'X')
    const after = session.snapshot().revision.id
    expect(after).not.toBe(before)
    // One more undo returns to the original, so no intermediate revision was
    // left in the history.
    const undo = session.dispatch({ kind: 'undo' })
    await undo.admission
    await undo.completion
    expect(modelText(session)).toBe('abcdef\n')
  })

  it('inserts when the target is collapsed', async() => {
    const session = await openSession('ac\n')
    await replace(session, 1, 1, 'b')
    expect(modelText(session)).toBe('abc\n')
  })

  it('keeps a tracked change intact when replacing beside it', async() => {
    const session = await openSession('Oh, Hello {++world++}.\n')
    await replace(session, 0, 3, 'Hi,')
    expect(modelText(session)).toBe('Hi, Hello world.\n')
    expect(completeSnapshot(session).livePlan.runs
      .filter((run) => run.marks.length > 0)
      .map((run) => run.text)).toEqual(['world'])
  })
})

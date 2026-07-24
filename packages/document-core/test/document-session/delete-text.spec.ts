import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
  type ParseConfiguration
} from '@marktext/document-core'

/**
 * Deleting text.
 *
 * The session could only insert at a collapsed caret, so backspace, the Delete
 * key and typing over a selection were all impossible — an editor that cannot
 * remove text is not an editor. Deletion is the other half of editing and
 * belongs in the engine for the same reason insertion does: it is a change to
 * the document, so it has to commit a revision, be undoable, and keep the exact
 * source authoritative.
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
  return session.snapshot().livePlan.runs.map((run) => run.text).join('')
}

async function deleteRange(
  session: DocumentSession,
  start: number,
  end: number
): Promise<void> {
  const selection = session.snapshot().revision.selection
  if (selection === null) {
    throw new Error('Expected a selection')
  }
  const ticket = session.dispatch({
    kind: 'delete-text',
    target: {
      ...selection,
      anchor: { offset: start, affinity: 'next' },
      focus: { offset: end, affinity: 'previous' }
    }
  })
  const admission = await ticket.admission
  if (admission.kind !== 'admitted') {
    throw new Error(`Delete was not admitted: ${JSON.stringify(admission)}`)
  }
  await ticket.completion
}

describe('delete text', () => {
  it('removes a selected range', async() => {
    const session = await openSession('Hello brave world.\n')
    await deleteRange(session, 5, 11)
    expect(modelText(session)).toBe('Hello world.\n')
  })

  it('leaves the caret where the removed text began', async() => {
    const session = await openSession('Hello brave world.\n')
    await deleteRange(session, 5, 11)
    // Typing continues where the text was removed, as backspace should feel.
    expect(session.snapshot().revision.selection?.anchor.offset).toBe(5)
  })

  it('supports a single-character backspace', async() => {
    const session = await openSession('abc\n')
    await deleteRange(session, 2, 3)
    expect(modelText(session)).toBe('ab\n')
  })

  it('undoes back to the exact prior document', async() => {
    const session = await openSession('Hello brave world.\n')
    await deleteRange(session, 5, 11)
    const undo = session.dispatch({ kind: 'undo' })
    expect((await undo.admission).kind).toBe('admitted')
    await undo.completion
    expect(modelText(session)).toBe('Hello brave world.\n')
  })

  it('rejects a collapsed target — that removes nothing', async() => {
    const session = await openSession('abc\n')
    const selection = session.snapshot().revision.selection
    if (selection === null) {
      throw new Error('Expected a selection')
    }
    const caret = { offset: 1, affinity: 'next' } as const
    const before = session.snapshot().revision.id
    const ticket = session.dispatch({
      kind: 'delete-text',
      target: { ...selection, anchor: caret, focus: caret }
    })
    await ticket.admission
    const settled = await ticket.completion
    // Removing nothing must not commit a revision: a silent no-op revision
    // would put an undo step in the stack that undoes nothing the user did.
    expect(settled.kind).not.toBe('revised')
    expect(session.snapshot().revision.id).toBe(before)
    expect(modelText(session)).toBe('abc\n')
  })

  it('keeps a tracked change intact when deleting beside it', async() => {
    const session = await openSession('Oh, Hello {++world++}.\n')
    await deleteRange(session, 0, 4)
    expect(modelText(session)).toBe('Hello world.\n')
    // The addition is still an addition, not swept into the deletion.
    const marks = session.snapshot().livePlan.runs
      .filter((run) => run.marks.length > 0)
      .map((run) => run.text)
    expect(marks).toEqual(['world'])
  })
})

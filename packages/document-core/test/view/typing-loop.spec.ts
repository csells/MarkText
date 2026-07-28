import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createSourceSnapshot,
  canonicalMarkupDocument,
  groupRenderBlocks,
  modelOffsetAt,
  renderMarkupPlan,
  type CompleteDocumentRevision,
  type DocumentSession,
  type MarkupRenderBlock,
  type MarkupViewPosition,
  type ParseConfiguration
} from '@marktext/document-core'
import { completeSnapshot } from '../helpers/completeSnapshot.js'

/**
 * Integration vertical slice, increment 3 (end to end) — the typing loop.
 *
 * The whole point of the engine: a keystroke at a place the user can see becomes
 * a typed intent, commits a new immutable revision, and produces a new render
 * tree — with CriticMarkup preserved and the exact source still authoritative.
 * This is the loop a WYSIWYG editor runs, exercised without a DOM.
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
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

function revisionFor(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete document revision')
  }
  return revision
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

/** The render tree a view would mount for the session's current revision. */
function renderTree(
  session: DocumentSession,
  source: string
): readonly MarkupRenderBlock[] {
  const runs = renderMarkupPlan(completeSnapshot(session).livePlan)
  return groupRenderBlocks(canonicalMarkupDocument(revisionFor(source)), runs)
}

function modelText(session: DocumentSession): string {
  return renderMarkupPlan(completeSnapshot(session).livePlan)
    .map((run) => run.text)
    .join('')
}

/** Type `text` where the user is pointing — the gesture→intent translation. */
async function typeAt(
  session: DocumentSession,
  blocks: readonly MarkupRenderBlock[],
  position: MarkupViewPosition,
  text: string
): Promise<void> {
  const selection = session.snapshot().revision.selection
  if (selection === null) {
    throw new Error('Expected the session to carry a selection')
  }
  const offset = modelOffsetAt(blocks, position)
  const caret = { offset, affinity: 'next' } as const
  const ticket = session.dispatch({
    kind: 'insert-text',
    target: { ...selection, anchor: caret, focus: caret },
    text
  })
  const admission = await ticket.admission
  if (admission.kind !== 'admitted') {
    throw new Error(`Insert was not admitted: ${JSON.stringify(admission)}`)
  }
  await ticket.completion
}

describe('the typing loop', () => {
  it('commits a keystroke aimed by view position and re-renders', async() => {
    const source = 'Hello {++world++}.\n'
    const session = await openSession(source)
    expect(modelText(session)).toBe('Hello world.\n')

    // Point at the end of the plain word "Hello" (block 0, run 0) and type.
    const blocks = renderTree(session, source)
    await typeAt(session, blocks, { blockIndex: 0, runIndex: 0, offset: 5 }, ' there')

    expect(modelText(session)).toBe('Hello there world.\n')
  })

  it('keeps CriticMarkup intact through an edit elsewhere in the document', async() => {
    const source = 'Hello {++world++}.\n'
    const session = await openSession(source)
    const blocks = renderTree(session, source)
    await typeAt(session, blocks, { blockIndex: 0, runIndex: 0, offset: 0 }, 'Oh, ')

    // The addition is still an addition — editing plain text near a tracked
    // change must not accept, reject, or disturb it.
    const runs = renderMarkupPlan(completeSnapshot(session).livePlan)
    expect(runs.map((run) => ({ text: run.text, elements: run.elements })))
      .toEqual([
        { text: 'Oh, Hello ', elements: [] },
        { text: 'world', elements: ['ins'] },
        { text: '.\n', elements: [] }
      ])
  })

  it('undoes a keystroke back to the exact prior model text', async() => {
    const source = 'Hello {++world++}.\n'
    const session = await openSession(source)
    const blocks = renderTree(session, source)
    await typeAt(session, blocks, { blockIndex: 0, runIndex: 0, offset: 5 }, '!')
    expect(modelText(session)).toBe('Hello! world.\n')

    const undo = session.dispatch({ kind: 'undo' })
    const admission = await undo.admission
    if (admission.kind !== 'admitted') {
      throw new Error('Undo was not admitted')
    }
    await undo.completion
    expect(modelText(session)).toBe('Hello world.\n')
  })
})

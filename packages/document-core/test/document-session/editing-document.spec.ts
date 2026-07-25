import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  __markdownParsedUnitsV1,
  __resetMarkdownDocumentParsesV1
} from '../../src/internal/profile1/markdownParser.js'

/**
 * The session serves the editing view's block AST.
 *
 * A view needs block structure to mount, and the session already holds the
 * revision that has it. Without exposing it the view has to re-open the engine
 * on its own text every render — which re-parses the whole document on every
 * keystroke and throws away the sharing slice 2 just bought. Worse, it makes the
 * view derive structure independently, which is the second authority ADR-0009
 * exists to prevent.
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

describe('session editing document', () => {
  it('exposes the block AST of the current revision', async() => {
    const session = await openSession('# Title\n\nHello {++world++}.\n')
    const document = session.snapshot().editingDocument
    expect(document.root.childCount).toBe(2)
    expect(document.root.childAt(0).kind).toBe('heading')
    expect(document.root.childAt(1).kind).toBe('paragraph')
  })

  it('describes the same text the live plan renders', async() => {
    const session = await openSession('a{~~old~>new~~}b\n')
    const snapshot = session.snapshot()
    const modelText = snapshot.livePlan.runs.map((run) => run.text).join('')
    // One coordinate space: block ranges and run offsets must address the same
    // string, or the view would mount blocks around the wrong runs.
    expect(snapshot.editingDocument.source).toBe(modelText)
  })

  it('costs no re-parse to read, however often a view renders', async() => {
    const session = await openSession('# Title\n\nHello {++world++}.\n')
    expect(session.snapshot().editingDocument.root.childCount).toBe(2)
    __resetMarkdownDocumentParsesV1()
    for (let render = 0; render < 5; render += 1) {
      expect(session.snapshot().editingDocument.root.childCount).toBe(2)
    }
    // Re-rendering is free: the revision is immutable, so its block AST is too.
    expect(__markdownParsedUnitsV1()).toBe(0)
  })

  it('tracks the revision after an edit', async() => {
    const session = await openSession('a\n')
    const selection = session.snapshot().revision.selection
    if (selection === null) {
      throw new Error('Expected a selection')
    }
    const caret = { offset: 1, affinity: 'next' } as const
    const ticket = session.dispatch({
      kind: 'insert-text',
      target: { ...selection, anchor: caret, focus: caret },
      text: '\n\nb'
    })
    expect((await ticket.admission).kind).toBe('admitted')
    await ticket.completion
    // The new revision is two paragraphs, and the snapshot says so.
    expect(session.snapshot().editingDocument.root.childCount).toBe(2)
  })
})

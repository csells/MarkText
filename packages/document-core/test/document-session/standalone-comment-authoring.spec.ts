import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
  type InitialModelSelection,
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

function selection(start: number, end = start): InitialModelSelection {
  return Object.freeze({
    anchor: Object.freeze({ offset: start, affinity: 'next' as const }),
    focus: Object.freeze({
      offset: end,
      affinity: end === start ? 'next' as const : 'previous' as const
    })
  })
}

async function open(
  source: string,
  initialSelection: InitialModelSelection
): Promise<DocumentSession> {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    initialSelection
  })
}

function sourceOf(session: DocumentSession): string {
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  return snapshot.revision.source
}

function targetOf(session: DocumentSession) {
  const target = session.snapshot().revision.selection
  if (target === null || target.view !== 'markup') {
    throw new Error('Expected an editable Markup selection')
  }
  return target
}

function authoring(session: DocumentSession) {
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  return snapshot.reviewIndex.authoring
}

// G36: the standalone Comment is one of the five canonical forms, and a
// collapsed caret is its only sensible Markup-mode target — hand-typing the
// markers is encoded as prose text by design (ADR-0015), and the pair form
// requires a selection. Rejecting the collapsed caret made the form
// unauthorable anywhere in WYSIWYG.
describe('standalone Comment authoring at a collapsed caret', () => {
  it('authors {>>note<<} at the caret as one exact undo step', async() => {
    const source = 'word after\n'
    const session = await open(source, selection(4))

    await expect(session.dispatch({
      kind: 'author-critic-markup',
      target: targetOf(session),
      input: { kind: 'comment', comment: 'note' }
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: { cause: 'source-edit', history: 'record' }
    })
    expect(sourceOf(session)).toBe('word{>>note<<} after\n')

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(sourceOf(session)).toBe(source)
  })

  it('reports canCreateComment true and the other four false', async() => {
    const session = await open('word after\n', selection(4))
    expect(authoring(session)).toEqual({
      canCreateAddition: false,
      canCreateDeletion: false,
      canCreateSubstitution: false,
      canCreateHighlight: false,
      canCreateComment: true
    })
  })

  it('nests a standalone comment inside an addition payload', async() => {
    const source = 'x {++alpha++} y\n'
    // Model view shows 'x alpha y'; caret after 'al' (model offset 4).
    const session = await open(source, selection(4))

    await expect(session.dispatch({
      kind: 'author-critic-markup',
      target: targetOf(session),
      input: { kind: 'comment', comment: 'why?' }
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(sourceOf(session)).toBe('x {++al{>>why?<<}pha++} y\n')
  })

  it('still refuses an empty comment at a collapsed caret', async() => {
    const session = await open('word\n', selection(2))

    await expect(session.dispatch({
      kind: 'author-critic-markup',
      target: targetOf(session),
      input: { kind: 'comment', comment: '   ' }
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'empty-comment'
    })
    expect(sourceOf(session)).toBe('word\n')
  })

  it('refuses a caret inside a Markdown literal', async() => {
    const source = 'a `code` b\n'
    // Model offset inside the code span's visible text.
    const session = await open(source, selection(4))

    await expect(session.dispatch({
      kind: 'author-critic-markup',
      target: targetOf(session),
      input: { kind: 'comment', comment: 'note' }
    }).completion).resolves.toMatchObject({ kind: 'rejected' })
    expect(sourceOf(session)).toBe(source)
  })

  it('keeps the other four forms collapsed-rejected', async() => {
    const session = await open('word\n', selection(2))
    for (const input of [
      { kind: 'addition' as const },
      { kind: 'deletion' as const },
      { kind: 'highlight' as const },
      { kind: 'substitution' as const, replacement: 'x' }
    ]) {
      await expect(session.dispatch({
        kind: 'author-critic-markup',
        target: targetOf(session),
        input
      }).completion).resolves.toMatchObject({
        kind: 'rejected',
        reason: 'selection-collapsed'
      })
    }
    expect(sourceOf(session)).toBe('word\n')
  })
})

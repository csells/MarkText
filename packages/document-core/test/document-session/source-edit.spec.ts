import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration,
  type SourceModelSelection
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

describe('DocumentSession source editing', () => {
  it('commits one exact source-range gesture with its raw cursor as one history entry', async() => {
    const source = 'before {++kept++} after\r\n'
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: TEST_CONFIGURATION
    })
    const before = session.snapshot()
    const authenticated = before.revision.selection
    if (authenticated === null) {
      throw new Error('Expected an authenticated initial selection')
    }
    const start = source.indexOf('before')
    const target: SourceModelSelection = Object.freeze({
      session: authenticated.session,
      revision: authenticated.revision,
      view: 'source',
      anchor: { offset: start, affinity: 'next' as const },
      focus: {
        offset: start + 'before'.length,
        affinity: 'previous' as const
      }
    })
    const cursor = Object.freeze({
      anchor: { offset: start + 'BEFORE'.length, affinity: 'next' as const },
      focus: { offset: start + 'BEFORE'.length, affinity: 'next' as const }
    })

    await expect(session.dispatch({
      kind: 'edit-source',
      target,
      text: 'BEFORE',
      selection: cursor
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: {
        cause: 'source-edit',
        history: 'record'
      }
    })

    expect(session.snapshot()).toMatchObject({
      revision: {
        source: 'BEFORE {++kept++} after\r\n'
      },
      sourceSelection: cursor
    })
    expect(session.historyState()).toMatchObject({
      canUndo: true,
      canRedo: false,
      dirty: true
    })

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'committed',
        transition: { cause: 'undo', history: 'none' }
      })
    expect(session.snapshot()).toMatchObject({
      revision: { source },
      sourceSelection: {
        anchor: { offset: start },
        focus: { offset: start + 'before'.length }
      }
    })
  })

  it('serializes a source-targeted image inside core as one undoable gesture', async() => {
    const source = 'before selected after\r\n'
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: TEST_CONFIGURATION
    })
    const authenticated = session.snapshot().sourceSelection
    const start = source.indexOf('selected')
    const target: SourceModelSelection = Object.freeze({
      ...authenticated,
      anchor: { offset: start, affinity: 'next' as const },
      focus: {
        offset: start + 'selected'.length,
        affinity: 'previous' as const
      }
    })

    await expect(session.dispatch({
      kind: 'insert-image',
      target,
      src: 'images/cat.png',
      alt: 'cat',
      title: 'Cat'
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: { history: 'record' }
    })

    const inserted = '![cat](images/cat.png "Cat")'
    expect(session.snapshot()).toMatchObject({
      revision: { source: `before ${inserted} after\r\n` },
      sourceSelection: {
        anchor: { offset: start + inserted.length },
        focus: { offset: start + inserted.length }
      }
    })
    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(source)
  })
})

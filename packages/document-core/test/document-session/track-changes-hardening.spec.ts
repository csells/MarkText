import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type DocumentSession,
  type EditorIntent,
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

async function openSession(
  source: string,
  initialSelection: InitialModelSelection,
  trackChanges = true
): Promise<DocumentSession> {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    trackChanges,
    initialSelection
  })
}

function targetOf(session: DocumentSession) {
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected a Markup selection')
  }
  return target
}

function revisionOf(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete revision')
  }
  return revision
}

function criticKinds(
  revision: CompleteDocumentRevision
): readonly string[] {
  const kinds: string[] = []
  const visit = (
    node: ReturnType<CompleteDocumentRevision['criticMarkup']['rootAt']>
  ): void => {
    kinds.push(node.kind)
    for (const arm of node.arms) {
      for (const child of arm.children) {
        visit(child)
      }
    }
  }
  for (let index = 0; index < revision.criticMarkup.rootCount; index += 1) {
    visit(revision.criticMarkup.rootAt(index))
  }
  return kinds
}

async function commit(
  session: DocumentSession,
  intent: EditorIntent
): Promise<void> {
  await expect(session.dispatch(intent).completion).resolves.toMatchObject({
    kind: 'committed',
    transition: {
      cause: 'source-edit',
      history: 'record'
    }
  })
}

describe('DocumentSession Track Changes hardening', () => {
  it('protects hostile payload delimiters and changed joins atomically', async() => {
    const insertion = await openSession('ab', selection(1))
    await commit(insertion, {
      kind: 'insert-text',
      target: targetOf(insertion),
      text: 'literal {++ opener and ++} closer'
    })
    expect(insertion.snapshot().revision.source).toBe(
      String.raw`a{++literal \{++ opener and ++\} closer++}b`
    )
    expect(criticKinds(revisionOf(insertion.snapshot().revision.source)))
      .toEqual(['addition'])
    await expect(insertion.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(insertion.snapshot().revision.source).toBe('ab')

    const replacementSource = 'old ~> divider'
    const replacement = await openSession(
      replacementSource,
      selection(0, replacementSource.length)
    )
    await commit(replacement, {
      kind: 'replace-text',
      target: targetOf(replacement),
      text: 'new {-- marker ~~}'
    })
    expect(replacement.snapshot().revision.source).toBe(
      String.raw`{~~old \~> divider~>new \{-- marker ~~\}~~}`
    )
    expect(criticKinds(revisionOf(replacement.snapshot().revision.source)))
      .toEqual(['substitution'])

    const joined = await openSession('{++{tail++}', selection(1))
    await commit(joined, {
      kind: 'insert-text',
      target: targetOf(joined),
      text: '++nested++}'
    })
    expect(joined.snapshot().revision.source).toBe(
      String.raw`{++\{++nested++\}tail++}`
    )
    expect(criticKinds(revisionOf(joined.snapshot().revision.source)))
      .toEqual(['addition'])
    await expect(joined.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(joined.snapshot().revision.source).toBe('{++{tail++}')

    const imported = await openSession('{++ab++}', selection(1))
    await commit(imported, {
      kind: 'paste-text',
      target: targetOf(imported),
      text: '{--nested--}',
      source: 'raw-source-import'
    })
    expect(imported.snapshot().revision.source)
      .toBe('{++a{--nested--}b++}')
    expect(criticKinds(revisionOf(imported.snapshot().revision.source)))
      .toEqual(['addition', 'deletion'])
  })

  it('preserves Comment anchors and rejects hidden Comment loss', async() => {
    const tracked = await openSession(
      '{==abc==}{>>note<<}',
      selection(0, 3)
    )
    await commit(tracked, {
      kind: 'delete-text',
      target: targetOf(tracked)
    })
    expect(tracked.snapshot().revision.source)
      .toBe('{--{==abc==}--}{>>note<<}')
    await expect(tracked.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(tracked.snapshot().revision.source)
      .toBe('{==abc==}{>>note<<}')

    const direct = await openSession(
      '{==abc==}{>>note<<}',
      selection(0, 3),
      false
    )
    await commit(direct, {
      kind: 'delete-text',
      target: targetOf(direct)
    })
    expect(direct.snapshot().revision.source).toBe('{>>note<<}')

    const partial = await openSession(
      '{==ab==}{>>note<<}',
      selection(0, 1)
    )
    await commit(partial, {
      kind: 'delete-text',
      target: targetOf(partial)
    })
    expect(partial.snapshot().revision.source).toBe('{==b==}{>>note<<}')
    partial.select(selection(0, 1))
    await commit(partial, {
      kind: 'delete-text',
      target: targetOf(partial)
    })
    expect(partial.snapshot().revision.source)
      .toBe('{--{==b==}--}{>>note<<}')

    const destructiveIntents = [
      (session: DocumentSession): EditorIntent => ({
        kind: 'delete-text',
        target: targetOf(session)
      }),
      (session: DocumentSession): EditorIntent => ({
        kind: 'replace-text',
        target: targetOf(session),
        text: 'replacement'
      }),
      (session: DocumentSession): EditorIntent => ({
        kind: 'replace-structure',
        target: targetOf(session),
        replacement: 'replacement'
      }),
      (session: DocumentSession): EditorIntent => ({
        kind: 'paste-text',
        target: targetOf(session),
        text: 'replacement',
        source: 'external-text'
      }),
      (session: DocumentSession): EditorIntent => ({
        kind: 'commit-composition',
        target: targetOf(session),
        text: 'replacement'
      })
    ]
    for (const intent of destructiveIntents) {
      for (const trackChanges of [false, true]) {
        const source = '{==a{>>hidden<<}b==}'
        const session = await openSession(
          source,
          selection(0, 2),
          trackChanges
        )
        const before = session.snapshot()
        const ticket = session.dispatch(intent(session))
        await expect(ticket.completion).resolves.toMatchObject({
          kind: 'rejected',
          reason: 'hidden-comment-loss',
          snapshot: before
        })
        expect(session.snapshot()).toBe(before)
        expect(session.ticketOutcome(ticket.id)).toMatchObject({
          kind: 'rejected',
          reason: 'hidden-comment-loss',
          revision: before.revision.id
        })
        await expect(session.dispatch({ kind: 'undo' }).completion)
          .resolves.toMatchObject({
            kind: 'rejected',
            reason: 'nothing-to-undo',
            snapshot: before
          })
        expect(session.snapshot()).toBe(before)
      }
    }
  })

  it('classifies exhaustion when an earlier hidden Comment is outside the selected source range', async() => {
    const source =
      '{=={--old--}{++{>>outer {>>inner<<}<<}++}tail==}{>>note<<}'
    const directExpected =
      '{--old--}{++{>>outer {>>inner<<}<<}++}{>>note<<}'
    const trackedExpected =
      '{--{=={--old--}{++{>>outer {>>inner<<}<<}++}tail==}--}{>>note<<}'

    const intents = [
      {
        name: 'delete',
        create: (session: DocumentSession): EditorIntent => ({
          kind: 'delete-text',
          target: targetOf(session)
        })
      },
      {
        name: 'empty replacement',
        create: (session: DocumentSession): EditorIntent => ({
          kind: 'replace-text',
          target: targetOf(session),
          text: ''
        })
      },
      {
        name: 'empty structure replacement',
        create: (session: DocumentSession): EditorIntent => ({
          kind: 'replace-structure',
          target: targetOf(session),
          replacement: ''
        })
      },
      {
        name: 'empty paste replacement',
        create: (session: DocumentSession): EditorIntent => ({
          kind: 'paste-text',
          target: targetOf(session),
          text: '',
          source: 'external-text'
        })
      },
      {
        name: 'empty IME replacement',
        create: (session: DocumentSession): EditorIntent => ({
          kind: 'commit-composition',
          target: targetOf(session),
          text: ''
        })
      }
    ]

    for (const intent of intents) {
      for (const trackChanges of [false, true]) {
        const session = await openSession(
          source,
          selection(3, 7),
          trackChanges
        )
        const before = session.snapshot()
        const ticket = session.dispatch(intent.create(session))

        await expect(ticket.completion, intent.name).resolves.toMatchObject({
          kind: 'committed',
          transition: {
            cause: 'source-edit',
            history: 'record',
            before
          }
        })
        expect(session.snapshot().revision.source, intent.name).toBe(
          trackChanges ? trackedExpected : directExpected
        )
        expect(session.ticketOutcome(ticket.id), intent.name).toMatchObject({
          kind: 'committed',
          cause: 'source-edit',
          history: 'record'
        })
        await expect(
          session.dispatch({ kind: 'undo' }).completion,
          `${intent.name} undo`
        ).resolves.toMatchObject({
          kind: 'committed',
          transition: {
            cause: 'undo',
            history: 'none'
          }
        })
        expect(session.snapshot().revision.source, `${intent.name} undo`)
          .toBe(source)
        expect(
          session.snapshot().revision.selection,
          `${intent.name} selection`
        ).toMatchObject({
          anchor: before.revision.selection?.anchor,
          focus: before.revision.selection?.focus
        })
      }
    }
  })

  it('retains the Highlight when a replacement contributes to root Revised', async() => {
    const source =
      '{=={--old--}{++{>>outer {>>inner<<}<<}++}tail==}{>>note<<}'

    for (const trackChanges of [false, true]) {
      const session = await openSession(
        source,
        selection(3, 7),
        trackChanges
      )
      const before = session.snapshot()

      await expect(session.dispatch({
        kind: 'replace-text',
        target: targetOf(session),
        text: 'next'
      }).completion).resolves.toMatchObject({
        kind: 'committed',
        transition: {
          cause: 'source-edit',
          history: 'record',
          before
        }
      })
      expect(session.snapshot().revision.source).toBe(
        trackChanges
          ? '{=={--old--}{++{>>outer {>>inner<<}<<}++}{~~tail~>next~~}==}{>>note<<}'
          : '{=={--old--}{++{>>outer {>>inner<<}<<}++}next==}{>>note<<}'
      )
      await expect(session.dispatch({ kind: 'undo' }).completion)
        .resolves.toMatchObject({
          kind: 'committed',
          transition: {
            cause: 'undo',
            history: 'none'
          }
        })
      expect(session.snapshot().revision.source).toBe(source)
      expect(session.snapshot().revision.selection).toMatchObject({
        anchor: before.revision.selection?.anchor,
        focus: before.revision.selection?.focus
      })
    }
  })

  it('uses direct exhaustion inside a pending revised carrier', async() => {
    const source = '{++{=={>>hidden<<}tail==}{>>note<<}++}'
    const session = await openSession(source, selection(0, 4), true)
    const before = session.snapshot()

    await expect(session.dispatch({
      kind: 'delete-text',
      target: targetOf(session)
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: {
        cause: 'source-edit',
        history: 'record',
        before
      }
    })
    expect(session.snapshot().revision.source)
      .toBe('{++{>>hidden<<}{>>note<<}++}')
    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'committed',
        transition: {
          cause: 'undo',
          history: 'none'
        }
      })
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: before.revision.selection?.anchor,
      focus: before.revision.selection?.focus
    })
  })
})

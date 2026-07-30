import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createMemoryDocumentSessionJournalStorage,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type CriticMarkupNode,
  type DocumentSession,
  type EditorIntent,
  type InitialModelSelection,
  type ParseConfiguration,
  type SourceOffset,
  type SourceRange
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

function open(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete test revision')
  }
  return revision
}

function nodeOf(
  source: string,
  kind: CriticMarkupNode['kind']
): CriticMarkupNode {
  const revision = open(source)
  const pending: CriticMarkupNode[] = []
  for (let index = revision.criticMarkup.rootCount - 1; index >= 0; index -= 1) {
    pending.push(revision.criticMarkup.rootAt(index))
  }
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) {
      continue
    }
    if (node.kind === kind) {
      return node
    }
    for (let armIndex = node.arms.length - 1; armIndex >= 0; armIndex -= 1) {
      const arm = node.arms[armIndex]
      if (arm !== undefined) {
        pending.push(...arm.children.slice().reverse())
      }
    }
  }
  throw new Error(`Missing ${kind} node`)
}

function sourceRange(start: number, end: number): SourceRange {
  return Object.freeze({
    start: start as SourceOffset,
    end: end as SourceOffset
  })
}

const HOME_SELECTION: InitialModelSelection = Object.freeze({
  anchor: Object.freeze({ offset: 0, affinity: 'next' as const }),
  focus: Object.freeze({ offset: 0, affinity: 'next' as const })
})

interface MutationCase {
  readonly name: string
  readonly source: string
  readonly expected: string
  readonly trackChanges: boolean
  readonly selection?: InitialModelSelection
  readonly intent: (session: DocumentSession) => EditorIntent
}

describe('DocumentSession typed source-native mutations', () => {
  it('commits every mutation from one typed source-native intent', async() => {
    const cases: readonly MutationCase[] = [
      {
        name: 'resolve one change',
        source: '{++A++}',
        expected: 'A',
        trackChanges: false,
        intent: () => ({
          kind: 'resolve-change',
          target: nodeOf('{++A++}', 'addition').nodeId,
          decision: 'accept'
        })
      },
      {
        name: 'resolve all changes',
        source: '{++A++}|{--B--}|{~~C~>D~~}',
        expected: 'A||D',
        trackChanges: false,
        intent: () => ({
          kind: 'resolve-all-changes',
          decision: 'accept'
        })
      },
      {
        name: 'remove Highlight',
        source: 'a{==focus==}b',
        expected: 'afocusb',
        trackChanges: false,
        intent: () => ({
          kind: 'remove-highlight',
          target: nodeOf('a{==focus==}b', 'highlight').nodeId
        })
      },
      {
        name: 'add Comment',
        source: 'abc',
        expected: 'a{==b==}{>>note<<}c',
        trackChanges: false,
        intent: () => ({
          kind: 'add-comment',
          range: sourceRange(1, 2),
          comment: 'note'
        })
      },
      {
        name: 'edit Comment',
        source: 'a{>>old<<}b',
        expected: 'a{>>new<<}b',
        trackChanges: false,
        intent: () => ({
          kind: 'edit-comment',
          target: nodeOf('a{>>old<<}b', 'comment').nodeId,
          comment: 'new'
        })
      },
      {
        name: 'remove Comment',
        source: 'a{>>note<<}b',
        expected: 'ab',
        trackChanges: false,
        intent: () => ({
          kind: 'remove-comment',
          target: nodeOf('a{>>note<<}b', 'comment').nodeId
        })
      },
      {
        name: 'track plain insertion',
        source: 'ab',
        expected: 'a{++x++}b',
        trackChanges: true,
        selection: {
          anchor: { offset: 1, affinity: 'next' },
          focus: { offset: 1, affinity: 'next' }
        },
        intent: (session) => {
          const target = session.snapshot().revision.selection
          if (target === null) {
            throw new Error('Expected an insertion target')
          }
          return { kind: 'insert-text', target, text: 'x' }
        }
      },
      {
        name: 'track plain deletion',
        source: 'abc',
        expected: 'a{--b--}c',
        trackChanges: true,
        selection: {
          anchor: { offset: 1, affinity: 'next' },
          focus: { offset: 2, affinity: 'previous' }
        },
        intent: (session) => {
          const target = session.snapshot().revision.selection
          if (target === null) {
            throw new Error('Expected a deletion target')
          }
          return { kind: 'delete-text', target }
        }
      },
      {
        name: 'track plain replacement',
        source: 'abc',
        expected: 'a{~~b~>x~~}c',
        trackChanges: true,
        selection: {
          anchor: { offset: 1, affinity: 'next' },
          focus: { offset: 2, affinity: 'previous' }
        },
        intent: (session) => {
          const target = session.snapshot().revision.selection
          if (target === null) {
            throw new Error('Expected a replacement target')
          }
          return { kind: 'replace-text', target, text: 'x' }
        }
      },
      {
        name: 'insert directly in a pending Addition',
        source: '{++ab++}',
        expected: '{++axb++}',
        trackChanges: true,
        selection: {
          anchor: { offset: 1, affinity: 'next' },
          focus: { offset: 1, affinity: 'next' }
        },
        intent: (session) => {
          const target = session.snapshot().revision.selection
          if (target === null) {
            throw new Error('Expected an Addition insertion target')
          }
          return { kind: 'insert-text', target, text: 'x' }
        }
      },
      {
        name: 'delete directly in a pending Addition',
        source: '{++abc++}',
        expected: '{++ac++}',
        trackChanges: true,
        selection: {
          anchor: { offset: 1, affinity: 'next' },
          focus: { offset: 2, affinity: 'previous' }
        },
        intent: (session) => {
          const target = session.snapshot().revision.selection
          if (target === null) {
            throw new Error('Expected an Addition deletion target')
          }
          return { kind: 'delete-text', target }
        }
      },
      {
        name: 'replace directly in a pending Substitution new arm',
        source: '{~~old~>new~~}',
        expected: '{~~old~>nxw~~}',
        trackChanges: true,
        selection: {
          anchor: { offset: 4, affinity: 'next' },
          focus: { offset: 5, affinity: 'previous' }
        },
        intent: (session) => {
          const target = session.snapshot().revision.selection
          if (target === null) {
            throw new Error('Expected a Substitution replacement target')
          }
          return { kind: 'replace-text', target, text: 'x' }
        }
      }
    ]

    for (const [index, row] of cases.entries()) {
      const storage = createMemoryDocumentSessionJournalStorage()
      const session = await createDocumentSession({
        source: createSourceSnapshot(row.source),
        parseConfiguration: TEST_CONFIGURATION,
        trackChanges: row.trackChanges,
        initialSelection: row.selection ?? HOME_SELECTION,
        durability: {
          key: `typed-intent-${String(index)}`,
          storage
        }
      })
      const before = session.snapshot()
      const beforeSelection = before.revision.selection
      const ticket = session.dispatch(row.intent(session))
      await expect(ticket.admission, row.name).resolves.toMatchObject({
        kind: 'admitted'
      })
      await expect(ticket.completion, row.name).resolves.toMatchObject({
        kind: 'committed',
        transition: {
          cause: 'source-edit',
          history: 'record',
          before
        }
      })
      expect(session.snapshot().revision.source, row.name).toBe(row.expected)
      expect(session.ticketOutcome(ticket.id), row.name).toMatchObject({
        kind: 'committed',
        cause: 'source-edit',
        history: 'record',
        sourceHash: session.snapshot().revision.sourceHash,
        semanticHash: session.snapshot().revision.semanticHash
      })
      const afterSelection = session.snapshot().revision.selection

      await expect(
        session.dispatch({ kind: 'undo' }).completion,
        `${row.name} undo`
      ).resolves.toMatchObject({ kind: 'committed' })
      expect(session.snapshot().revision.source, `${row.name} undo`)
        .toBe(row.source)
      expect(session.snapshot().revision.selection, `${row.name} undo`)
        .toMatchObject({
          anchor: beforeSelection?.anchor,
          focus: beforeSelection?.focus
        })
      await expect(
        session.dispatch({ kind: 'redo' }).completion,
        `${row.name} redo`
      ).resolves.toMatchObject({ kind: 'committed' })
      expect(session.snapshot().revision.source, `${row.name} redo`)
        .toBe(row.expected)
      expect(session.snapshot().revision.selection, `${row.name} redo`)
        .toMatchObject({
          anchor: afterSelection?.anchor,
          focus: afterSelection?.focus
        })
    }

    // A collapsed add-comment range authors the standalone form (G36).
    const standalone = await createDocumentSession({
      source: createSourceSnapshot('abc'),
      parseConfiguration: TEST_CONFIGURATION,
      trackChanges: false,
      initialSelection: HOME_SELECTION
    })
    await expect(standalone.dispatch({
      kind: 'add-comment',
      range: sourceRange(1, 1),
      comment: 'note'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(standalone.snapshot().revision.source).toBe('a{>>note<<}bc')
    await expect(
      standalone.dispatch({ kind: 'undo' }).completion
    ).resolves.toMatchObject({ kind: 'committed' })
    expect(standalone.snapshot().revision.source).toBe('abc')

    for (const row of [
      {
        name: 'Deletion content',
        source: '{--old--}',
        selection: {
          anchor: { offset: 1, affinity: 'next' as const },
          focus: { offset: 1, affinity: 'next' as const }
        },
        intent: (target: NonNullable<
          ReturnType<DocumentSession['snapshot']>['revision']['selection']
        >): EditorIntent => ({
          kind: 'insert-text',
          target,
          text: 'x'
        })
      },
      {
        name: 'Substitution old arm',
        source: '{~~old~>new~~}',
        selection: {
          anchor: { offset: 1, affinity: 'next' as const },
          focus: { offset: 2, affinity: 'previous' as const }
        },
        intent: (target: NonNullable<
          ReturnType<DocumentSession['snapshot']>['revision']['selection']
        >): EditorIntent => ({
          kind: 'replace-text',
          target,
          text: 'x'
        })
      }
    ] as const) {
      const readOnly = await createDocumentSession({
        source: createSourceSnapshot(row.source),
        parseConfiguration: TEST_CONFIGURATION,
        trackChanges: true,
        initialSelection: row.selection
      })
      const beforeReadOnly = readOnly.snapshot()
      const target = beforeReadOnly.revision.selection
      if (target === null) {
        throw new Error(`Expected ${row.name} selection`)
      }
      const result = await readOnly.dispatch(row.intent(target)).completion
      expect(result, row.name).toMatchObject({
        kind: 'rejected',
        reason: 'read-only-change-arm'
      })
      expect(readOnly.snapshot().revision.source, row.name).toBe(row.source)
      if (row.name === 'Deletion content') {
        expect(readOnly.snapshot().pending, row.name).toMatchObject({
          status: 'blocked',
          retained: [
            {
              text: 'x',
              reason: 'read-only-change-arm'
            }
          ]
        })
      } else {
        expect(readOnly.snapshot(), row.name).toBe(beforeReadOnly)
      }
      await expect(
        readOnly.dispatch({ kind: 'undo' }).completion,
        `${row.name} history`
      ).resolves.toMatchObject({
        kind: 'rejected',
        reason: 'nothing-to-undo'
      })
    }
  })
})

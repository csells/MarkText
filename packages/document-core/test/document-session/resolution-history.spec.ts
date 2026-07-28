import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createMemoryDocumentSessionJournalStorage,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type CriticMarkupNode,
  type DocumentSession,
  type DocumentSessionJournalStorage,
  type DocumentSessionOpenOptions,
  type NodeId,
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

function changesOf(source: string): readonly CriticMarkupNode[] {
  const revision = open(source)
  const changes: CriticMarkupNode[] = []
  const visit = (node: CriticMarkupNode): void => {
    if (
      node.kind === 'addition' ||
      node.kind === 'deletion' ||
      node.kind === 'substitution'
    ) {
      changes.push(node)
    }
    for (const arm of node.arms) {
      for (const child of arm.children) {
        visit(child)
      }
    }
  }
  for (let index = 0; index < revision.criticMarkup.rootCount; index += 1) {
    visit(revision.criticMarkup.rootAt(index))
  }
  return changes
}

function options(
  source: string,
  key: string,
  storage: DocumentSessionJournalStorage
): DocumentSessionOpenOptions {
  return {
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    trackChanges: false,
    initialSelection: {
      anchor: { offset: 0, affinity: 'next' },
      focus: { offset: 0, affinity: 'next' }
    },
    durability: { key, storage }
  }
}

async function expectCommit(
  session: DocumentSession,
  intent: Parameters<DocumentSession['dispatch']>[0]
): Promise<void> {
  const result = await session.dispatch(intent).completion
  expect(result).toMatchObject({
    kind: 'committed',
    transition: {
      cause: 'source-edit',
      history: 'record'
    }
  })
}

describe('DocumentSession source-native resolution history', () => {
  it('individual and bulk resolution have exact behavioral equivalence and undo', async() => {
    const source = '{++A++}|{--B--}|{~~C~>D~~}'
    for (const row of [
      { decision: 'accept', expected: 'A||D' },
      { decision: 'reject', expected: '|B|C' }
    ] as const) {
      const individualStorage = createMemoryDocumentSessionJournalStorage()
      const bulkStorage = createMemoryDocumentSessionJournalStorage()
      const individualOptions = options(
        source,
        `resolution-individual-${row.decision}`,
        individualStorage
      )
      const bulkOptions = options(
        source,
        `resolution-bulk-${row.decision}`,
        bulkStorage
      )
      const individual = await createDocumentSession(individualOptions)
      const bulk = await createDocumentSession(bulkOptions)

      for (let ordinal = 0; ordinal < 3; ordinal += 1) {
        const target = changesOf(
          individual.snapshot().revision.source
        )[0]?.nodeId
        if (target === undefined) {
          throw new Error('Expected an unresolved change')
        }
        await expectCommit(individual, {
          kind: 'resolve-change',
          target,
          decision: row.decision
        })
      }
      await expectCommit(bulk, {
        kind: 'resolve-all-changes',
        decision: row.decision
      })

      expect(individual.snapshot().revision.source).toBe(row.expected)
      expect(bulk.snapshot().revision.source).toBe(row.expected)
      expect(individual.snapshot().revision.semanticHash)
        .toBe(bulk.snapshot().revision.semanticHash)

      const recoveredIndividual = await createDocumentSession(
        individualOptions
      )
      const recoveredBulk = await createDocumentSession(bulkOptions)
      for (let ordinal = 0; ordinal < 3; ordinal += 1) {
        await expect(
          recoveredIndividual.dispatch({ kind: 'undo' }).completion
        ).resolves.toMatchObject({ kind: 'committed' })
      }
      await expect(
        recoveredBulk.dispatch({ kind: 'undo' }).completion
      ).resolves.toMatchObject({ kind: 'committed' })
      expect(recoveredIndividual.snapshot().revision.source).toBe(source)
      expect(recoveredBulk.snapshot().revision.source).toBe(source)

      for (let ordinal = 0; ordinal < 3; ordinal += 1) {
        await expect(
          recoveredIndividual.dispatch({ kind: 'redo' }).completion
        ).resolves.toMatchObject({ kind: 'committed' })
      }
      await expect(
        recoveredBulk.dispatch({ kind: 'redo' }).completion
      ).resolves.toMatchObject({ kind: 'committed' })
      expect(recoveredIndividual.snapshot().revision.source)
        .toBe(row.expected)
      expect(recoveredBulk.snapshot().revision.source).toBe(row.expected)
    }

    const rejectionStorage = createMemoryDocumentSessionJournalStorage()
    const rejection = await createDocumentSession(
      options(source, 'resolution-rejection', rejectionStorage)
    )
    const before = rejection.snapshot()
    const ticket = rejection.dispatch({
      kind: 'resolve-change',
      target: 'p1:missing' as NodeId,
      decision: 'accept'
    })
    await expect(ticket.completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'target-not-found',
      snapshot: before
    })
    expect(rejection.snapshot()).toBe(before)
    expect(rejection.ticketOutcome(ticket.id)).toMatchObject({
      kind: 'rejected',
      reason: 'target-not-found',
      revision: before.revision.id
    })
    await expect(
      rejection.dispatch({ kind: 'undo' }).completion
    ).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'nothing-to-undo'
    })
  })
})

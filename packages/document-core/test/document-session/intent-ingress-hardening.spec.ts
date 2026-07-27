import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createMemoryDocumentSessionJournalStorage,
  createSourceSnapshot,
  DOCUMENT_SEARCH_RESOURCE_POLICY_V1,
  type DocumentSession,
  type DocumentSessionJournalStorage,
  type EditorIntent,
  type ModelSelection,
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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function dispatchUnknown(session: DocumentSession, intent: unknown): void {
  session.dispatch(intent as EditorIntent)
}

async function expectAtomicIngressRejection(
  session: DocumentSession,
  storage: DocumentSessionJournalStorage,
  key: string,
  intent: unknown
): Promise<void> {
  const beforeSnapshot = session.snapshot()
  const beforeHistory = session.historyState()
  const beforeJournal = await storage.read(key)

  expect(() => dispatchUnknown(session, intent)).toThrow('Editor intent')
  expect(session.snapshot()).toBe(beforeSnapshot)
  expect(session.historyState()).toEqual(beforeHistory)
  expect(await storage.read(key)).toEqual(beforeJournal)
}

function literalQuery(text: string): Readonly<{
  schema: 'document-search-query-1'
  text: string
  syntax: 'literal'
  caseSensitive: boolean
  wholeWord: boolean
}> {
  return {
    schema: 'document-search-query-1',
    text,
    syntax: 'literal',
    caseSensitive: true,
    wholeWord: false
  }
}

describe('DocumentSession pre-journal intent admission', () => {
  it('rejects a malformed nested query without changing session or journal state', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const session = await createDocumentSession({
      source: createSourceSnapshot('alpha'),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 5, affinity: 'next' },
        focus: { offset: 5, affinity: 'next' }
      },
      durability: {
        key: 'closed-intent-ingress',
        storage
      }
    })
    const target = session.snapshot().revision.selection
    if (target === null) throw new Error('Expected an initial selection')
    await expectAtomicIngressRejection(
      session,
      storage,
      'closed-intent-ingress',
      {
        kind: 'replace-current-matches',
        target,
        query: null,
        replacement: 'x'
      }
    )

    const valid = session.dispatch({
      kind: 'insert-text',
      target,
      text: ''
    })
    expect(valid.clientSequence).toBe(1)
    expect((await valid.completion).kind).toBe('noop')
  })

  it('rejects hostile prototypes, accessors, symbols, and nested shapes atomically', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const key = 'hostile-closed-intent-ingress'
    const session = await createDocumentSession({
      source: createSourceSnapshot('alpha'),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 5, affinity: 'next' },
        focus: { offset: 5, affinity: 'next' }
      },
      durability: { key, storage }
    })
    const target = session.snapshot().revision.selection
    if (target === null) throw new Error('Expected an initial selection')

    const inheritedQuery = Object.assign(
      Object.create({ inherited: true }) as Record<string, unknown>,
      literalQuery('alpha')
    )
    const inheritedTarget = Object.assign(
      Object.create({ inherited: true }) as Record<string, unknown>,
      target
    )
    const accessorIntent = {
      kind: 'insert-text',
      target
    } as Record<string, unknown>
    Object.defineProperty(accessorIntent, 'text', {
      enumerable: true,
      get: () => 'x'
    })
    const symbolIntent = {
      kind: 'insert-text',
      target,
      text: 'x',
      [Symbol('hidden')]: true
    }

    for (const intent of [
      {
        kind: 'replace-current-matches',
        target,
        query: inheritedQuery,
        replacement: 'x'
      },
      {
        kind: 'insert-text',
        target: inheritedTarget,
        text: 'x'
      },
      {
        kind: 'insert-text',
        target: {
          ...target,
          anchor: null
        },
        text: 'x'
      },
      {
        kind: 'convert-block',
        target,
        conversion: {
          kind: 'heading',
          level: 1,
          nested: {}
        }
      },
      accessorIntent,
      symbolIntent
    ]) {
      await expectAtomicIngressRejection(session, storage, key, intent)
    }
  })

  it('admits search query and replacement limits below and at the boundary only', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const key = 'bounded-search-intent-ingress'
    const session = await createDocumentSession({
      source: createSourceSnapshot('alpha'),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 5, affinity: 'next' },
        focus: { offset: 5, affinity: 'next' }
      },
      durability: { key, storage }
    })
    const target = session.snapshot().revision.selection
    if (target === null || target.view !== 'markup') {
      throw new Error('Expected a Markup selection')
    }

    const queryLimit = DOCUMENT_SEARCH_RESOURCE_POLICY_V1.maximumQueryUnits
    const replacementLimit =
      DOCUMENT_SEARCH_RESOURCE_POLICY_V1.maximumGeneratedReplacementUnits
    const admitted: readonly Readonly<{
      query: string
      replacement: string
    }>[] = [
      {
        query: 'q'.repeat(queryLimit - 1),
        replacement: 'r'.repeat(replacementLimit - 1)
      },
      {
        query: 'q'.repeat(queryLimit),
        replacement: 'r'.repeat(replacementLimit)
      }
    ]
    for (const boundary of admitted) {
      const ticket = session.dispatch({
        kind: 'replace-current-matches',
        target,
        query: literalQuery(boundary.query),
        replacement: boundary.replacement
      })
      await expect(ticket.admission).resolves.toMatchObject({ kind: 'admitted' })
      await expect(ticket.completion).resolves.toMatchObject({
        kind: 'rejected',
        reason: 'no-source-change'
      })
    }

    await expectAtomicIngressRejection(session, storage, key, {
      kind: 'replace-current-matches',
      target,
      query: literalQuery('q'.repeat(queryLimit + 1)),
      replacement: ''
    })
    await expectAtomicIngressRejection(session, storage, key, {
      kind: 'replace-current-matches',
      target,
      query: literalQuery('q'),
      replacement: 'r'.repeat(replacementLimit + 1)
    })

    const next = session.dispatch({
      kind: 'insert-text',
      target: target as ModelSelection,
      text: ''
    })
    expect(next.clientSequence).toBe(3)
    expect((await next.completion).kind).toBe('noop')
  })
})

import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentHistoryState,
  type EditorSnapshot,
  type MarkdownNode,
  type ParseConfiguration,
  type SessionOperation
} from '@marktext/document-core'
import { describe, expect, it } from 'vitest'

const CONFIGURATION: ParseConfiguration = Object.freeze({
  markdownProfile: 'markdown-profile-1',
  criticMarkupProfile: 'marktext-profile-1',
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  markdownOptions: Object.freeze({
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: false
  }),
  executionBudget: Object.freeze({
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  })
})

function kinds(root: MarkdownNode): readonly string[] {
  const result: string[] = []
  const visit = (node: MarkdownNode): void => {
    result.push(node.kind)
    for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
      visit(node.childAt(ordinal))
    }
  }
  visit(root)
  return result
}

interface ReconfigureResult {
  readonly kind: 'reconfigured'
  readonly snapshot: EditorSnapshot
  readonly historyState: DocumentHistoryState
}

describe('document-session Markdown option reconfiguration', () => {
  it('does not reparse or replace snapshot identities for an unchanged patch', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('plain\n'),
      parseConfiguration: CONFIGURATION
    })
    const initial = session.snapshot()
    const initialHistory = session.historyState()

    const result = await session.reconfigureMarkdownOptions({
      footnotes: false,
      gitLabMath: false,
      subscriptAndSuperscript: false
    }).completion

    expect(result.snapshot).toBe(initial)
    expect(result.snapshot.revision).toBe(initial.revision)
    expect(result.historyState).toEqual(initialHistory)
    expect(session.snapshot()).toBe(initial)
  })

  it('reinterprets false→true→false atomically without changing source, selection, or history identity', async() => {
    const source = 'lead note[^n]\n\n[^n]: body\n'
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: CONFIGURATION
    })
    session.select({
      anchor: { offset: 4, affinity: 'previous' },
      focus: { offset: 4, affinity: 'previous' }
    })
    const initial = session.snapshot()
    const initialHistory = session.historyState()
    const reconfigurable = session as unknown as {
      reconfigureMarkdownOptions: (
        patch: Readonly<{
          footnotes?: boolean
          gitLabMath?: boolean
          subscriptAndSuperscript?: boolean
        }>
      ) => SessionOperation<ReconfigureResult>
    }

    const enabled = await reconfigurable.reconfigureMarkdownOptions({
      footnotes: true
    }).completion
    expect(enabled.kind).toBe('reconfigured')
    expect(enabled.snapshot.revision.source).toBe(source)
    expect(enabled.snapshot.revision.configuration.markdownOptions.footnotes)
      .toBe(true)
    expect(enabled.snapshot.revision.selection).toEqual(
      initial.revision.selection
    )
    expect(enabled.historyState).toEqual(initialHistory)
    if (enabled.snapshot.kind !== 'complete') {
      throw new Error('Expected complete reconfigured snapshot')
    }
    expect(kinds(enabled.snapshot.editingDocument.root)).toEqual(
      expect.arrayContaining(['footnote-reference', 'footnote-definition'])
    )

    const disabled = await reconfigurable.reconfigureMarkdownOptions({
      footnotes: false
    }).completion
    expect(disabled.snapshot.revision.source).toBe(source)
    expect(disabled.snapshot.revision.configuration.markdownOptions.footnotes)
      .toBe(false)
    expect(disabled.snapshot.revision.selection).toEqual(
      initial.revision.selection
    )
    expect(disabled.historyState).toEqual(initialHistory)
    if (disabled.snapshot.kind !== 'complete') {
      throw new Error('Expected complete reconfigured snapshot')
    }
    expect(kinds(disabled.snapshot.editingDocument.root))
      .not.toContain('footnote-reference')
    expect(kinds(disabled.snapshot.editingDocument.root))
      .not.toContain('footnote-definition')
  })
})

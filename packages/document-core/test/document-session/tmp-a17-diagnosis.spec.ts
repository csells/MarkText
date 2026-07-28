import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createMemoryDocumentSessionJournalStorage,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type CriticMarkupNode,
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

const HOME_SELECTION: InitialModelSelection = Object.freeze({
  anchor: Object.freeze({ offset: 0, affinity: 'next' as const }),
  focus: Object.freeze({ offset: 0, affinity: 'next' as const })
})

function sourceRange(start: number, end: number): SourceRange {
  return Object.freeze({
    start: start as SourceOffset,
    end: end as SourceOffset
  })
}

function open(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') throw new Error('incomplete')
  return revision
}

function nodesOf(revision: CompleteDocumentRevision): readonly CriticMarkupNode[] {
  const nodes: CriticMarkupNode[] = []
  const visit = (node: CriticMarkupNode): void => {
    nodes.push(node)
    for (const arm of node.arms) for (const child of arm.children) visit(child)
  }
  for (let index = 0; index < revision.criticMarkup.rootCount; index += 1) {
    visit(revision.criticMarkup.rootAt(index))
  }
  return nodes
}

function commentIdOf(source: string): string {
  const node = nodesOf(open(source)).find(candidate => candidate.kind === 'comment')
  if (node === undefined) throw new Error(`no comment in ${source}`)
  return node.nodeId
}

describe('A17 diagnosis: authored Comment lifecycle at the session boundary', () => {
  it('adds, edits and removes one commented span', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('alpha target omega\n'),
      parseConfiguration: TEST_CONFIGURATION,
      trackChanges: false,
      initialSelection: HOME_SELECTION,
      durability: {
        key: 'a17-diagnosis',
        storage: createMemoryDocumentSessionJournalStorage()
      }
    })

    const added = session.dispatch({
      kind: 'add-comment',
      range: sourceRange(6, 12),
      comment: 'first note'
    })
    console.log('ADD', JSON.stringify(await added.completion))
    console.log('ADD SOURCE', JSON.stringify(session.snapshot().revision.source))

    const editTarget = commentIdOf(session.snapshot().revision.source)
    const edited = session.dispatch({
      kind: 'edit-comment',
      target: editTarget as never,
      comment: 'edited note'
    })
    console.log('EDIT', JSON.stringify(await edited.completion))
    console.log('EDIT SOURCE', JSON.stringify(session.snapshot().revision.source))

    const removeTarget = commentIdOf(session.snapshot().revision.source)
    const removed = session.dispatch({
      kind: 'remove-comment',
      target: removeTarget as never
    })
    console.log('REMOVE', JSON.stringify(await removed.completion))
    console.log('REMOVE SOURCE', JSON.stringify(session.snapshot().revision.source))

    expect(session.snapshot().revision.source).toBe('alpha target omega\n')
  })
})

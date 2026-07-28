import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createSourceSnapshot,
  type DocumentSession,
  type InitialModelSelection,
  type ParseConfiguration,
  type SourceOffset,
  type SourceRange
} from '@marktext/document-core'

const LOG: string[] = []
const log = (label: string, value: unknown): void => {
  LOG.push(`${label}: ${JSON.stringify(value)}`)
}

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

function sourceRange (start: number, end: number): SourceRange {
  return Object.freeze({
    start: start as SourceOffset,
    end: end as SourceOffset
  })
}

function commentNodeId (session: DocumentSession): string {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(session.snapshot().revision.source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') throw new Error('not complete')
  const pending: { kind: string; nodeId: string; arms: readonly { children: readonly unknown[] }[] }[] = []
  const cm = revision.criticMarkup as unknown as {
    rootCount: number
    rootAt: (i: number) => never
  }
  for (let i = cm.rootCount - 1; i >= 0; i -= 1) pending.push(cm.rootAt(i))
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) continue
    if (node.kind === 'comment') return node.nodeId
    for (let a = node.arms.length - 1; a >= 0; a -= 1) {
      const arm = node.arms[a]
      if (arm !== undefined) pending.push(...(arm.children as never[]).slice().reverse())
    }
  }
  throw new Error('no comment node')
}

describe('P8 diagnosis: authored pair then edit then remove', () => {
  it('mirrors the E2E order: add-comment, edit-comment, remove-comment', async () => {
    const source = 'alpha target omega\n'
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: TEST_CONFIGURATION,
      trackChanges: false,
      initialSelection: HOME_SELECTION
    })
    const add = session.dispatch({
      kind: 'add-comment',
      range: sourceRange(6, 12),
      comment: 'workflow note'
    })
    log('add', (await add.completion).kind)
    log('after add', session.snapshot().revision.source)

    const first = commentNodeId(session)
    const edit = session.dispatch({
      kind: 'edit-comment',
      target: first as never,
      comment: 'edited workflow note'
    })
    const editDone = await edit.completion
    log('edit', {
      kind: editDone.kind,
      reason: (editDone as { reason?: string }).reason
    })
    log('after edit', session.snapshot().revision.source)

    const second = commentNodeId(session)
    log('nodeIds', { first, second, same: first === second })

    const removal = session.dispatch({
      kind: 'remove-comment',
      target: second as never
    })
    const removed = await removal.completion
    log('remove', {
      kind: removed.kind,
      reason: (removed as { reason?: string }).reason
    })
    log('after remove', session.snapshot().revision.source)

    writeFileSync(
      '/private/tmp/claude-501/-Users-csells-Code-csells-MarkText/f850d1f7-7949-42ed-a4c1-6f12848c3169/scratchpad/p8-log.txt',
      LOG.join('\n')
    )
    expect(session.snapshot().revision.source).toBe('alpha target omega\n')
  })
})

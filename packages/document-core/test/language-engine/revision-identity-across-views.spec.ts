import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type MarkdownNode,
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

function open(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete revision')
  }
  return revision
}

function nodeId(node: MarkdownNode): unknown {
  return Reflect.get(node, 'nodeId')
}

function collectNodeIds(root: MarkdownNode): readonly unknown[] {
  const ids: unknown[] = []
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) {
      continue
    }
    ids.push(nodeId(node))
    for (let ordinal = node.childCount - 1; ordinal >= 0; ordinal -= 1) {
      pending.push(node.childAt(ordinal))
    }
  }
  return Object.freeze(ids)
}

describe('revision identity across views', () => {
  it('shares unchanged structure and reconverges to stable public NodeId values', () => {
    const revision = open(
      '# Shared\n\nBefore.\n\n{--# --}Changed\n\nTail.\n'
    )
    const original = revision.projection('original').markdown.root
    const revised = revision.projection('revised').markdown.root

    expect(original.childAt(0)).toBe(revised.childAt(0))
    expect(original.childAt(1)).toBe(revised.childAt(1))
    expect(nodeId(original.childAt(0))).toBe(nodeId(revised.childAt(0)))
    expect(nodeId(original.childAt(1))).toBe(nodeId(revised.childAt(1)))

    expect(original.childAt(2).kind).toBe('heading')
    expect(revised.childAt(2).kind).toBe('paragraph')
    expect(nodeId(original.childAt(2))).not.toBe(nodeId(revised.childAt(2)))

    const originalTail = original.childAt(3)
    const revisedTail = revised.childAt(3)
    expect(originalTail.range).not.toEqual(revisedTail.range)
    expect(nodeId(originalTail)).toBe(nodeId(revisedTail))

    for (const root of [original, revised]) {
      const ids = collectNodeIds(root)
      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

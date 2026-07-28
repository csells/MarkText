import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CriticMarkupNode,
  type MarkdownOptionsV1,
  type ParseConfiguration
} from '@marktext/document-core'

interface AdversarialRow {
  readonly id: string
  readonly source: string
  readonly markdownOptions: MarkdownOptionsV1
  readonly criticKindsPreorder: readonly string[]
  readonly criticSourcePreorder: readonly string[]
  readonly originalSource: string
  readonly revisedSource: string
}

const CORPUS = JSON.parse(readFileSync(
  new URL('../../../../specs/migration/profile1-adversarial.yml', import.meta.url),
  'utf8'
)) as { readonly cases: readonly AdversarialRow[] }

function configuration(markdownOptions: MarkdownOptionsV1): ParseConfiguration {
  return {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions,
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
      limitsProfile: 'desktop-v1',
      accountingSchema: 'syntax-accounting-1'
    }
  }
}

function preorder(roots: readonly CriticMarkupNode[]): readonly CriticMarkupNode[] {
  const result: CriticMarkupNode[] = []
  const pending = [...roots].reverse()
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) continue
    result.push(node)
    for (const arm of [...node.arms].reverse()) {
      pending.push(...[...arm.children].reverse())
    }
  }
  return result
}

describe('Profile 1 adversarial corpus', () => {
  it.each(CORPUS.cases)('$id has the specified parse and projections', row => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(row.source),
      configuration(row.markdownOptions)
    )
    expect(revision.kind, row.id).toBe('complete')
    if (revision.kind !== 'complete') return

    expect(revision.source.text, row.id).toBe(row.source)
    expect(revision.projection('original').source, row.id).toBe(row.originalSource)
    expect(revision.projection('revised').source, row.id).toBe(row.revisedSource)

    const nodes = preorder(Array.from(
      { length: revision.criticMarkup.rootCount },
      (_, ordinal) => revision.criticMarkup.rootAt(ordinal)
    ))
    expect(nodes.map(node => node.kind), row.id)
      .toEqual(row.criticKindsPreorder)
    expect(nodes.map(node => row.source.slice(node.range.start, node.range.end)), row.id)
      .toEqual(row.criticSourcePreorder)
  })
})

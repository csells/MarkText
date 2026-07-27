import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CriticMarkupNode,
  type ParseConfiguration
} from '@marktext/document-core'

interface RecoveryRow {
  readonly id: string
  readonly source: string
  readonly criticKindsPreorder: readonly string[]
  readonly originalSource: string
  readonly revisedSource: string
  readonly diagnosticCodes: readonly string[]
}

const CONFIGURATION: ParseConfiguration = {
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

function nodeKinds(nodes: readonly CriticMarkupNode[]): readonly string[] {
  const kinds: string[] = []
  const pending = [...nodes].reverse()
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) continue
    kinds.push(node.kind)
    for (const arm of [...node.arms].reverse()) {
      pending.push(...[...arm.children].reverse())
    }
  }
  return kinds
}

describe('Profile 1 malformed recovery corpus', () => {
  it('is total and lossless across the frozen recovery corpus', () => {
    const manifest = JSON.parse(readFileSync(
      new URL('../../../../specs/migration/malformed-recovery.yml', import.meta.url),
      'utf8'
    )) as { readonly cases: readonly RecoveryRow[] }

    for (const row of manifest.cases) {
      const revision = createLanguageEngine().open(
        createSourceSnapshot(row.source),
        CONFIGURATION
      )
      expect(revision.kind, row.id).toBe('complete')
      if (revision.kind !== 'complete') continue
      expect(revision.source.text, row.id).toBe(row.source)
      expect(revision.projection('original').source, row.id).toBe(row.originalSource)
      expect(revision.projection('revised').source, row.id).toBe(row.revisedSource)
      const roots = Array.from(
        { length: revision.criticMarkup.rootCount },
        (_, ordinal) => revision.criticMarkup.rootAt(ordinal)
      )
      expect(nodeKinds(roots), row.id).toEqual(row.criticKindsPreorder)
      expect(Array.from(
        { length: revision.diagnostics.count },
        (_, ordinal) => revision.diagnostics.at(ordinal).code
      ), row.id).toEqual(row.diagnosticCodes)
    }
  })
})

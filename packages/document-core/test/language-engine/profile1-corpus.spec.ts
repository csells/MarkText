import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CriticMarkupNode,
  type ParseConfiguration
} from '@marktext/document-core'

interface CorpusRow {
  readonly id: string
  readonly source: string
  readonly criticKindsPreorder: readonly string[]
  readonly originalSource: string
  readonly revisedSource: string
}

interface Corpus {
  readonly cases: readonly CorpusRow[]
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

function corpus(name: string): Corpus {
  return JSON.parse(
    readFileSync(new URL(`../../../../specs/migration/${name}`, import.meta.url), 'utf8')
  ) as Corpus
}

function preorder(nodes: readonly CriticMarkupNode[]): readonly CriticMarkupNode[] {
  const result: CriticMarkupNode[] = []
  const visit = (node: CriticMarkupNode): void => {
    result.push(node)
    for (const arm of node.arms) {
      for (const child of arm.children) {
        visit(child)
      }
    }
  }
  for (const node of nodes) {
    visit(node)
  }
  return result
}

describe('Profile 1 complete recursive corpus', () => {
  it('derives every recursive five-form view from one revision', () => {
    const rows = [
      ...corpus('cm-standard.yml').cases,
      ...corpus('profile1-rulings.yml').cases
    ]
    const engine = createLanguageEngine()
    for (const row of rows) {
      const revision = engine.open(createSourceSnapshot(row.source), CONFIGURATION)
      expect(revision.kind, row.id).toBe('complete')
      if (revision.kind !== 'complete') continue

      expect(revision.source.text, row.id).toBe(row.source)
      expect(revision.projection('original').source, row.id).toBe(row.originalSource)
      expect(revision.projection('revised').source, row.id).toBe(row.revisedSource)

      const roots = Array.from(
        { length: revision.criticMarkup.rootCount },
        (_, ordinal) => revision.criticMarkup.rootAt(ordinal)
      )
      const nodes = preorder(roots)
      expect(nodes.map(node => node.kind), row.id)
        .toEqual(row.criticKindsPreorder)

      const syntaxIds = new Set(Array.from(
        { length: revision.syntax.nodeCount },
        (_, ordinal) => revision.syntax.nodeAt(ordinal).nodeId
      ))
      for (const node of nodes) {
        expect(syntaxIds.has(node.nodeId), `${row.id}:${node.kind}`).toBe(true)
      }
    }
  })
})

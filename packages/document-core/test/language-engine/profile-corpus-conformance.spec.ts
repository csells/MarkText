import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CriticMarkupNode,
  type ParseConfiguration
} from '@marktext/document-core'
import { rootsOf } from '../helpers/collections.js'

interface CorpusCase {
  readonly id: string
  readonly source: string
  readonly originalSource: string
  readonly revisedSource: string
  readonly rootKinds: readonly string[]
  readonly criticKindsPreorder: readonly string[]
  readonly diagnosticCodes?: readonly string[]
}

interface CorpusArtifact {
  readonly id: string
  readonly cases: readonly CorpusCase[]
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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

function readCorpus(name: string): CorpusArtifact {
  return JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'specs/migration', name), 'utf8')
  ) as CorpusArtifact
}

const CORPORA = [
  readCorpus('cm-standard.yml'),
  readCorpus('profile1-rulings.yml'),
  readCorpus('malformed-recovery.yml')
] as const
const CASES = CORPORA.flatMap((corpus) =>
  corpus.cases.map((row) => ({ ...row, corpus: corpus.id }))
)

function diagnosticCodes(
  revision: Extract<
    ReturnType<ReturnType<typeof createLanguageEngine>['open']>,
    { readonly kind: 'complete' }
  >
): readonly string[] {
  return Array.from(
    { length: revision.diagnostics.count },
    (_, ordinal) => revision.diagnostics.at(ordinal).code
  )
}

function criticKindsPreorder(nodes: readonly CriticMarkupNode[]): string[] {
  const kinds: string[] = []
  const visit = (node: CriticMarkupNode): void => {
    kinds.push(node.kind)
    for (const arm of node.arms) {
      for (const child of arm.children) {
        visit(child)
      }
    }
  }
  for (const node of nodes) {
    visit(node)
  }
  return kinds
}

describe('Profile 1 frozen language corpora', () => {
  const engine = createLanguageEngine()

  it.each(CASES)('$corpus/$id has its frozen public parse and projections', (row) => {
    const revision = engine.open(createSourceSnapshot(row.source), TEST_CONFIGURATION)

    expect(revision.kind, row.id).toBe('complete')
    if (revision.kind !== 'complete') {
      return
    }
    expect(revision.source.text, row.id).toBe(row.source)
    expect(
      rootsOf(revision.criticMarkup).map((node) => node.kind),
      row.id
    ).toEqual(row.rootKinds)
    expect(
      criticKindsPreorder(rootsOf(revision.criticMarkup)),
      row.id
    ).toEqual(row.criticKindsPreorder)
    expect(revision.projection('original').source, row.id).toBe(row.originalSource)
    expect(revision.projection('revised').source, row.id).toBe(row.revisedSource)
    expect(diagnosticCodes(revision), row.id).toEqual(row.diagnosticCodes ?? [])
  })

  it.each(CASES)('$corpus/$id opens every mid-edit prefix losslessly', (row) => {
    for (let end = 0; end <= row.source.length; end += 1) {
      const prefix = row.source.slice(0, end)
      const revision = engine.open(createSourceSnapshot(prefix), TEST_CONFIGURATION)
      expect(revision.kind, `${row.id}@${String(end)}`).toBe('complete')
      expect(revision.source.text, `${row.id}@${String(end)}`).toBe(prefix)
    }
  })
})

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: false,
    frontMatter: false,
    math: false,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: false
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

interface SpecExample {
  readonly example: number
  readonly section: string
  readonly markdown: string
}

const CORPUS: readonly SpecExample[] = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../fixtures/commonmark-0.31.2-spec.json'
    ),
    'utf8'
  )
)

// Harvest-list item 1, the half that needs no differential design: the
// official CommonMark 0.31.2 corpus as a TOTALITY gate. Every example input
// must parse to a complete revision holding exact source (R-6: every input
// parses; P2: the source is the authority) — and so must every prefix-shaped
// mutation an editor mid-edit state produces. Structural conformance against
// the corpus's html column needs the comparison design tracked in the plan
// (document-core renders no HTML) and is deliberately not claimed here.
describe('CommonMark 0.31.2 corpus totality', () => {
  const engine = createLanguageEngine()

  it('parses all 652 spec inputs to complete revisions with exact source', () => {
    const failures: string[] = []
    for (const example of CORPUS) {
      try {
        const revision = engine.open(
          createSourceSnapshot(example.markdown),
          TEST_CONFIGURATION
        )
        if (revision.kind !== 'complete') {
          failures.push(`#${example.example} (${example.section}): ${revision.kind}`)
        } else if (revision.source.text !== example.markdown) {
          failures.push(`#${example.example} (${example.section}): source drift`)
        }
      } catch (error) {
        failures.push(`#${example.example} (${example.section}): threw ${String(error)}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('parses every mid-edit prefix of a corpus sample without throwing (T1)', () => {
    // The full cross-product is ~650 × avg-length parses; sample the corpus
    // deterministically instead — every 13th example, every prefix.
    const failures: string[] = []
    for (let index = 0; index < CORPUS.length; index += 13) {
      const example = CORPUS[index]
      if (example === undefined) {
        continue
      }
      for (let cut = 0; cut <= example.markdown.length; cut += 1) {
        const prefix = example.markdown.slice(0, cut)
        try {
          const revision = engine.open(
            createSourceSnapshot(prefix),
            TEST_CONFIGURATION
          )
          if (revision.kind !== 'complete') {
            failures.push(`#${example.example}@${cut}: ${revision.kind}`)
          }
        } catch (error) {
          failures.push(`#${example.example}@${cut}: threw ${String(error)}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  renderMarkdownHtml,
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
  readonly html: string
}

interface PendingExample {
  readonly example: number
  readonly reason: string
  readonly currentHtml: string
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

const PENDING: readonly PendingExample[] = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../fixtures/commonmark-0.31.2-pending.json'
    ),
    'utf8'
  )
)
const PENDING_BY_EXAMPLE = new Map(
  PENDING.map((entry) => [entry.example, entry] as const)
)

describe('CommonMark 0.31.2 HTML conformance (materializer-backed)', () => {
  const engine = createLanguageEngine()
  const bySection = new Map<string, SpecExample[]>()
  for (const example of CORPUS) {
    const section = bySection.get(example.section)
    if (section === undefined) {
      bySection.set(example.section, [example])
    } else {
      section.push(example)
    }
  }

  for (const [section, examples] of bySection) {
    it(`section: ${section} (${examples.length} examples)`, () => {
      const failures: string[] = []
      for (const example of examples) {
        if (PENDING_BY_EXAMPLE.has(example.example)) {
          continue
        }
        const revision = engine.open(
          createSourceSnapshot(example.markdown),
          TEST_CONFIGURATION
        )
        expect(revision.kind).toBe('complete')
        if (revision.kind !== 'complete') {
          continue
        }
        const html = renderMarkdownHtml(revision.projection('revised').markdown)
        if (html !== example.html) {
          failures.push(
            `#${example.example}\n  md:   ${JSON.stringify(example.markdown)}\n` +
              `  want: ${JSON.stringify(example.html)}\n` +
              `  got:  ${JSON.stringify(html)}`
          )
        }
      }
      expect(failures, failures.join('\n')).toEqual([])
    })
  }

  it('pins every pending example to one demonstrated mismatch', () => {
    const corpusByExample = new Map(
      CORPUS.map((example) => [example.example, example] as const)
    )
    for (const pending of PENDING) {
      const example = corpusByExample.get(pending.example)
      expect(example, `unknown pending example #${pending.example}`).toBeDefined()
      expect(pending.reason.length).toBeGreaterThan(0)
      if (example === undefined) {
        continue
      }
      const revision = engine.open(
        createSourceSnapshot(example.markdown),
        TEST_CONFIGURATION
      )
      expect(revision.kind).toBe('complete')
      if (revision.kind !== 'complete') {
        continue
      }
      const html = renderMarkdownHtml(revision.projection('revised').markdown)
      expect(html, `stale pending output for #${pending.example}`).toBe(
        pending.currentHtml
      )
      expect(html, `pending example #${pending.example} is now conformant`).not
        .toBe(example.html)
    }
  })

  it('has no duplicate pending examples', () => {
    expect(PENDING_BY_EXAMPLE.size).toBe(PENDING.length)
  })

  it('has no pending CommonMark example', () => {
    expect(PENDING).toEqual([])
  })
})

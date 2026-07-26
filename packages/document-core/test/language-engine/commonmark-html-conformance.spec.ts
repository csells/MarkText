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
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
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

const CORPUS: readonly SpecExample[] = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../fixtures/commonmark-0.31.2-spec.json'
    ),
    'utf8'
  )
)

// Sections the HTML materializer has taken green so far. Each addition is a
// red-green slice: enabling a section is the red, the serializer work is the
// green, and a section may never leave this list. When every corpus section
// is enabled the structural-conformance obligation (plan 0009; module design
// record, HTML materialization ruling) is discharged for CommonMark 0.31.2.
const ENABLED_SECTIONS: ReadonlySet<string> = new Set([
  'Thematic breaks',
  'ATX headings',
  'Setext headings',
  'Indented code blocks',
  'Fenced code blocks',
  'Paragraphs',
  'Blank lines',
  'Code spans',
  'Backslash escapes',
  'Hard line breaks',
  'Soft line breaks',
  'Textual content'
])

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
    const run = ENABLED_SECTIONS.has(section) ? it : it.skip
    run(`section: ${section} (${examples.length} examples)`, () => {
      const failures: string[] = []
      for (const example of examples) {
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

  it('every corpus section is either enabled or known-pending', () => {
    // New spec versions may add sections; this trips so the list is curated
    // rather than silently skipping unknown ground.
    for (const section of ENABLED_SECTIONS) {
      expect(bySection.has(section), `unknown section ${section}`).toBe(true)
    }
  })
})

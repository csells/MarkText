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
    gfm: true,
    frontMatter: false,
    math: false,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: false
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

interface SpecExample {
  readonly example: number
  readonly section: string
  readonly markdown: string
  readonly extensions?: readonly string[]
}

const CORPUS: readonly SpecExample[] = (JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../fixtures/gfm-0.29-spec.json'
    ),
    'utf8'
  )
) as Readonly<{ examples: readonly SpecExample[] }>).examples

// G14: GFM was bound only as curated examples, so a GFM regression turned
// nothing red. This is the pinned official corpus — the full GFM 0.29 spec,
// CommonMark-inherited and extension-tagged examples alike — gated as a
// TOTALITY under the shipping gfm profile, the way A35 gates CommonMark:
// every input parses to a complete revision holding exact source, and so
// does every prefix-shaped mid-edit state a sampled example produces.
describe('GFM 0.29 corpus totality', () => {
  const engine = createLanguageEngine()

  it('parses all 672 spec inputs to complete revisions with exact source', () => {
    expect(CORPUS).toHaveLength(672)
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

  it('parses every extension example under the extension constructs', () => {
    // The extension-tagged examples are the ones only this gate can defend;
    // each must parse completely with the construct enabled.
    const tagged = CORPUS.filter((example) => example.extensions !== undefined)
    expect(tagged.length).toBeGreaterThanOrEqual(24)
    const failures: string[] = []
    for (const example of tagged) {
      const revision = engine.open(
        createSourceSnapshot(example.markdown),
        TEST_CONFIGURATION
      )
      if (revision.kind !== 'complete') {
        failures.push(`#${example.example} (${example.section}): ${revision.kind}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('parses every mid-edit prefix of a corpus sample without throwing (T1)', () => {
    // Sampled deterministically like the CommonMark gate — every 13th
    // example, every prefix.
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

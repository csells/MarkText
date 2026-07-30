import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

/**
 * Reference definitions are staged as canonical facts during the intrinsic
 * source progression. Fork-AST selections filter and resolve those shared
 * facts by canonical identity; they never build an index from projected text.
 * The projected-text index builder is gone, so the gate is its absence.
 */

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

describe('canonical reference-definition facts', () => {
  it('ships no projected-text definition index builder', () => {
    const sourceRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../src'
    )
    const offenders: string[] = []
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry)
        if (statSync(path).isDirectory()) {
          walk(path)
          continue
        }
        if (!entry.endsWith('.ts')) {
          continue
        }
        const text = readFileSync(path, 'utf8')
        if (
          text.includes('createMarkdownReferenceDefinitionIndex') ||
          text.includes('referenceDefinitionIndexBuilds')
        ) {
          offenders.push(path)
        }
      }
    }
    walk(sourceRoot)
    expect(offenders).toEqual([])
  })

  it('preserves reference-link resolution from canonical facts', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('[a]: /x\n\nSee [a].\n'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }
    const revised = revision.projection('revised')
    expect(revised.source).toBe('[a]: /x\n\nSee [a].\n')
    expect(revised.markdown.root.childCount).toBeGreaterThan(0)
  })
})

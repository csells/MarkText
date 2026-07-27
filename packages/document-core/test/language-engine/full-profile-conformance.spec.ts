import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  revisionSemanticHashV1,
  sourceHashV1,
  type ParseConfiguration
} from '@marktext/document-core'

interface MarkdownOptionsV1 {
  readonly schema: 'markdown-options-1'
  readonly gfm: boolean
  readonly frontMatter: boolean
  readonly math: boolean
  readonly gitLabMath: boolean
  readonly footnotes: boolean
  readonly subscriptAndSuperscript: boolean
}

interface ParseConfigurationV1 extends ParseConfiguration {
  readonly markdownOptions: MarkdownOptionsV1
  readonly liveHtmlSafetyProfile: 'live-html-sanitized-v1' | 'live-html-escaped-v1'
}

interface HashVectors {
  readonly semantic: readonly {
    readonly id: string
    readonly configuration: Readonly<Record<string, unknown>>
  }[]
}

interface AccountingVectors {
  readonly id: string
  readonly boundaryVectors: readonly {
    readonly id: string
    readonly cases: readonly {
      readonly relation: string
      readonly value: number
      readonly expected: string
    }[]
  }[]
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const HASH_VECTORS = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'specs/migration/hash-vectors.yml'), 'utf8')
) as HashVectors
const ACCOUNTING_VECTORS = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'specs/migration/syntax-accounting-1.yml'), 'utf8')
) as AccountingVectors

const TARGET_CONFIGURATION: ParseConfigurationV1 = {
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

describe('complete Profile 1 configuration and vector contract', () => {
  it('passes every pinned language configuration hash and resource vector', () => {
    expect(ACCOUNTING_VECTORS.id).toBe('syntax-accounting-1')
    expect(ACCOUNTING_VECTORS.boundaryVectors.map((vector) => vector.id)).toEqual([
      'SA1-SOURCE-UNITS',
      'SA1-BUDGET-EVENTS',
      'SA1-MARKDOWN-DEPTH',
      'SA1-CRITICMARKUP-DEPTH'
    ])
    for (const vector of ACCOUNTING_VECTORS.boundaryVectors) {
      expect(
        vector.cases.map(({ relation, expected }) => ({ relation, expected })),
        vector.id
      ).toEqual([
        { relation: 'below', expected: 'complete' },
        { relation: 'at', expected: 'complete' },
        { relation: 'above', expected: 'source-only' }
      ])
    }

    const revision = createLanguageEngine().open(
      createSourceSnapshot('same source'),
      TARGET_CONFIGURATION
    )
    expect(revision.configuration).toEqual(TARGET_CONFIGURATION)
    expect(Object.isFrozen(revision.configuration)).toBe(true)
    expect(Object.isFrozen((revision.configuration as ParseConfigurationV1).markdownOptions)).toBe(
      true
    )

    const sourceHash = sourceHashV1('same source')
    const baseline = revisionSemanticHashV1(sourceHash, TARGET_CONFIGURATION)
    const optionNames = [
      'frontMatter',
      'math',
      'gitLabMath',
      'footnotes',
      'subscriptAndSuperscript'
    ] as const
    for (const option of optionNames) {
      const variant: ParseConfigurationV1 = {
        ...TARGET_CONFIGURATION,
        markdownOptions: {
          ...TARGET_CONFIGURATION.markdownOptions,
          [option]: !TARGET_CONFIGURATION.markdownOptions[option]
        }
      }
      expect(
        revisionSemanticHashV1(sourceHash, variant),
        `semantic identity must include markdownOptions.${option}`
      ).not.toBe(baseline)
    }
  })

  it('frames every semantic known-answer with MarkdownOptionsV1', () => {
    expect(HASH_VECTORS.semantic.length).toBeGreaterThan(0)
    for (const vector of HASH_VECTORS.semantic) {
      expect(vector.configuration['markdownOptions'], `${vector.id} markdownOptions`).toEqual(
        TARGET_CONFIGURATION.markdownOptions
      )
    }
  })
})

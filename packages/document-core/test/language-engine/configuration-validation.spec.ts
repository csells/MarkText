import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

const PRODUCTION_CONFIGURATION: ParseConfiguration = {
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

describe('LanguageEngine.open configuration contract', () => {
  it('rejects every unsupported parser contract identifier instead of returning a lying revision', () => {
    const unsupportedConfigurations: readonly [ParseConfiguration, string][] = [
      [
        { ...PRODUCTION_CONFIGURATION, criticMarkupProfile: 'marktext-profile-2' },
        'criticMarkupProfile: "marktext-profile-2"'
      ],
      [
        { ...PRODUCTION_CONFIGURATION, markdownProfile: 'markdown-profile-2' },
        'markdownProfile: "markdown-profile-2"'
      ],
      [
        {
          ...PRODUCTION_CONFIGURATION,
          liveHtmlSafetyProfile: 'live-html-safety-profile-2'
        } as unknown as ParseConfiguration,
        'liveHtmlSafetyProfile: "live-html-safety-profile-2"'
      ],
      [
        {
          ...PRODUCTION_CONFIGURATION,
          executionBudget: {
            ...PRODUCTION_CONFIGURATION.executionBudget,
            limitsProfile: 'server-v1'
          }
        },
        'executionBudget.limitsProfile: "server-v1"'
      ],
      [
        {
          ...PRODUCTION_CONFIGURATION,
          executionBudget: {
            ...PRODUCTION_CONFIGURATION.executionBudget,
            accountingSchema: 'syntax-accounting-2'
          }
        },
        'executionBudget.accountingSchema: "syntax-accounting-2"'
      ]
    ]

    for (const [configuration, fieldAndValue] of unsupportedConfigurations) {
      expect(() =>
        createLanguageEngine().open(createSourceSnapshot('{++x++}'), configuration)
      ).toThrowError(new RangeError(`Unsupported ParseConfiguration ${fieldAndValue}`))
    }
  })

  it('strictly rejects unknown, missing, and wrongly typed wire fields', () => {
    const invalid: readonly unknown[] = [
      { ...PRODUCTION_CONFIGURATION, surprise: true },
      {
        ...PRODUCTION_CONFIGURATION,
        executionBudget: {
          ...PRODUCTION_CONFIGURATION.executionBudget,
          surprise: true
        }
      },
      {
        ...PRODUCTION_CONFIGURATION,
        markdownOptions: {
          ...PRODUCTION_CONFIGURATION.markdownOptions,
          surprise: true
        }
      },
      {
        ...PRODUCTION_CONFIGURATION,
        markdownOptions: {
          schema: 'markdown-options-1',
          frontMatter: true,
          math: true,
          gitLabMath: false,
          footnotes: false,
          subscriptAndSuperscript: true
        }
      },
      {
        ...PRODUCTION_CONFIGURATION,
        markdownOptions: {
          ...PRODUCTION_CONFIGURATION.markdownOptions,
          gfm: 'yes'
        }
      },
      {
        markdownProfile: PRODUCTION_CONFIGURATION.markdownProfile,
        liveHtmlSafetyProfile: PRODUCTION_CONFIGURATION.liveHtmlSafetyProfile,
        executionBudget: PRODUCTION_CONFIGURATION.executionBudget
      },
      {
        ...PRODUCTION_CONFIGURATION,
        markdownProfile: 1
      },
      {
        ...PRODUCTION_CONFIGURATION,
        executionBudget: null
      },
      null,
      []
    ]

    for (const candidate of invalid) {
      expect(() =>
        createLanguageEngine().open(
          createSourceSnapshot('{++x++}'),
          candidate as ParseConfiguration
        )
      ).toThrow(/ParseConfiguration/)
    }
  })

  it('publishes a deeply immutable decoded configuration', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('text'),
      PRODUCTION_CONFIGURATION
    )
    expect(Object.isFrozen(revision.configuration)).toBe(true)
    expect(Object.isFrozen(revision.configuration.markdownOptions)).toBe(true)
    expect(Object.isFrozen(revision.configuration.executionBudget)).toBe(true)
    expect(revision.configuration).not.toBe(PRODUCTION_CONFIGURATION)
  })
})

import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

const PRODUCTION_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
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
        { ...PRODUCTION_CONFIGURATION, liveHtmlSafetyProfile: 'live-html-safety-profile-2' },
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
})

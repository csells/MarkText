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

  it('rejects an unsafe configuration field', () => {
    // "Unsafe" is one of the five rejection classes: a field that is not an
    // ordinary enumerable data property cannot be decoded into a deeply
    // immutable value, however well-typed it looks.
    const accessorBacked = Object.defineProperty(
      { ...PRODUCTION_CONFIGURATION },
      'markdownProfile',
      { get: () => 'markdown-profile-1', enumerable: true, configurable: true }
    )
    const symbolKeyed = {
      ...PRODUCTION_CONFIGURATION,
      [Symbol('surprise')]: true
    }
    const nonEnumerable = Object.defineProperty(
      { ...PRODUCTION_CONFIGURATION },
      'surprise',
      { value: true, enumerable: false }
    )

    for (const candidate of [accessorBacked, symbolKeyed, nonEnumerable]) {
      expect(() =>
        createLanguageEngine().open(
          createSourceSnapshot('{++x++}'),
          candidate as ParseConfiguration
        )
      ).toThrow(/ParseConfiguration/)
    }
  })

  it('rejects a test-only limits profile', () => {
    // A limits profile that disables the section 3 bounds lets a limit-bearing
    // gate run outside the limits it proves. `desktop-v1` is the only profile.
    expect(() =>
      createLanguageEngine().open(createSourceSnapshot('{++x++}'), {
        ...PRODUCTION_CONFIGURATION,
        executionBudget: {
          ...PRODUCTION_CONFIGURATION.executionBudget,
          limitsProfile: 'test-unbounded'
        }
      } as unknown as ParseConfiguration)
    ).toThrow(/ParseConfiguration/)
  })

  it('rejects a profile that branches no production behavior', () => {
    // The accepted profiles are exactly the three the plan names. An
    // identifier the decoder admits but no production code implements is a
    // configuration a host can request and never receive.
    expect(() =>
      createLanguageEngine().open(createSourceSnapshot('{++x++}'), {
        ...PRODUCTION_CONFIGURATION,
        liveHtmlSafetyProfile: 'live-html-escaped-v1'
      } as unknown as ParseConfiguration)
    ).toThrow(/ParseConfiguration/)
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

import {
  validateAndFreezeParseConfiguration,
  type ParseConfiguration
} from '@marktext/document-core'

export interface MainDocumentGrammarPreferences {
  readonly footnotes: boolean
  readonly gitLabMath: boolean
  readonly subscriptAndSuperscript: boolean
}

const GRAMMAR_KEYS: ReadonlySet<keyof MainDocumentGrammarPreferences> =
  new Set([
    'footnotes',
    'gitLabMath',
    'subscriptAndSuperscript'
  ])

/**
 * §2 grammar configuration: the one main-owned construction site turning
 * persisted settings into the process's single ParseConfiguration.
 *
 * A renderer may later request a closed grammar patch, but it never chooses
 * the initial parser profile or resource/accounting policy for a file.
 */
export function documentParseConfigurationFor(
  preferences: MainDocumentGrammarPreferences
): ParseConfiguration {
  if (
    preferences === null ||
    typeof preferences !== 'object' ||
    Array.isArray(preferences)
  ) {
    throw new TypeError('Document grammar preferences must be a closed record')
  }
  const keys = Reflect.ownKeys(preferences)
  if (keys.some(key => typeof key !== 'string')) {
    throw new TypeError('Document grammar preferences are not closed')
  }
  // Name the offending option: a closed record that rejects without saying
  // which key was wrong makes every caller guess.
  const present = new Set(keys as string[])
  const unexpected = [...present].filter(
    key => !GRAMMAR_KEYS.has(key as keyof MainDocumentGrammarPreferences)
  )
  if (unexpected.length > 0) {
    throw new TypeError(
      'Document grammar preferences are not closed: unknown ' +
        unexpected.sort().join(', ')
    )
  }
  const missing = [...GRAMMAR_KEYS].filter(key => !present.has(key))
  if (missing.length > 0) {
    throw new TypeError(
      'Document grammar preferences are not closed: missing ' +
        missing.sort().join(', ')
    )
  }
  for (const key of GRAMMAR_KEYS) {
    if (typeof preferences[key] !== 'boolean') {
      throw new TypeError(`Document grammar preference ${key} must be boolean`)
    }
  }
  return validateAndFreezeParseConfiguration({
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: {
      schema: 'markdown-options-1',
      gfm: true,
      frontMatter: true,
      math: true,
      gitLabMath: preferences.gitLabMath,
      footnotes: preferences.footnotes,
      subscriptAndSuperscript: preferences.subscriptAndSuperscript
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
      limitsProfile: 'desktop-v1',
      accountingSchema: 'syntax-accounting-1'
    }
  })
}

/**
 * Strictly decode a configuration arriving over a wire boundary. Every field
 * is validated against the closed ParseConfiguration schema; nothing about
 * the value is trusted for having crossed process or thread memory.
 */
export function decodeDocumentParseConfiguration(
  value: unknown
): ParseConfiguration {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Wire parse configuration must be a closed record')
  }
  return validateAndFreezeParseConfiguration(value as ParseConfiguration)
}

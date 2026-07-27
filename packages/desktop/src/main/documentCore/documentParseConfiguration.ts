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
 * Admit the parser configuration in main, from validated persisted settings.
 *
 * A renderer may later request a closed grammar patch, but it never chooses
 * the initial parser profile or resource/accounting policy for a file.
 */
export function createMainDocumentParseConfiguration(
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
  if (
    keys.length !== GRAMMAR_KEYS.size ||
    keys.some(key => (
      typeof key !== 'string' ||
      !GRAMMAR_KEYS.has(key as keyof MainDocumentGrammarPreferences)
    ))
  ) {
    throw new TypeError('Document grammar preferences are not closed')
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

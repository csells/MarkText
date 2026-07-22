import type { ParseConfiguration } from './revision.js'

const CRITIC_MARKUP_PROFILES = new Set(['marktext-profile-1'])
const MARKDOWN_PROFILES = new Set(['markdown-profile-1'])
const LIVE_HTML_SAFETY_PROFILES = new Set(['live-html-safety-profile-1'])
const LIMITS_PROFILES = new Set(['desktop-v1', 'test-unbounded'])
const ACCOUNTING_SCHEMAS = new Set(['syntax-accounting-1'])

function assertSupportedIdentifier(
  field: string,
  value: string,
  supportedIdentifiers: ReadonlySet<string>
): void {
  if (!supportedIdentifiers.has(value)) {
    throw new RangeError(
      `Unsupported ParseConfiguration ${field}: ${JSON.stringify(value)}`
    )
  }
}

export function validateAndFreezeParseConfiguration(
  configuration: ParseConfiguration
): ParseConfiguration {
  const stableConfiguration: ParseConfiguration = Object.freeze({
    criticMarkupProfile: configuration.criticMarkupProfile,
    markdownProfile: configuration.markdownProfile,
    liveHtmlSafetyProfile: configuration.liveHtmlSafetyProfile,
    executionBudget: Object.freeze({
      limitsProfile: configuration.executionBudget.limitsProfile,
      accountingSchema: configuration.executionBudget.accountingSchema
    })
  })

  assertSupportedIdentifier(
    'criticMarkupProfile',
    stableConfiguration.criticMarkupProfile,
    CRITIC_MARKUP_PROFILES
  )
  assertSupportedIdentifier(
    'markdownProfile',
    stableConfiguration.markdownProfile,
    MARKDOWN_PROFILES
  )
  assertSupportedIdentifier(
    'liveHtmlSafetyProfile',
    stableConfiguration.liveHtmlSafetyProfile,
    LIVE_HTML_SAFETY_PROFILES
  )
  assertSupportedIdentifier(
    'executionBudget.limitsProfile',
    stableConfiguration.executionBudget.limitsProfile,
    LIMITS_PROFILES
  )
  assertSupportedIdentifier(
    'executionBudget.accountingSchema',
    stableConfiguration.executionBudget.accountingSchema,
    ACCOUNTING_SCHEMAS
  )

  return stableConfiguration
}

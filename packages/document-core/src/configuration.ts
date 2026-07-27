import type { ParseConfiguration } from './revision.js'

const CRITIC_MARKUP_PROFILES = new Set(['marktext-profile-1'])
const MARKDOWN_PROFILES = new Set(['markdown-profile-1'])
const MARKDOWN_OPTIONS_SCHEMAS = new Set(['markdown-options-1'])
const LIVE_HTML_SAFETY_PROFILES = new Set(['live-html-sanitized-v1'])
const LIMITS_PROFILES = new Set(['desktop-v1', 'test-unbounded'])
const ACCOUNTING_SCHEMAS = new Set(['syntax-accounting-1'])

function configurationError(message: string): TypeError {
  return new TypeError(`Invalid ParseConfiguration: ${message}`)
}

function strictRecord(
  value: unknown,
  path: string,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw configurationError(`${path} must be a record`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) {
    throw configurationError(`${path} has an unknown symbol field`)
  }
  const actual = (keys as string[]).sort()
  const expected = [...expectedKeys].sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    const unknown = actual.filter((key) => !expected.includes(key))
    const missing = expected.filter((key) => !actual.includes(key))
    const details = [
      unknown.length === 0 ? '' : `unknown ${unknown.join(', ')}`,
      missing.length === 0 ? '' : `missing ${missing.join(', ')}`
    ].filter((detail) => detail.length > 0).join('; ')
    throw configurationError(`${path} fields are not closed (${details})`)
  }
  const record = value as Record<string, unknown>
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw configurationError(`${path}.${key} must be an enumerable data field`)
    }
  }
  return record
}

function stringField(
  record: Readonly<Record<string, unknown>>,
  path: string,
  field: string
): string {
  const value = record[field]
  if (typeof value !== 'string') {
    throw configurationError(`${path}.${field} must be a string`)
  }
  return value
}

function booleanField(
  record: Readonly<Record<string, unknown>>,
  path: string,
  field: string
): boolean {
  const value = record[field]
  if (typeof value !== 'boolean') {
    throw configurationError(`${path}.${field} must be a boolean`)
  }
  return value
}

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
  const record = strictRecord(
    configuration,
    'root',
    Object.freeze([
      'criticMarkupProfile',
      'markdownProfile',
      'markdownOptions',
      'liveHtmlSafetyProfile',
      'executionBudget'
    ])
  )
  const markdownOptions = strictRecord(
    record.markdownOptions,
    'markdownOptions',
    Object.freeze([
      'schema',
      'gfm',
      'frontMatter',
      'math',
      'gitLabMath',
      'footnotes',
      'subscriptAndSuperscript'
    ])
  )
  const budget = strictRecord(
    record.executionBudget,
    'executionBudget',
    Object.freeze(['limitsProfile', 'accountingSchema'])
  )
  const stableConfiguration: ParseConfiguration = Object.freeze({
    criticMarkupProfile: stringField(record, 'root', 'criticMarkupProfile'),
    markdownProfile: stringField(record, 'root', 'markdownProfile'),
    markdownOptions: Object.freeze({
      schema: stringField(
        markdownOptions,
        'markdownOptions',
        'schema'
      ) as 'markdown-options-1',
      gfm: booleanField(markdownOptions, 'markdownOptions', 'gfm'),
      frontMatter: booleanField(markdownOptions, 'markdownOptions', 'frontMatter'),
      math: booleanField(markdownOptions, 'markdownOptions', 'math'),
      gitLabMath: booleanField(markdownOptions, 'markdownOptions', 'gitLabMath'),
      footnotes: booleanField(markdownOptions, 'markdownOptions', 'footnotes'),
      subscriptAndSuperscript: booleanField(
        markdownOptions,
        'markdownOptions',
        'subscriptAndSuperscript'
      )
    }),
    liveHtmlSafetyProfile: stringField(
      record,
      'root',
      'liveHtmlSafetyProfile'
    ) as ParseConfiguration['liveHtmlSafetyProfile'],
    executionBudget: Object.freeze({
      limitsProfile: stringField(budget, 'executionBudget', 'limitsProfile'),
      accountingSchema: stringField(budget, 'executionBudget', 'accountingSchema')
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
    'markdownOptions.schema',
    stableConfiguration.markdownOptions.schema,
    MARKDOWN_OPTIONS_SCHEMAS
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

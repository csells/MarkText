import { describe, expect, it } from 'vitest'
import {
  decodeDocumentParseConfiguration,
  documentParseConfigurationFor
} from 'main_renderer/documentCore/documentParseConfiguration'

describe('main-owned document parse configuration', () => {
  it('builds the fixed parser/resource profile from the three grammar settings', () => {
    const configuration = documentParseConfigurationFor({
      footnotes: true,
      gitLabMath: false,
      subscriptAndSuperscript: true
    })

    expect(configuration).toMatchObject({
      criticMarkupProfile: 'marktext-profile-1',
      markdownProfile: 'markdown-profile-1',
      markdownOptions: {
        gfm: true,
        frontMatter: true,
        math: true,
        footnotes: true,
        gitLabMath: false,
        subscriptAndSuperscript: true
      },
      executionBudget: {
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1'
      }
    })
    expect(Object.isFrozen(configuration)).toBe(true)
    expect(Object.isFrozen(configuration.markdownOptions)).toBe(true)
  })

  it('rejects missing, extra, and non-boolean settings', () => {
    expect(() => documentParseConfigurationFor({
      footnotes: false,
      gitLabMath: false
    } as never)).toThrow(/closed/i)
    expect(() => documentParseConfigurationFor({
      footnotes: false,
      gitLabMath: false,
      subscriptAndSuperscript: false,
      parser: 'other'
    } as never)).toThrow(/closed/i)
    expect(() => documentParseConfigurationFor({
      footnotes: 'yes',
      gitLabMath: false,
      subscriptAndSuperscript: false
    } as never)).toThrow(/boolean/i)
  })

  it('strictly decodes a wire configuration and rejects malformed values', () => {
    const configuration = documentParseConfigurationFor({
      footnotes: false,
      gitLabMath: true,
      subscriptAndSuperscript: false
    })
    const decoded = decodeDocumentParseConfiguration(
      JSON.parse(JSON.stringify(configuration))
    )
    expect(decoded).toEqual(configuration)
    expect(Object.isFrozen(decoded)).toBe(true)

    expect(() => decodeDocumentParseConfiguration(null))
      .toThrow(/closed record/i)
    expect(() => decodeDocumentParseConfiguration('marktext-profile-1'))
      .toThrow(/closed record/i)
    expect(() => decodeDocumentParseConfiguration({
      ...configuration,
      criticMarkupProfile: 'other-profile'
    })).toThrow(/criticMarkupProfile/)
    const widened = JSON.parse(JSON.stringify(configuration)) as Record<
      string, unknown
    >
    widened.extra = true
    expect(() => decodeDocumentParseConfiguration(widened)).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { createMainDocumentParseConfiguration } from 'main_renderer/documentCore/documentParseConfiguration'

describe('main-owned document parse configuration', () => {
  it('builds the fixed parser/resource profile from the three grammar settings', () => {
    const configuration = createMainDocumentParseConfiguration({
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
    expect(() => createMainDocumentParseConfiguration({
      footnotes: false,
      gitLabMath: false
    } as never)).toThrow(/closed/i)
    expect(() => createMainDocumentParseConfiguration({
      footnotes: false,
      gitLabMath: false,
      subscriptAndSuperscript: false,
      parser: 'other'
    } as never)).toThrow(/closed/i)
    expect(() => createMainDocumentParseConfiguration({
      footnotes: 'yes',
      gitLabMath: false,
      subscriptAndSuperscript: false
    } as never)).toThrow(/boolean/i)
  })
})

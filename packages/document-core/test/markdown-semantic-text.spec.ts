import { describe, expect, it } from 'vitest'

import {
  decodeMarkdownSemanticText,
  normalizeMarkdownSemanticDestination
} from '../src/internal/profile1/markdownSemanticText.js'

describe('Markdown semantic character references', () => {
  it('decodes strict named and numeric references', () => {
    expect(decodeMarkdownSemanticText(
      '&nbsp; &amp; &copy; &AElig; &Dcaron; &ngE;'
    )).toBe('  & © Æ Ď ≧̸')
    expect(decodeMarkdownSemanticText(
      '&#35; &#1234; &#992; &#0; &#X22; &#XD06; &#xcab;'
    )).toBe('# Ӓ Ϡ � " ആ ಫ')
  })

  it('keeps unknown, unterminated, and overlong references literal', () => {
    expect(decodeMarkdownSemanticText(
      '&copy &MadeUpEntity; &constructor; &toString; &#87654321; &#abcdef0;'
    )).toBe(
      '&copy &MadeUpEntity; &constructor; &toString; &#87654321; &#abcdef0;'
    )
    expect(decodeMarkdownSemanticText('\\&copy;')).toBe('&copy;')
  })

  it('uses CommonMark scalar semantics rather than HTML C1 remapping', () => {
    expect(decodeMarkdownSemanticText('&#128; &#159;'))
      .toBe('\u0080 \u009F')
    expect(decodeMarkdownSemanticText('&#0; &#55296; &#1114112;'))
      .toBe('� � �')
  })

  it('decodes references before normalizing a Markdown destination', () => {
    expect(normalizeMarkdownSemanticDestination('/f&ouml;&ouml;'))
      .toBe('/f%C3%B6%C3%B6')
  })
})

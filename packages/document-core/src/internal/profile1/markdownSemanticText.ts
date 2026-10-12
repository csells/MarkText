import { decodeHTMLStrict } from 'entities'

/** CommonMark's ASCII punctuation, which a backslash escapes, as a character class. */
export const ASCII_PUNCTUATION = '[!-/:-@[-`{-~]'

const ASCII_PUNCTUATION_CHARACTER = new RegExp(`^${ASCII_PUNCTUATION}$`, 'u')

const STRICT_CHARACTER_REFERENCE =
  /&(?:#(?:[xX][0-9A-Fa-f]{1,6}|[0-9]{1,7})|[A-Za-z][A-Za-z0-9]{0,30});/gu

const decodeNumericReference = (body: string): string => {
  const hexadecimal = body[1] === 'x' || body[1] === 'X'
  const codePoint = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
  return codePoint === 0 ||
    codePoint > 0x10FFFF ||
    (codePoint >= 0xD800 && codePoint <= 0xDFFF)
    ? '\uFFFD'
    : String.fromCodePoint(codePoint)
}

type DecodedSpelling = (start: number, end: number, value: string) => void

const decodeStrictCharacterReferences = (source: string, onSpelling?: DecodedSpelling): string => source.replace(
  STRICT_CHARACTER_REFERENCE,
  (reference: string, offset: number) => {
    const body = reference.slice(1, -1)
    const value = body.startsWith('#')
      ? decodeNumericReference(body)
      : decodeHTMLStrict(reference)
    if (value !== reference) onSpelling?.(offset, offset + reference.length, value)
    return value
  }
)

/**
 * Decodes the semantic value of a CommonMark text node while retaining its
 * exact source range separately. Backslash-escaped ampersands are flushed as
 * literal characters before HTML entity decoding, so `\&copy;` cannot become
 * © accidentally.
 */
export function decodeMarkdownSemanticText(source: string, onSpelling?: DecodedSpelling): string {
  if (!source.includes('\\') && !source.includes('&')) return source

  let decoded = ''
  let entityCandidate = ''
  let candidateStart = 0
  const flush = (): void => {
    if (!entityCandidate) return
    decoded += decodeStrictCharacterReferences(entityCandidate, onSpelling === undefined
      ? undefined
      : (start, end, value) => onSpelling(candidateStart + start, candidateStart + end, value))
    entityCandidate = ''
  }

  for (let offset = 0; offset < source.length; offset += 1) {
    const current = source[offset]
    const next = source[offset + 1]
    if (current === '\\' && next !== undefined && ASCII_PUNCTUATION_CHARACTER.test(next)) {
      flush()
      decoded += next
      onSpelling?.(offset, offset + 2, next)
      offset += 1
      continue
    }
    if (!entityCandidate) candidateStart = offset
    entityCandidate += current
  }
  flush()
  return decoded
}

export function decodeGfmTableCodeContent(content: string): string {
  return content.replaceAll('\\|', '|')
}

/**
 * Returns the href/src value represented by a Markdown link destination.
 * CommonMark first resolves backslash escapes and entities, then percent
 * encodes characters that cannot appear literally in a URI while preserving
 * percent escapes already authored by the user.
 */
export function normalizeMarkdownSemanticDestination(source: string): string {
  const decoded = decodeMarkdownSemanticText(source)
  return encodeUriPreservingEscapes(decoded)
}

/** Angle-autolink URI content does not consume Markdown backslash escapes. */
export function normalizeMarkdownAutolinkDestination(source: string): string {
  return encodeUriPreservingEscapes(source)
}

const encodeUriPreservingEscapes = (source: string): string => {
  return encodeURI(source.toWellFormed()).replace(/%25([0-9A-Fa-f]{2})/gu, '%$1')
}

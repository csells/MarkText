import {
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  type ParseExecutionTracker
} from '../../parseExecutionControl.js'

export function hasEvenBackslashRunBefore(source: string, offset: number): boolean {
  let backslashes = 0
  for (let index = offset - 1; index >= 0 && source.charCodeAt(index) === 92; index -= 1) {
    backslashes += 1
  }
  return backslashes % 2 === 0
}

export function isAsciiLetter(codeUnit: number): boolean {
  return (codeUnit >= 65 && codeUnit <= 90) || (codeUnit >= 97 && codeUnit <= 122)
}

function isHtmlTagNameCodeUnit(codeUnit: number): boolean {
  return isAsciiLetter(codeUnit) || (codeUnit >= 48 && codeUnit <= 57) || codeUnit === 45
}

function isHtmlWhitespace(codeUnit: number): boolean {
  return codeUnit === 9 || codeUnit === 10 || codeUnit === 12 || codeUnit === 13 || codeUnit === 32
}

function isHtmlAttributeNameStart(codeUnit: number): boolean {
  return isAsciiLetter(codeUnit) || codeUnit === 95 || codeUnit === 58
}

function isHtmlAttributeNameCodeUnit(codeUnit: number): boolean {
  return (
    isHtmlAttributeNameStart(codeUnit) ||
    (codeUnit >= 48 && codeUnit <= 57) ||
    codeUnit === 46 ||
    codeUnit === 45
  )
}

function boundedTerminatorEnd(
  source: string,
  terminator: string,
  from: number,
  limit: number
): number | undefined {
  const start = source.indexOf(terminator, from)
  const end = start < 0 ? -1 : start + terminator.length
  return end >= 0 && end <= limit ? end : undefined
}

function lineEndingEnd(
  source: string,
  offset: number,
  limit: number
): number | undefined {
  const codeUnit = source.charCodeAt(offset)
  if (codeUnit === 13) {
    return offset + 1 < limit && source.charCodeAt(offset + 1) === 10
      ? offset + 2
      : offset + 1
  }
  return codeUnit === 10 ? offset + 1 : undefined
}

function inlineParagraphLimit(
  source: string,
  start: number,
  limit: number
): number {
  for (let offset = start; offset < limit;) {
    const firstLineEnd = lineEndingEnd(source, offset, limit)
    if (firstLineEnd === undefined) {
      offset += 1
      continue
    }
    let nextContent = firstLineEnd
    while (
      nextContent < limit &&
      (source.charCodeAt(nextContent) === 32 ||
        source.charCodeAt(nextContent) === 9)
    ) {
      nextContent += 1
    }
    if (lineEndingEnd(source, nextContent, limit) !== undefined) {
      return nextContent
    }
    offset = firstLineEnd
  }
  return limit
}

export function findInlineHtmlEnd(
  source: string,
  start: number,
  limit: number = source.length
): number | undefined {
  limit = inlineParagraphLimit(source, start, limit)
  if (source.startsWith('<!--', start)) {
    return boundedTerminatorEnd(source, '-->', start + 4, limit)
  }
  if (source.startsWith('<?', start)) {
    return boundedTerminatorEnd(source, '?>', start + 2, limit)
  }
  if (source.startsWith('<![CDATA[', start)) {
    return boundedTerminatorEnd(source, ']]>', start + 9, limit)
  }
  if (source.startsWith('<!', start) && isAsciiLetter(source.charCodeAt(start + 2))) {
    return boundedTerminatorEnd(source, '>', start + 3, limit)
  }

  let offset = start + 1
  const closingTag = source.charCodeAt(offset) === 47
  if (closingTag) {
    offset += 1
  }
  if (!isAsciiLetter(source.charCodeAt(offset))) {
    return undefined
  }
  offset += 1
  while (offset < limit && isHtmlTagNameCodeUnit(source.charCodeAt(offset))) {
    offset += 1
  }
  if (closingTag) {
    while (offset < limit && isHtmlWhitespace(source.charCodeAt(offset))) {
      offset += 1
    }
    return source.charCodeAt(offset) === 62 && offset < limit ? offset + 1 : undefined
  }

  while (offset < limit) {
    if (source.charCodeAt(offset) === 62) {
      return offset + 1
    }
    if (
      source.charCodeAt(offset) === 47 &&
      offset + 1 < limit &&
      source.charCodeAt(offset + 1) === 62
    ) {
      return offset + 2
    }
    if (!isHtmlWhitespace(source.charCodeAt(offset))) {
      return undefined
    }
    while (offset < limit && isHtmlWhitespace(source.charCodeAt(offset))) {
      offset += 1
    }
    if (source.charCodeAt(offset) === 62 && offset < limit) {
      return offset + 1
    }
    if (
      source.charCodeAt(offset) === 47 &&
      offset + 1 < limit &&
      source.charCodeAt(offset + 1) === 62
    ) {
      return offset + 2
    }
    if (!isHtmlAttributeNameStart(source.charCodeAt(offset))) {
      return undefined
    }
    offset += 1
    while (offset < limit && isHtmlAttributeNameCodeUnit(source.charCodeAt(offset))) {
      offset += 1
    }
    const attributeNameEnd = offset
    while (offset < limit && isHtmlWhitespace(source.charCodeAt(offset))) {
      offset += 1
    }
    if (source.charCodeAt(offset) !== 61) {
      // Leave the separator for the outer loop. It authenticates the next
      // attribute; consuming it here makes a following attribute look as
      // though it began without required whitespace.
      offset = attributeNameEnd
      continue
    }
    offset += 1
    while (offset < limit && isHtmlWhitespace(source.charCodeAt(offset))) {
      offset += 1
    }
    const quote = source.charCodeAt(offset)
    if (quote === 34 || quote === 39) {
      offset += 1
      while (offset < limit && source.charCodeAt(offset) !== quote) {
        offset += 1
      }
      if (source.charCodeAt(offset) !== quote || offset >= limit) {
        return undefined
      }
      offset += 1
      continue
    }
    const valueStart = offset
    while (offset < limit) {
      const codeUnit = source.charCodeAt(offset)
      if (isHtmlWhitespace(codeUnit) || codeUnit === 62) {
        break
      }
      if (
        codeUnit === 34 ||
        codeUnit === 39 ||
        codeUnit === 61 ||
        codeUnit === 60 ||
        codeUnit === 96
      ) {
        return undefined
      }
      offset += 1
    }
    if (offset === valueStart) {
      return undefined
    }
  }
  return undefined
}

const AUTOLINK_URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/
const AUTOLINK_EMAIL =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

function isAutolinkUri(target: string): boolean {
  if (!AUTOLINK_URI_SCHEME.test(target)) {
    return false
  }
  for (let index = 0; index < target.length; index += 1) {
    const codeUnit = target.charCodeAt(index)
    if (codeUnit <= 32 || codeUnit === 60 || codeUnit === 62) {
      return false
    }
  }
  return true
}

export function findAutolinkEnd(
  source: string,
  start: number,
  limit: number = source.length
): number | undefined {
  const close = source.indexOf('>', start + 1)
  if (close < 0 || close >= limit) {
    return undefined
  }
  const target = source.slice(start + 1, close)
  return isAutolinkUri(target) || AUTOLINK_EMAIL.test(target)
    ? close + 1
    : undefined
}

export interface GfmExtendedAutolink {
  readonly end: number
  readonly destination: string
  readonly type: 'www' | 'url' | 'email' | 'protocol-email'
}

function isAsciiAlphaNumeric(codeUnit: number): boolean {
  return (
    (codeUnit >= 48 && codeUnit <= 57) ||
    (codeUnit >= 65 && codeUnit <= 90) ||
    (codeUnit >= 97 && codeUnit <= 122)
  )
}

function isGfmUrlBoundary(
  source: string,
  offset: number,
  floor: number
): boolean {
  if (offset === floor) {
    return true
  }
  const previous = source.charCodeAt(offset - 1)
  return (
    previous === 9 ||
    previous === 10 ||
    previous === 13 ||
    previous === 32 ||
    previous === 40 ||
    previous === 42 ||
    previous === 95 ||
    previous === 126
  )
}

function isGfmDomainCodeUnit(codeUnit: number): boolean {
  return (
    isAsciiAlphaNumeric(codeUnit) ||
    codeUnit === 45 ||
    codeUnit === 46 ||
    codeUnit === 95
  )
}

function gfmDomainEnd(
  source: string,
  start: number,
  limit: number,
  execution?: ParseExecutionTracker
): number | undefined {
  let end = start
  let reportedEnd = start
  while (end < limit && isGfmDomainCodeUnit(source.charCodeAt(end))) {
    end += 1
    if (
      execution !== undefined &&
      end - reportedEnd >= PARSE_SOURCE_CHECKPOINT_INTERVAL
    ) {
      execution.examineParserWork(end - reportedEnd)
      reportedEnd = end
    }
  }
  execution?.examineParserWork(end - reportedEnd)
  while (end > start && source.charCodeAt(end - 1) === 46) {
    end -= 1
  }
  const segments = source.slice(start, end).split('.')
  if (
    segments.length < 2 ||
    segments.some((segment) =>
      segment.length === 0 ||
      Array.from(segment).some((scalar) =>
        !isGfmDomainCodeUnit(scalar.charCodeAt(0)) || scalar === '.'
      )
    ) ||
    segments.slice(-2).some((segment) => segment.includes('_'))
  ) {
    return undefined
  }
  return end
}

const GFM_TRAILING_URL_PUNCTUATION = new Set([
  33, // !
  42, // *
  44, // ,
  46, // .
  58, // :
  63, // ?
  95, // _
  126 // ~
])

function trimGfmAutolinkPath(
  source: string,
  start: number,
  candidateEnd: number,
  execution?: ParseExecutionTracker
): number {
  let end = candidateEnd
  while (
    end > start &&
    GFM_TRAILING_URL_PUNCTUATION.has(source.charCodeAt(end - 1))
  ) {
    end -= 1
  }
  let openingParentheses = 0
  let closingParentheses = 0
  let reportedOffset = start
  for (let offset = start; offset < end; offset += 1) {
    if (source.charCodeAt(offset) === 40) {
      openingParentheses += 1
    } else if (source.charCodeAt(offset) === 41) {
      closingParentheses += 1
    }
    if (
      execution !== undefined &&
      offset + 1 - reportedOffset >= PARSE_SOURCE_CHECKPOINT_INTERVAL
    ) {
      execution.examineParserWork(offset + 1 - reportedOffset)
      reportedOffset = offset + 1
    }
  }
  execution?.examineParserWork(end - reportedOffset)
  while (
    end > start &&
    source.charCodeAt(end - 1) === 41 &&
    closingParentheses > openingParentheses
  ) {
    end -= 1
    closingParentheses -= 1
  }
  if (source.charCodeAt(end - 1) === 59) {
    const entityStart = source.lastIndexOf('&', end - 1)
    if (
      entityStart >= start &&
      /^&(?:#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});$/
        .test(source.slice(entityStart, end))
    ) {
      end = entityStart
    }
  }
  return end
}

function gfmUrlAutolink(
  source: string,
  offset: number,
  end: number,
  floor: number,
  execution?: ParseExecutionTracker
): GfmExtendedAutolink | undefined {
  if (!isGfmUrlBoundary(source, offset, floor)) {
    return undefined
  }
  const www = source.startsWith('www.', offset)
  const schemeLength =
    source.startsWith('https://', offset)
      ? 8
      : source.startsWith('http://', offset)
        ? 7
        : source.startsWith('ftp://', offset)
          ? 6
          : 0
  if (!www && schemeLength === 0) {
    return undefined
  }
  const domainEnd = gfmDomainEnd(
    source,
    offset + schemeLength,
    end,
    execution
  )
  if (domainEnd === undefined) {
    return undefined
  }
  let candidateEnd = domainEnd
  let reportedEnd = candidateEnd
  while (
    candidateEnd < end &&
    source.charCodeAt(candidateEnd) > 32 &&
    source.charCodeAt(candidateEnd) !== 60
  ) {
    candidateEnd += 1
    if (
      execution !== undefined &&
      candidateEnd - reportedEnd >= PARSE_SOURCE_CHECKPOINT_INTERVAL
    ) {
      execution.examineParserWork(candidateEnd - reportedEnd)
      reportedEnd = candidateEnd
    }
  }
  execution?.examineParserWork(candidateEnd - reportedEnd)
  candidateEnd = trimGfmAutolinkPath(
    source,
    offset,
    candidateEnd,
    execution
  )
  if (candidateEnd < domainEnd) {
    return undefined
  }
  const label = source.slice(offset, candidateEnd)
  return Object.freeze({
    end: candidateEnd,
    destination: www ? `http://${label}` : label,
    type: www ? 'www' : 'url'
  })
}

function isGfmEmailLocalCodeUnit(codeUnit: number): boolean {
  return (
    isAsciiAlphaNumeric(codeUnit) ||
    codeUnit === 43 ||
    codeUnit === 45 ||
    codeUnit === 46 ||
    codeUnit === 95
  )
}

function gfmEmailAutolink(
  source: string,
  offset: number,
  end: number,
  execution?: ParseExecutionTracker
): GfmExtendedAutolink | undefined {
  const protocolLength =
    source.startsWith('mailto:', offset)
      ? 7
      : source.startsWith('xmpp:', offset)
        ? 5
        : 0
  const localStart = offset + protocolLength
  if (
    protocolLength === 0 &&
    offset > 0 &&
    isGfmEmailLocalCodeUnit(source.charCodeAt(offset - 1))
  ) {
    return undefined
  }
  let at = localStart
  let reportedAt = localStart
  while (at < end && isGfmEmailLocalCodeUnit(source.charCodeAt(at))) {
    at += 1
    if (
      execution !== undefined &&
      at - reportedAt >= PARSE_SOURCE_CHECKPOINT_INTERVAL
    ) {
      execution.examineParserWork(at - reportedAt)
      reportedAt = at
    }
  }
  execution?.examineParserWork(at - reportedAt)
  if (at === localStart || source.charCodeAt(at) !== 64) {
    return undefined
  }
  const domainStart = at + 1
  const domainEnd = gfmDomainEnd(source, domainStart, end, execution)
  if (domainEnd === undefined) {
    return undefined
  }
  const domain = source.slice(domainStart, domainEnd)
  if (
    domain.endsWith('-') ||
    domain.endsWith('_') ||
    source.charCodeAt(domainEnd) === 45 ||
    source.charCodeAt(domainEnd) === 95
  ) {
    return undefined
  }
  const label = source.slice(offset, domainEnd)
  return Object.freeze({
    end: domainEnd,
    destination: protocolLength === 0 ? `mailto:${label}` : label,
    type: protocolLength === 0 ? 'email' : 'protocol-email'
  })
}

export function findGfmExtendedAutolink(
  source: string,
  offset: number,
  end: number,
  floor: number,
  execution?: ParseExecutionTracker
): GfmExtendedAutolink | undefined {
  return (
    gfmUrlAutolink(source, offset, end, floor, execution) ??
    gfmEmailAutolink(source, offset, end, execution)
  )
}

function skipLinkWhitespace(source: string, offset: number, limit: number): number {
  let next = offset
  while (
    next < limit &&
    (source.charCodeAt(next) === 32 || source.charCodeAt(next) === 9)
  ) {
    next += 1
  }
  if (next < limit && source.charCodeAt(next) === 13) {
    next += next + 1 < limit && source.charCodeAt(next + 1) === 10 ? 2 : 1
  } else if (next < limit && source.charCodeAt(next) === 10) {
    next += 1
  }
  while (
    next < limit &&
    (source.charCodeAt(next) === 32 || source.charCodeAt(next) === 9)
  ) {
    next += 1
  }
  return next
}

export function findInlineLinkDestinationEnd(
  source: string,
  open: number,
  limit: number = source.length
): number | undefined {
  let offset = skipLinkWhitespace(source, open + 1, limit)

  if (source.charCodeAt(offset) === 60) {
    offset += 1
    let closed = false
    while (offset < limit) {
      const codeUnit = source.charCodeAt(offset)
      if (codeUnit === 92 && offset + 1 < limit) {
        offset += 2
        continue
      }
      if (codeUnit === 10 || codeUnit === 13 || codeUnit === 60) {
        return undefined
      }
      if (codeUnit === 62) {
        offset += 1
        closed = true
        break
      }
      offset += 1
    }
    if (!closed) {
      return undefined
    }
  } else {
    const destinationStart = offset
    let depth = 0
    while (offset < limit) {
      const codeUnit = source.charCodeAt(offset)
      if (codeUnit === 92 && offset + 1 < limit) {
        offset += 2
        continue
      }
      if (codeUnit === 40) {
        depth += 1
        if (depth > 32) {
          return undefined
        }
        offset += 1
        continue
      }
      if (codeUnit === 41) {
        if (depth === 0) {
          break
        }
        depth -= 1
        offset += 1
        continue
      }
      if (codeUnit <= 32 || codeUnit === 127) {
        break
      }
      offset += 1
    }
    if (depth !== 0) {
      return undefined
    }
    if (offset === destinationStart && source.charCodeAt(offset) !== 41) {
      return undefined
    }
  }

  if (source.charCodeAt(offset) === 41) {
    return offset + 1
  }

  const titleStart = skipLinkWhitespace(source, offset, limit)
  if (titleStart === offset) {
    return undefined
  }
  if (source.charCodeAt(titleStart) === 41) {
    return titleStart + 1
  }
  const titleOpen = source.charCodeAt(titleStart)
  const titleClose = titleOpen === 40 ? 41 : titleOpen
  if (titleOpen !== 34 && titleOpen !== 39 && titleOpen !== 40) {
    return undefined
  }
  offset = titleStart + 1
  let titleClosed = false
  while (offset < limit) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 92 && offset + 1 < limit) {
      offset += 2
      continue
    }
    if (codeUnit === titleClose) {
      offset += 1
      titleClosed = true
      break
    }
    const lineEnd = lineEndingEnd(source, offset, limit)
    if (lineEnd !== undefined) {
      let nextContent = lineEnd
      while (
        nextContent < limit &&
        (source.charCodeAt(nextContent) === 32 ||
          source.charCodeAt(nextContent) === 9)
      ) {
        nextContent += 1
      }
      if (lineEndingEnd(source, nextContent, limit) !== undefined) {
        return undefined
      }
      offset = lineEnd
      continue
    }
    offset += 1
  }
  if (!titleClosed) {
    return undefined
  }
  offset = skipLinkWhitespace(source, offset, limit)
  return source.charCodeAt(offset) === 41 ? offset + 1 : undefined
}

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
    while (offset < limit && isHtmlWhitespace(source.charCodeAt(offset))) {
      offset += 1
    }
    if (source.charCodeAt(offset) !== 61) {
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

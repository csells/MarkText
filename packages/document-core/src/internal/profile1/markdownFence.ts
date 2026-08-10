export interface MarkdownFenceOpening {
  readonly startOffset: number
  readonly markerCodeUnit: number
  readonly openerLength: number
}

export interface MarkdownFenceDelimiter {
  readonly markerCodeUnit: number
  readonly openerLength: number
}

function isSpaceOrTab(codeUnit: number): boolean {
  return codeUnit === 32 || codeUnit === 9
}

export function findMarkdownFenceOpening(
  lineText: string,
  contentOffset: number,
  indentation: number,
  blank: boolean
): MarkdownFenceOpening | undefined {
  if (blank || indentation > 3) {
    return undefined
  }
  const markerCodeUnit = lineText.charCodeAt(contentOffset)
  if (markerCodeUnit !== 96 && markerCodeUnit !== 126) {
    return undefined
  }
  let runEnd = contentOffset
  while (runEnd < lineText.length && lineText.charCodeAt(runEnd) === markerCodeUnit) {
    runEnd += 1
  }
  const openerLength = runEnd - contentOffset
  if (
    openerLength < 3 ||
    (markerCodeUnit === 96 && lineText.slice(runEnd).includes('`'))
  ) {
    return undefined
  }
  return Object.freeze({
    startOffset: contentOffset,
    markerCodeUnit,
    openerLength
  })
}

export function isMarkdownFenceCloser(
  lineText: string,
  contentOffset: number,
  indentation: number,
  blank: boolean,
  fence: MarkdownFenceDelimiter
): boolean {
  if (
    blank ||
    indentation > 3 ||
    lineText.charCodeAt(contentOffset) !== fence.markerCodeUnit
  ) {
    return false
  }
  let runEnd = contentOffset
  while (
    runEnd < lineText.length &&
    lineText.charCodeAt(runEnd) === fence.markerCodeUnit
  ) {
    runEnd += 1
  }
  if (runEnd - contentOffset < fence.openerLength) {
    return false
  }
  for (let offset = runEnd; offset < lineText.length; offset += 1) {
    if (!isSpaceOrTab(lineText.charCodeAt(offset))) {
      return false
    }
  }
  return true
}

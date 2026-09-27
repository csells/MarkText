export interface MarkdownLiteralRange {
  readonly start: number
  readonly end: number
  readonly kind:
    | 'inline-code'
    | 'fenced-code'
    | 'indented-code'
    | 'html-block'
    | 'inline-html'
    | 'autolink'
    | 'link-destination'
    | 'definition'
    | 'front-matter'
    | 'math'
    | 'diagram'
  readonly construct?: MarkdownInlineConstruct
  /** Delimiters of a math literal other than dollars (pandoc's optional forms). */
  readonly mathForm?: MarkdownMathForm
  readonly blockKind?: 'footnote-definition'
  readonly htmlTermination?: 'blank-line' | 'explicit'
}

export type MarkdownMathForm = 'gfm' | 'single-backslash' | 'double-backslash'

export interface MarkdownInlineConstruct {
  readonly kind: 'link' | 'image'
  readonly start: number
  readonly labelStart: number
  readonly labelEnd: number
}

export interface MarkdownContainerDepthFailure {
  readonly start: number
  readonly end: number
  readonly observed: number
}

/**
 * End of the source a literal owns. A footnote definition's range spans its
 * body so the parser can find its lines, but only its `[^label]:` owns
 * marker-looking text; the body is paragraph text with its own literals.
 */
export function markdownLiteralOwnedEnd(
  source: string,
  literal: MarkdownLiteralRange
): number {
  if (literal.blockKind !== 'footnote-definition') return literal.end
  const opener = source.indexOf('[^', literal.start)
  if (opener === -1 || opener >= literal.end) return literal.end
  for (let offset = opener + 2; offset < literal.end; offset += 1) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 92) {
      offset += 1
    } else if (codeUnit === 93 && source.charCodeAt(offset + 1) === 58) {
      return offset + 2
    }
  }
  return literal.end
}

export function composeMarkdownLiteralRanges(
  candidates: readonly MarkdownLiteralRange[]
): readonly MarkdownLiteralRange[] {
  const ordered = [...candidates].sort(
    (left, right) => left.start - right.start || right.end - left.end
  )
  const ranges: MarkdownLiteralRange[] = []
  let authenticatedEnd = -1
  // A footnote definition owns only its label; its body is paragraph text
  // whose inline literals lie wholly inside the definition's range.
  let footnoteEnd = -1
  for (const candidate of ordered) {
    // Literal providers participate in one lexer. Once an earlier provider
    // owns a source interval, a shape which starts inside that owner is data,
    // not a second construct that may extend ownership beyond it.
    if (candidate.start < authenticatedEnd) {
      continue
    }
    if (candidate.start < footnoteEnd && candidate.end > footnoteEnd) {
      continue
    }
    ranges.push(candidate)
    if (candidate.blockKind === 'footnote-definition') {
      footnoteEnd = candidate.end
    } else {
      authenticatedEnd = candidate.end
    }
  }
  return Object.freeze(ranges)
}

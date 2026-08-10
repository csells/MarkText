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
  readonly blockKind?: 'footnote-definition'
}

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

export function composeMarkdownLiteralRanges(
  candidates: readonly MarkdownLiteralRange[]
): readonly MarkdownLiteralRange[] {
  const ordered = [...candidates].sort(
    (left, right) => left.start - right.start || right.end - left.end
  )
  const ranges: MarkdownLiteralRange[] = []
  let authenticatedEnd = -1
  for (const candidate of ordered) {
    // Literal providers participate in one lexer. Once an earlier provider
    // owns a source interval, a shape which starts inside that owner is data,
    // not a second construct that may extend ownership beyond it.
    if (candidate.start < authenticatedEnd) {
      continue
    }
    ranges.push(candidate)
    authenticatedEnd = candidate.end
  }
  return Object.freeze(ranges)
}

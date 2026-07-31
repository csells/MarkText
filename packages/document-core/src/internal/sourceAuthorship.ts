/**
 * The one place MarkText decides which bytes it writes on a user's behalf.
 *
 * ADR-0015 rules that the engine authors no bytes the user did not type. A
 * projection edit is the exception it names: the user types *text*, so a
 * delimiter their text would otherwise assemble is escaped to encode what they
 * typed. That decision is narrow and auditable, so it lives here and nowhere
 * else — two copies previously disagreed on which closers they accept.
 */

/** A payload span the escape rule must copy through untouched. */
export interface OpaqueRange {
  readonly start: number
  readonly end: number
}

/** Every Profile 1 opener, in the order the escape rule probes them. */
export const CRITIC_OPENERS = Object.freeze([
  '{++',
  '{--',
  '{~~',
  '{==',
  '{>>'
])

/** Every Profile 1 closer a payload can be escaped against. */
export type CriticCloser = '++}' | '--}' | '~~}' | '==}' | '<<}'

export function mergeOpaqueRanges(ranges: readonly OpaqueRange[]): readonly OpaqueRange[] {
  const sorted = [...ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end
  )
  const merged: OpaqueRange[] = []
  for (const range of sorted) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && range.start <= previous.end) {
      merged[merged.length - 1] = Object.freeze({
        start: previous.start,
        end: Math.max(previous.end, range.end)
      })
    } else {
      merged.push(Object.freeze({ start: range.start, end: range.end }))
    }
  }
  return Object.freeze(merged)
}

export function escapeCriticPayload(
  payload: string,
  close: CriticCloser,
  escapeSubstitutionSeparator: boolean,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  const ranges = mergeOpaqueRanges(opaqueRanges)
  const result: string[] = []
  const closePrefix = close.slice(0, -1)
  let opaqueIndex = 0
  let literalStart = 0

  const replace = (
    start: number,
    end: number,
    replacement: string
  ): void => {
    if (literalStart < start) {
      result.push(payload.slice(literalStart, start))
    }
    result.push(replacement)
    literalStart = end
  }

  for (let index = 0; index < payload.length;) {
    while ((ranges[opaqueIndex]?.end ?? Infinity) <= index) {
      opaqueIndex += 1
    }
    const opaque = ranges[opaqueIndex]
    if (opaque !== undefined && opaque.start <= index) {
      index = opaque.end
      continue
    }
    const lookaheadEnd = opaque?.start ?? payload.length

    let targetStart = index
    while (
      targetStart < lookaheadEnd &&
      payload[targetStart] === '\\'
    ) {
      targetStart += 1
    }
    const slashCount = targetStart - index
    const opener = CRITIC_OPENERS.find((candidate) =>
      payload.startsWith(candidate, targetStart)
    )
    const target =
      opener ??
      (
        escapeSubstitutionSeparator &&
        payload.startsWith('~>', targetStart)
          ? '~>'
          : undefined
      )
    if (
      target !== undefined &&
      targetStart + target.length <= lookaheadEnd
    ) {
      const end = targetStart + target.length
      replace(index, end, `${'\\'.repeat(slashCount * 2 + 1)}${target}`)
      index = end
      continue
    }
    if (slashCount > 0) {
      index = targetStart
      continue
    }

    if (
      index + closePrefix.length <= lookaheadEnd &&
      payload.startsWith(closePrefix, index)
    ) {
      let brace = index + closePrefix.length
      while (brace < lookaheadEnd && payload[brace] === '\\') {
        brace += 1
      }
      if (brace < lookaheadEnd && payload[brace] === '}') {
        const literalSlashes = brace - index - closePrefix.length
        const end = brace + 1
        replace(
          index,
          end,
          `${closePrefix}${'\\'.repeat(literalSlashes * 2 + 1)}}`
        )
        index = end
        continue
      }
    }
    index += 1
  }

  if (literalStart < payload.length) {
    result.push(payload.slice(literalStart))
  }
  return result.join('')
}

/**
 * §2 source authorship: every CriticMarkup marker production writes is
 * composed here — spelling, payload escape, and divider in one place. No
 * caller spells a marker or wires the escape rule inline.
 */
export function composeAdditionMarkup(
  content: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return `{++${escapeCriticPayload(
    content,
    '++}',
    false,
    opaqueRanges
  )}++}`
}

export function composeDeletionMarkup(
  content: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return `{--${escapeCriticPayload(
    content,
    '--}',
    false,
    opaqueRanges
  )}--}`
}

export function composeHighlightMarkup(
  content: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return `{==${escapeCriticPayload(
    content,
    '==}',
    false,
    opaqueRanges
  )}==}`
}

export function composeUnaryMarkup(
  kind: 'addition' | 'deletion' | 'highlight',
  content: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return kind === 'addition'
    ? composeAdditionMarkup(content, opaqueRanges)
    : kind === 'deletion'
      ? composeDeletionMarkup(content, opaqueRanges)
      : composeHighlightMarkup(content, opaqueRanges)
}

export function composeSubstitutionMarkup(
  oldContent: string,
  newContent: string,
  oldOpaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): string {
  return `{~~${escapeCriticPayload(
    oldContent,
    '~~}',
    true,
    oldOpaqueRanges
  )}~>${escapeCriticPayload(newContent, '~~}', true)}~~}`
}

export function composeCommentMarkup(comment: string): string {
  return `{>>${comment}<<}`
}

/**
 * The Highlight-anchored Comment pair. Returns the escaped anchor beside the
 * composed text so a caller recording an expectation never re-escapes it.
 */
export function composeCommentPairMarkup(
  anchorContent: string,
  comment: string,
  opaqueRanges: readonly OpaqueRange[] = Object.freeze([])
): Readonly<{ readonly anchor: string; readonly text: string }> {
  const anchor = escapeCriticPayload(
    anchorContent,
    '==}',
    false,
    opaqueRanges
  )
  return Object.freeze({
    anchor,
    text: `{==${anchor}==}${composeCommentMarkup(comment)}`
  })
}

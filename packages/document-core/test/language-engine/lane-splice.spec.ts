import { describe, expect, it } from 'vitest'
import {
  parsePlainMarkdownLane,
  shiftPlainMarkdownLane,
  type PlainMarkdownLaneParse
} from '../../src/internal/profile1/markdownLaneState.js'

/**
 * The splice primitive for slice 2 — sharing the block phase across views.
 *
 * Sharing means parsing a region once and reusing it wherever it appears at a
 * different offset. That needs two things to be true, and this proves both at
 * once by construction:
 *
 *   1. A region parsed standalone yields the same block analysis it would have
 *      yielded in context — the safe-point premise (`specs/research/0002`).
 *      Blocks do not span a safe point, so a prefix ending at one cannot change
 *      how the rest is analysed.
 *   2. Offsets can be rebased. Every offset a lane parse carries — line spans,
 *      content offsets, container spans, list markers, literal ranges — shifts
 *      by the same delta.
 *
 * If either failed, shared block results would be subtly wrong in a way the
 * parse-count and unit metrics could never reveal.
 */

/** Everything offset-bearing in a lane parse, as comparable plain data. */
function offsets(lane: PlainMarkdownLaneParse): unknown {
  return {
    lines: lane.lines.map((line) => ({
      start: line.start,
      contentEnd: line.contentEnd,
      end: line.end,
      blank: line.blank,
      contentOffset: line.contentOffset,
      indentation: line.indentation,
      blockQuoteDepth: line.blockQuoteDepth,
      listDepth: line.listDepth,
      listMarkers: line.listMarkers.map((marker) => ({
        start: marker.start,
        end: marker.end,
        ordered: marker.ordered,
        startNumber: marker.startNumber,
        contentOffset: marker.contentOffset
      })),
      containers: line.containers.map((container) => ({
        kind: container.kind,
        continued: container.continued,
        start: container.start,
        end: container.end
      }))
    })),
    literals: lane.literals.map((literal) => ({
      kind: literal.kind,
      start: literal.start,
      end: literal.end
    }))
  }
}

/** A prefix that ends at a safe point, so the segment parses independently. */
const PREFIX = 'Alpha paragraph.\n\n'

const SEGMENTS: readonly string[] = [
  '# Heading\n\nBody *text*.\n',
  '- one\n- two\n\nAfter the list.\n',
  '> quoted line\n> continued\n\nPlain.\n',
  '```\ncode block\n```\n\nAfter the fence.\n',
  'A [link][ref] and text.\n\n[ref]: /url\n'
]

describe('lane splice', () => {
  it('rebases a standalone segment parse onto its position in context', () => {
    for (const segment of SEGMENTS) {
      const inContext = parsePlainMarkdownLane(PREFIX + segment)
      const standalone = parsePlainMarkdownLane(segment)
      const rebased = shiftPlainMarkdownLane(standalone, PREFIX.length)

      // The prefix contributes its own lines; the rest must match the rebased
      // standalone parse exactly.
      const prefixLines = parsePlainMarkdownLane(PREFIX).lines.filter(
        (line) => line.start < PREFIX.length
      ).length
      const tail = {
        lines: (offsets(inContext) as { lines: unknown[] }).lines.slice(prefixLines),
        literals: (offsets(inContext) as { literals: unknown[] }).literals
      }
      const shifted = offsets(rebased) as { lines: unknown[], literals: unknown[] }
      expect(tail.lines).toEqual(shifted.lines)
      expect(tail.literals).toEqual(shifted.literals)
    }
  })

  it('shifts by zero without changing anything', () => {
    for (const segment of SEGMENTS) {
      const lane = parsePlainMarkdownLane(segment)
      expect(offsets(shiftPlainMarkdownLane(lane, 0))).toEqual(offsets(lane))
    }
  })

  it('composes: shifting twice equals shifting by the sum', () => {
    for (const segment of SEGMENTS) {
      const lane = parsePlainMarkdownLane(segment)
      expect(offsets(shiftPlainMarkdownLane(shiftPlainMarkdownLane(lane, 7), 5)))
        .toEqual(offsets(shiftPlainMarkdownLane(lane, 12)))
    }
  })
})

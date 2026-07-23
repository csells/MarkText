import { describe, expect, it } from 'vitest'
import {
  parsePlainMarkdownLane,
  parsePlainMarkdownLaneReusing,
  __plainMarkdownLaneUnitsV1,
  __resetPlainMarkdownLaneUnitsV1,
  type PlainMarkdownLaneParse
} from '../../src/internal/profile1/markdownLaneState.js'

/**
 * Sharing the block phase across views (ADR-0013 slice 2).
 *
 * Two views of a reviewed document are mostly the same text — they differ only
 * where a marker resolves differently. Re-analysing the whole document for each
 * view re-does the untouched majority. Reuse analyses the shared regions once
 * and re-parses only the divergent middle.
 *
 * Correctness is non-negotiable and cannot be inferred from the unit count: a
 * wrongly reused region would still be cheap, just wrong. So every case asserts
 * the reused result is byte-identical to a full parse, and the saving is
 * measured separately.
 */

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
      listMarkers: line.listMarkers.map((marker) => ({ ...marker })),
      containers: line.containers.map((container) => ({ ...container }))
    })),
    literals: lane.literals.map((literal) => ({
      kind: literal.kind,
      start: literal.start,
      end: literal.end
    }))
  }
}

function unitsOf(run: () => void): number {
  __resetPlainMarkdownLaneUnitsV1()
  run()
  return __plainMarkdownLaneUnitsV1()
}

/** Review prose where exactly one paragraph differs between the two views. */
function views(count: number): { readonly a: string, readonly b: string } {
  const paragraph = (index: number, changed: boolean): string =>
    index === 3
      ? `Paragraph ${index} with an ${changed ? 'inserted ' : ''}clause.`
      : `Paragraph ${index} of ordinary untouched prose.`
  return {
    a: `${Array.from({ length: count }, (_, i) => paragraph(i, true)).join('\n\n')}\n`,
    b: `${Array.from({ length: count }, (_, i) => paragraph(i, false)).join('\n\n')}\n`
  }
}

describe('block-phase reuse across views', () => {
  it('produces exactly what a full parse produces', () => {
    const { a, b } = views(20)
    const laneA = parsePlainMarkdownLane(a)
    const reused = parsePlainMarkdownLaneReusing(b, { source: a, parsed: laneA })
    expect(offsets(reused)).toEqual(offsets(parsePlainMarkdownLane(b)))
  })

  it('parses far less than the document when one paragraph diverges', () => {
    const { a, b } = views(20)
    const laneA = parsePlainMarkdownLane(a)
    const full = unitsOf(() => { parsePlainMarkdownLane(b) })
    const reusing = unitsOf(() => {
      parsePlainMarkdownLaneReusing(b, { source: a, parsed: laneA })
    })
    // The untouched 19 paragraphs are not re-analysed.
    expect(reusing).toBeLessThan(full / 2)
  })

  it('stays correct across varied block shapes', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['# T\n\n- a\n- b\n\nx changed\n\n> q\n', '# T\n\n- a\n- b\n\nx\n\n> q\n'],
      ['p\n\n```\ncode\n```\n\ntail changed\n', 'p\n\n```\ncode\n```\n\ntail\n'],
      ['a [x][r] b\n\nmid changed\n\n[r]: /u\n', 'a [x][r] b\n\nmid\n\n[r]: /u\n'],
      ['only one block changed\n', 'only one block\n'],
      ['same\n\nsame\n', 'same\n\nsame\n']
    ]
    for (const [a, b] of cases) {
      const laneA = parsePlainMarkdownLane(a)
      const reused = parsePlainMarkdownLaneReusing(b, { source: a, parsed: laneA })
      expect(offsets(reused)).toEqual(offsets(parsePlainMarkdownLane(b)))
    }
  })

  it('falls back to a full parse when there is nothing to reuse', () => {
    const reused = parsePlainMarkdownLaneReusing(
      '# Totally different\n',
      { source: 'nothing alike here\n', parsed: parsePlainMarkdownLane('nothing alike here\n') }
    )
    expect(offsets(reused)).toEqual(offsets(parsePlainMarkdownLane('# Totally different\n')))
  })

  it('resolves references through the rebuilt definition index', () => {
    // Definitions are rebuilt from the spliced literals, never inherited, so a
    // reused region resolves references the same way a full parse does.
    const a = 'See [x][r].\n\nmid changed\n\n[r]: /url\n'
    const b = 'See [x][r].\n\nmid\n\n[r]: /url\n'
    const reused = parsePlainMarkdownLaneReusing(b, {
      source: a,
      parsed: parsePlainMarkdownLane(a)
    })
    const full = parsePlainMarkdownLane(b)
    const referenceStart = b.indexOf('[x][r]')
    expect(reused.referenceDefinitions.has('r', referenceStart))
      .toBe(full.referenceDefinitions.has('r', referenceStart))
    expect(reused.referenceDefinitions.has('r', referenceStart)).toBe(true)
  })
})

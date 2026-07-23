import { describe, expect, it } from 'vitest'
import {
  canonicalMarkupDocument,
  createLanguageEngine,
  createSourceSnapshot,
  safePointsOf,
  type CompleteDocumentRevision,
  type ParseConfiguration
} from '@marktext/document-core'

/**
 * Safe points — the shared primitive for forking and for incremental reuse.
 *
 * `specs/research/0002` established that a CriticMarkup fork reconverges at the
 * next position where block-parser state is canonical and empty, and
 * `specs/research/0001` establishes that an incremental parse needs exactly the
 * same thing to choose a restart boundary. Build it once, serve both.
 *
 * It is derived from the parse rather than re-scanned, so it cannot become a
 * second authority disagreeing with the parser about where blocks begin (the
 * failure ADR-0009 forbids): between two top-level blocks the block parser has
 * nothing open, so each top-level block start is a safe point by construction.
 */

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function open(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete document revision')
  }
  return revision
}

function pointsFor(source: string): readonly number[] {
  return safePointsOf(canonicalMarkupDocument(open(source)))
}

describe('safe points', () => {
  it('marks the start of every top-level block', () => {
    // '# Title\n\nBody.\n' — a heading then a paragraph. Between them the block
    // parser has nothing open, so both starts are safe.
    const points = pointsFor('# Title\n\nBody.\n')
    expect(points.length).toBeGreaterThanOrEqual(2)
    expect(points[0]).toBe(0)
    // The paragraph begins after the blank line.
    expect(points).toContain('# Title\n\n'.length)
  })

  it('offers no interior safe point inside an unclosed fence', () => {
    // The degenerate case research 0002 identified: an unclosed fence swallows
    // the rest of the document, so there is no position after it where block
    // state is empty — a fork here genuinely runs to EOF.
    const points = pointsFor('```\n# Not a heading\n\nStill code\n')
    expect(points).toEqual([0])
  })

  it('reconverges after a closed fence', () => {
    // Once the fence closes, the following blank line restores empty block
    // state, so the text after it is safe again.
    const source = '```\ncode\n```\n\nAfter.\n'
    expect(pointsFor(source)).toContain('```\ncode\n```\n\n'.length)
  })

  it('is unaffected by an inline CriticMarkup marker', () => {
    // An inline marker changes no block structure, so it introduces no fork and
    // removes no safe point.
    expect(pointsFor('a{++x++}b\n\nNext.\n'))
      .toEqual(pointsFor('axb\n\nNext.\n'))
  })

  it('is ordered and within the document', () => {
    const source = '# T\n\n- a\n- b\n\n> q\n\npara\n'
    const points = pointsFor(source)
    const document = canonicalMarkupDocument(open(source))
    expect([...points].sort((left, right) => left - right)).toEqual([...points])
    for (const point of points) {
      expect(point).toBeGreaterThanOrEqual(0)
      expect(point).toBeLessThanOrEqual(document.source.length)
    }
  })
})

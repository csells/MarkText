import { describe, expect, it } from 'vitest'
import {
  canonicalMarkupDocument,
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type MarkdownNode,
  type ParseConfiguration
} from '@marktext/document-core'

/**
 * Slice 3 — a marker that changes BLOCK structure.
 *
 * Slice 2 shares regions the views hold in common. Slice 3 asks whether that
 * still holds when the marker does not merely change words but changes the
 * blocks themselves: `{--# --}Title` is a heading in Original and a paragraph in
 * Revised; `a{++\n\n++}b` is one paragraph in Original and two in Revised.
 *
 * The claim under test is ADR-0013's reconvergence property: a block fork cannot
 * leak past the next safe point, so even a structural change costs only its own
 * region and the untouched majority is still analysed once. Correctness first —
 * a cheap wrong tree is worse than an expensive right one.
 */

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

function open(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error(`Expected a complete revision for ${JSON.stringify(source)}`)
  }
  return revision
}

function shape(node: MarkdownNode): string {
  return Array.from(
    { length: node.childCount },
    (_, ordinal) => node.childAt(ordinal).kind
  ).join(',')
}

function unitsFor(source: string): number {
  const engine = createLanguageEngine()
  const revision = engine.open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error(`Expected a complete revision for ${JSON.stringify(source)}`)
  }
  const counts = engine.traversalCounts()
  return counts.intrinsicSourceUnits + counts.plainMarkdownLaneUnits
}

/** Untouched prose surrounding a structural change, to expose any leak. */
function surrounded(change: string, count = 20): string {
  const before = Array.from({ length: count }, (_, i) => `Lead paragraph ${i}.`)
  const after = Array.from({ length: count }, (_, i) => `Trailing paragraph ${i}.`)
  return `${[...before, change, ...after].join('\n\n')}\n`
}

const STRUCTURAL: readonly (readonly [string, string])[] = [
  // Heading marker deleted: heading in Original, paragraph in Revised.
  ['{--# --}Title', 'heading/paragraph'],
  // Addition splits one paragraph into two.
  ['a{++\n\n++}b', 'paragraph split'],
  // List marker deleted: list in Original, paragraph in Revised.
  ['{--- --}item', 'list/paragraph'],
  // Blockquote marker deleted.
  ['{--> --}quoted', 'blockquote/paragraph']
]

describe('block forks', () => {
  it('gives each view the block structure an independent parse would', () => {
    for (const [change] of STRUCTURAL) {
      const revision = open(surrounded(change, 3))
      for (const view of ['original', 'revised', 'editing'] as const) {
        const projected = revision.projection(view)
        const independent = open(projected.source).projection('editing')
        expect(shape(projected.markdown.root))
          .toBe(shape(independent.markdown.root))
      }
    }
  })

  it('really does change block structure between the views', () => {
    // Guards the test itself: if these stopped diverging, the rows above would
    // pass vacuously.
    const revision = open('{--# --}Title\n\nBody.\n')
    expect(shape(revision.projection('original').markdown.root))
      .not.toBe(shape(revision.projection('revised').markdown.root))
  })

  it('does not let a structural fork leak past the next safe point', () => {
    // The reconvergence property, measured: surrounding prose is untouched, so
    // a structural change must not cost a second pass over it.
    for (const [change] of STRUCTURAL) {
      const source = surrounded(change)
      expect(unitsFor(source) / source.length).toBeLessThan(1.3)
    }
  })

  it('keeps the editor a correct block tree across a structural fork', () => {
    for (const [change] of STRUCTURAL) {
      const document = canonicalMarkupDocument(open(surrounded(change, 2)))
      expect(document.root.childCount).toBeGreaterThan(0)
    }
  })
})

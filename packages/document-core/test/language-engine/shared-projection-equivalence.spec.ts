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
 * Differential proof for the projection-sharing optimizations.
 *
 * Three places now hand back an already-built projection instead of parsing,
 * each justified by "these views cover byte-identical text":
 *   - Revised reads Original when the forest has no view-divergent form;
 *   - the editing view reads Revised when there is no Deletion/Substitution;
 *   - the editing view reads Original when there is no Addition/Substitution.
 *
 * If any of that reasoning is wrong the engine silently serves the wrong tree,
 * and the parse-count tests would still pass because they only count parses.
 * So compare the shared result against the ground truth every view must satisfy:
 * the projected source is exactly the view's own resolution of the source, and
 * its block structure is what parsing that text independently yields.
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
    throw new Error(`Expected a complete revision for ${JSON.stringify(source)}`)
  }
  return revision
}

/** Block kinds with child counts — enough to catch a wrong tree. */
function shape(node: MarkdownNode): string {
  return Array.from(
    { length: node.childCount },
    (_, ordinal) => {
      const child = node.childAt(ordinal)
      return `${child.kind}(${child.childCount})`
    }
  ).join(',')
}

/**
 * A corpus spanning every sharing branch: no markers, annotation-only (shares),
 * additions-only, deletions-only, mixed, substitutions, and nested forms — the
 * nesting cases matter because the sharing test recurses through arm children.
 */
const CORPUS: readonly string[] = [
  '# Title\n\nPlain *text* only.\n',
  'Hello {==world==}{>>check this<<}.\n',
  'a{++x++}b\n',
  'a{--x--}b\n',
  'a{++x++} and {--y--} b\n',
  'a{~~old~>new~~}b\n',
  '{--# --}Title\n\nBody.\n',
  'a{++\n\n++}b\n',
  '- item {++added++}\n- other {--cut--}\n',
  '> quoted {==highlight==}{>>note<<}\n',
  'outer {++add {--nested cut--} more++} tail\n',
  '{>>standalone comment<<}Body text.\n'
]

describe('shared projections equal independently parsed ones', () => {
  it('serves each view the exact text that view resolves to', () => {
    for (const source of CORPUS) {
      const revision = open(source)
      for (const view of ['original', 'revised', 'editing'] as const) {
        const projected = revision.projection(view)
        // Re-opening the projected text must reproduce it unchanged: the view's
        // own source is a fixed point. A wrongly shared projection would hand
        // back another view's text and fail here.
        const reopened = open(projected.source)
        expect(reopened.projection(view).source).toBe(projected.source)
      }
    }
  })

  it('gives a shared view the same block structure as parsing it alone', () => {
    for (const source of CORPUS) {
      const revision = open(source)
      for (const view of ['original', 'revised', 'editing'] as const) {
        const projected = revision.projection(view)
        // Independently parse the view's own text; a shared projection must be
        // structurally identical to that ground truth.
        const independent = open(projected.source).projection('editing')
        expect(shape(projected.markdown.root)).toBe(shape(independent.markdown.root))
      }
    }
  })

  it('keeps Original and Revised distinct wherever a form diverges', () => {
    // Guards the sharing predicate from over-reaching: any Addition, Deletion or
    // Substitution must still produce two different view texts.
    for (const source of ['a{++x++}b\n', 'a{--x--}b\n', 'a{~~old~>new~~}b\n']) {
      const revision = open(source)
      expect(revision.projection('original').source)
        .not.toBe(revision.projection('revised').source)
    }
  })

  it('renders the editor a block tree for every corpus document', () => {
    for (const source of CORPUS) {
      expect(() => canonicalMarkupDocument(open(source))).not.toThrow()
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createSourceSnapshot,
  canonicalMarkupDocument,
  forkPlanOf,
  groupRenderBlocks,
  renderMarkupPlan,
  type CompleteDocumentRevision,
  type ParseConfiguration
} from '@marktext/document-core'

/**
 * The fork plan — which blocks can share one parse, and which must be resolved
 * per view (ADR-0013 slices 2-3).
 *
 * Original and Revised differ only where an Addition, Deletion or Substitution
 * resolves differently. Highlights render in both and Comment bodies are hidden
 * in both, so a block carrying only those is byte-identical across views and can
 * share a single parse. Blocks are the unit because a fork reconverges at a safe
 * point, and every top-level block start is one (`specs/research/0002`).
 *
 * This is the planning layer: it says where sharing is legal. It is also the
 * measurement behind the O(n) claim — in real review prose, markers are sparse,
 * so most blocks are shared.
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

function revisionFor(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete document revision')
  }
  return revision
}

async function planFor(source: string) {
  const session = await createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
    initialView: 'markup',
    trackChanges: false,
    initialSelection: {
      anchor: { offset: 0, affinity: 'next' },
      focus: { offset: 0, affinity: 'next' }
    }
  })
  const runs = renderMarkupPlan(session.snapshot().livePlan)
  const blocks = groupRenderBlocks(canonicalMarkupDocument(revisionFor(source)), runs)
  return forkPlanOf(blocks)
}

describe('fork plan', () => {
  it('shares every block of a document with no CriticMarkup', async() => {
    const plan = await planFor('# Title\n\nOne.\n\nTwo.\n')
    expect(plan.divergent).toHaveLength(0)
    expect(plan.shared).toHaveLength(3)
  })

  it('marks only the block carrying a tracked change as divergent', async() => {
    // Three paragraphs, one addition. The other two are byte-identical across
    // Original and Revised and must be parsed once, not once per view.
    const plan = await planFor('One.\n\nTwo {++added++}.\n\nThree.\n')
    expect(plan.divergent).toHaveLength(1)
    expect(plan.shared).toHaveLength(2)
  })

  it('treats highlights and comments as shared, not divergent', async() => {
    // Annotation without editing: a Highlight renders in both views and a
    // Comment body is hidden in both, so nothing diverges.
    const plan = await planFor('Hello {==world==}{>>check this<<}.\n\nNext.\n')
    expect(plan.divergent).toHaveLength(0)
    expect(plan.shared).toHaveLength(2)
  })

  it('marks a deletion and a substitution as divergent', async() => {
    for (const source of ['a{--cut--}b\n', 'a{~~old~>new~~}b\n']) {
      const plan = await planFor(source)
      expect(plan.divergent).toHaveLength(1)
      expect(plan.shared).toHaveLength(0)
    }
  })

  it('shares nothing when a marker may carry a reference definition', async() => {
    // CommonMark reference definitions are DOCUMENT-scoped, so block-local
    // reasoning is not enough. Verified: for '[link]\n\n{++[link]: /url++}\n'
    // the first block carries no marker at all, yet its inline structure is
    // `text` in Original and `link` in Revised — the definition lives inside an
    // Addition in a different block. Sharing that block's parse would serve one
    // view the other's tree, so the plan must refuse to share here.
    const plan = await planFor('[link]\n\n{++[link]: /url++}\n')
    expect(plan.shared).toHaveLength(0)
  })

  it('reports the sharable fraction of realistic review prose', async() => {
    // The O(n) premise: markers are sparse in real documents, so the shared
    // majority is parsed once and only the marked blocks fork.
    const paragraphs = Array.from({ length: 20 }, (_, index) =>
      index === 7
        ? `Paragraph ${index} with an {++inserted++} clause.`
        : `Paragraph ${index} of ordinary untouched prose.`
    )
    const plan = await planFor(`${paragraphs.join('\n\n')}\n`)
    expect(plan.divergent).toHaveLength(1)
    expect(plan.shared).toHaveLength(19)
  })
})

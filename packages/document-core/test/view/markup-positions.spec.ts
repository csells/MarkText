import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createSourceSnapshot,
  canonicalMarkupDocument,
  groupRenderBlocks,
  modelOffsetAt,
  renderMarkupPlan,
  viewPositionAt,
  type CompleteDocumentRevision,
  type MarkupRenderBlock,
  type ParseConfiguration
} from '@marktext/document-core'
import { completeSnapshot } from '../helpers/completeSnapshot.js'

/**
 * Integration vertical slice, increment 3 — the view↔model coordinate bridge.
 *
 * A WYSIWYG view reports where the user clicked or typed in VIEW terms ("block
 * 1, run 1, two code units in"). Every editor intent needs MODEL offsets. This
 * is that translation, driven by the engine-emitted mapping the render tree
 * already carries — the view never computes offsets from DOM text lengths.
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

async function viewOf(source: string): Promise<{
  readonly blocks: readonly MarkupRenderBlock[]
  readonly modelText: string
}> {
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
  const runs = renderMarkupPlan(completeSnapshot(session).livePlan)
  return {
    blocks: groupRenderBlocks(canonicalMarkupDocument(revisionFor(source)), runs),
    modelText: runs.map((run) => run.text).join('')
  }
}

const SOURCE = '# Title\n\nHello {++world++}.\n'

describe('markup view↔model positions', () => {
  it('translates a view position inside a CriticMarkup run to a model offset', async() => {
    const { blocks, modelText } = await viewOf(SOURCE)
    // Block 1 is the paragraph; run 1 is the inserted 'world'; 2 code units in
    // lands on its third character.
    const offset = modelOffsetAt(blocks, { blockIndex: 1, runIndex: 1, offset: 2 })
    expect(modelText.slice(offset, offset + 1)).toBe('r')
  })

  it('round-trips every position in the document', async() => {
    const { blocks } = await viewOf(SOURCE)
    for (const [blockIndex, block] of blocks.entries()) {
      for (const [runIndex, run] of block.runs.entries()) {
        for (let offset = 0; offset <= run.text.length; offset += 1) {
          const position = { blockIndex, runIndex, offset }
          const model = modelOffsetAt(blocks, position)
          // The reverse mapping lands on the same model offset. (It may
          // normalize to a neighbouring run at a shared boundary, so compare
          // offsets rather than the position tuple.)
          expect(modelOffsetAt(blocks, viewPositionAt(blocks, model))).toBe(model)
        }
      }
    }
  })

  it('lets affinity choose the side of a CriticMarkup boundary', async() => {
    const { blocks } = await viewOf(SOURCE)
    // The offset where the addition begins is two positions: the end of the
    // preceding plain text and the start of the inserted run. Which one the
    // caret takes decides whether typing there extends the addition.
    const boundary = modelOffsetAt(blocks, { blockIndex: 1, runIndex: 1, offset: 0 })
    const elementsAt = (affinity: 'previous' | 'next'): readonly string[] => {
      const position = viewPositionAt(blocks, boundary, affinity)
      return blocks[position.blockIndex]?.runs[position.runIndex]?.elements ?? []
    }
    expect(elementsAt('next')).toEqual(['ins'])
    expect(elementsAt('previous')).toEqual([])
    // Either way it denotes the same model offset.
    for (const affinity of ['previous', 'next'] as const) {
      expect(modelOffsetAt(blocks, viewPositionAt(blocks, boundary, affinity)))
        .toBe(boundary)
    }
  })

  it('maps a model offset back to the block and run that render it', async() => {
    const { blocks } = await viewOf(SOURCE)
    const inserted = modelOffsetAt(blocks, { blockIndex: 1, runIndex: 1, offset: 0 })
    const position = viewPositionAt(blocks, inserted)
    expect(position.blockIndex).toBe(1)
    const block = blocks[position.blockIndex]
    const run = block?.runs[position.runIndex]
    // Landing inside the addition must report the <ins> run, so the view knows
    // the caret sits in inserted text.
    expect(run?.elements).toEqual(['ins'])
  })
})

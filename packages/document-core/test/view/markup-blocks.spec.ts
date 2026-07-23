import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createSourceSnapshot,
  canonicalMarkupDocument,
  groupRenderBlocks,
  renderMarkupPlan,
  type CompleteDocumentRevision,
  type ParseConfiguration
} from '@marktext/document-core'

/**
 * Integration vertical slice, increment 2c — block-structured render tree.
 *
 * A WYSIWYG view mounts BLOCKS (headings, paragraphs, lists) each containing its
 * inline content. The engine owns both halves: the editing view's block AST
 * (`canonicalMarkupDocument`) and the CriticMarkup-marked inline runs
 * (`renderMarkupPlan`). This joins them so the view never computes block
 * structure itself — it mounts what the engine emitted (ADR-0009/0013).
 *
 * The join is by range: the editing projection's source is the session's model
 * text, so block ranges and run model ranges share one coordinate space.
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

async function blocksFor(source: string) {
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
  return groupRenderBlocks(canonicalMarkupDocument(revisionFor(source)), runs)
}

describe('block-structured markup render tree', () => {
  it('nests inline runs under the engine-emitted block nodes', async() => {
    const blocks = await blocksFor('# Title\n\nHello {++world++}.\n')
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph'])
    // Each block carries exactly the runs whose text falls inside it.
    expect(blocks.map((block) => block.runs.map((run) => run.text).join('')))
      .toEqual(['# Title', 'Hello world.'])
  })

  it('keeps CriticMarkup marks on the runs inside their block', async() => {
    const blocks = await blocksFor('# Title\n\nHello {++world++}.\n')
    const paragraph = blocks[1]
    if (paragraph === undefined) {
      throw new Error('Expected a paragraph block')
    }
    // The addition is still an <ins> run, now located inside its paragraph.
    expect(paragraph.runs.map((run) => ({ text: run.text, elements: run.elements })))
      .toEqual([
        { text: 'Hello ', elements: [] },
        { text: 'world', elements: ['ins'] },
        { text: '.', elements: [] }
      ])
  })

  it('splits a block-spanning addition across the blocks it creates', async() => {
    // 'a{++\n\n++}b' is one paragraph in Original and two in the editing view;
    // the view must mount two blocks, each with its own run.
    const blocks = await blocksFor('a{++\n\n++}b')
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph'])
    expect(blocks.map((block) => block.runs.map((run) => run.text).join('')))
      .toEqual(['a', 'b'])
  })
})

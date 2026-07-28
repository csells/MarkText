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
import { completeSnapshot } from '../helpers/completeSnapshot.js'

/**
 * Integration vertical slice, increment 2c — block-structured render tree.
 *
 * A WYSIWYG view mounts BLOCKS (headings, paragraphs, lists) each containing its
 * complete semantic subtrees. The engine owns both halves: the editing view's block AST
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
  const runs = renderMarkupPlan(completeSnapshot(session).livePlan)
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

  it('publishes a portable hierarchical semantic tree, not a flat source line', async() => {
    const blocks = await blocksFor(
      '# *em* and [link](https://example.test)\n\n' +
      '- outer\n  - inner\n'
    )
    const heading = blocks[0]?.tree
    const list = blocks[1]?.tree
    expect(heading).toMatchObject({
      kind: 'heading',
      attributes: { level: 1 },
      children: [
        { kind: 'emphasis', children: [{ kind: 'text' }] },
        { kind: 'text' },
        {
          kind: 'link',
          attributes: { href: 'https://example.test' },
          children: [{ kind: 'text' }]
        }
      ]
    })
    expect(list).toMatchObject({
      kind: 'list',
      children: [{
        kind: 'list-item',
        children: [
          { kind: 'paragraph' },
          { kind: 'list', children: [{ kind: 'list-item' }] }
        ]
      }]
    })
    expect(JSON.parse(JSON.stringify(blocks))).toEqual(blocks)
    expect(JSON.stringify(blocks)).not.toContain('childAt')
  })

  it('gives repeated zero-width syntax occurrences unique render identities', async() => {
    const blocks = await blocksFor([
      '| a | b | c |',
      '| --- | --- | --- |',
      '| one |   |   |',
      ''
    ].join('\n'))
    const keys: string[] = []
    const pending = blocks.map(block => block.tree)
    while (pending.length > 0) {
      const node = pending.pop()
      if (node === undefined) continue
      keys.push(node.key)
      pending.push(...node.children)
    }

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('carries exact model and canonical-source boundaries through decoded text', async() => {
    const blocks = await blocksFor(String.raw`A \* &amp; B` + '\n')
    const paragraph = blocks[0]?.tree
    if (paragraph === undefined) {
      throw new Error('Expected one paragraph render tree')
    }
    const carriers = paragraph.children.flatMap((node) => node.text)
    const escaped = carriers.find((run) => run.text === '*')
    const entity = carriers.find((run) => run.text === '&')
    expect(escaped).toMatchObject({
      boundaryMapping: 'collapsed',
      modelRange: { start: 2, end: 4 },
      sourceRange: { start: 2, end: 4 }
    })
    expect(entity).toMatchObject({
      boundaryMapping: 'collapsed',
      modelRange: { start: 5, end: 10 },
      sourceRange: { start: 5, end: 10 }
    })
  })

  it('serializes identity text without a source-unit offset vector', async() => {
    const source = 'x'.repeat(100_000)
    const blocks = await blocksFor(source)
    const encoded = JSON.stringify(blocks)

    expect(encoded).not.toContain('modelOffsets')
    expect(encoded).not.toContain('sourceOffsets')
    expect(encoded.length).toBeLessThan(source.length * 3)
  })
})

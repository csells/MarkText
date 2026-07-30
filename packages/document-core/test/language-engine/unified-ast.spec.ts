import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import { runsOf } from '../helpers/collections.js'

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

describe('unified Profile 1 AST', () => {
  it('derives CM indexes and markup reads from the intrinsic node identity', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('before {++new++} after\n'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete revision')
    }

    const addition = revision.criticMarkup.rootAt(0)
    const additionId = Reflect.get(addition, 'nodeId')
    const markerOwner = revision.ownership.ownerAt(addition.range.start).owner
    const markedRun = runsOf(revision.markup).find((run) => run.text === 'new')

    expect(typeof additionId).toBe('string')
    expect(additionId).not.toBe('')
    expect(markerOwner.kind).toBe('critic-marker')
    expect(Reflect.get(markerOwner, 'nodeId')).toBe(additionId)
    expect(markedRun).toBeDefined()
    expect(Reflect.get(markedRun?.marks[0] ?? {}, 'nodeId')).toBe(additionId)
  })

  it('exposes Markdown and CriticMarkup kinds in one parser-created graph', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('before {++new++} after\n'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete revision')
    }

    const syntax = Reflect.get(revision, 'syntax') as
      | Readonly<{
        readonly nodeCount: number
        readonly nodeAt: (
          ordinal: number
        ) => Readonly<{ readonly kind: string }>
      }>
      | undefined
    expect(syntax).toBeDefined()
    const kinds = Array.from(
      { length: syntax?.nodeCount ?? 0 },
      (_, ordinal) => syntax?.nodeAt(ordinal).kind
    )
    expect(kinds).toContain('paragraph')
    expect(kinds).toContain('addition')
  })

  it('reads an admitted Comment subtree without another Markdown parse', () => {
    const engine = createLanguageEngine()
    const revision = engine.open(
      createSourceSnapshot('before {>>**note** {++new++}<<} after\n'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete revision')
    }
    const afterOpen = engine.traversalCounts().total
    const comment = revision.criticMarkup.rootAt(0)
    const displayReader = Reflect.get(revision, 'commentDisplay')
    expect(typeof displayReader).toBe('function')
    const display = Reflect.apply(displayReader, revision, [comment.nodeId]) as
      | Readonly<{
        readonly source: string
        readonly markdown: Readonly<{
          readonly root: Readonly<{
            readonly childCount: number
            readonly childAt: (ordinal: number) => Readonly<{
              readonly kind: string
              readonly nodeId: string
            }>
          }>
        }>
      }>
      | undefined

    expect(display?.source).toBe('**note** new')
    expect(display?.markdown.root.childAt(0).kind).toBe('paragraph')
    expect(display?.markdown.root.childAt(0).nodeId).not.toBe('')
    expect(engine.traversalCounts().total).toBe(afterOpen)
  })

  it('emits reference edges while Markdown nodes are constructed', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(
        'See {~~[old][r]~>[new][r]~~}.\n\n[r]: /destination\n'
      ),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete revision')
    }
    const nodes = new Map(
      Array.from(
        { length: revision.syntax.nodeCount },
        (_, ordinal) => revision.syntax.nodeAt(ordinal)
      ).map((node) => [node.nodeId, node] as const)
    )
    const referenceEdges = Array.from(
      { length: revision.syntax.edgeCount },
      (_, ordinal) => revision.syntax.edgeAt(ordinal)
    ).filter((edge) => edge.kind === 'reference')

    expect(referenceEdges.length).toBeGreaterThanOrEqual(2)
    for (const edge of referenceEdges) {
      expect(['link', 'image']).toContain(nodes.get(edge.from)?.kind)
      expect(nodes.get(edge.to)?.kind).toBe('definition')
    }
  })
})

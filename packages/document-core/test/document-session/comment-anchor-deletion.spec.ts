import { describe, expect, it } from 'vitest'
import { createLanguageEngine } from '../../src/languageEngine.js'
import type {
  CompleteDocumentRevision,
  CriticMarkupNode,
  ParseConfiguration,
  SourceOffset,
  SourceRange
} from '../../src/revision.js'
import { createSourceSnapshot } from '../../src/sourceSnapshot.js'
import {
  createTransformationKernel,
  type CommittedTransformation,
  type TransformationResult
} from '../../src/transformationKernel.js'

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
    throw new Error('Expected a complete test revision')
  }
  return revision
}

function sourceRange(start: number, end: number): SourceRange {
  return {
    start: start as SourceOffset,
    end: end as SourceOffset
  }
}

function nodesOf(revision: CompleteDocumentRevision): readonly CriticMarkupNode[] {
  const nodes: CriticMarkupNode[] = []
  const visit = (node: CriticMarkupNode): void => {
    nodes.push(node)
    for (const arm of node.arms) {
      for (const child of arm.children) {
        visit(child)
      }
    }
  }
  for (let index = 0; index < revision.criticMarkup.rootCount; index += 1) {
    visit(revision.criticMarkup.rootAt(index))
  }
  return nodes
}

function nodeOf(
  revision: CompleteDocumentRevision,
  kind: CriticMarkupNode['kind'],
  ordinal = 0
): CriticMarkupNode {
  const node = nodesOf(revision)
    .filter((candidate) => candidate.kind === kind)[ordinal]
  if (node === undefined) {
    throw new Error(`Missing ${kind} node ${String(ordinal)}`)
  }
  return node
}

function sourceOfNode(
  revision: CompleteDocumentRevision,
  node: CriticMarkupNode
): string {
  return revision.source.text.slice(
    Number(node.range.start),
    Number(node.range.end)
  )
}

function committed(result: TransformationResult): CommittedTransformation {
  expect(result.kind).toBe('committed')
  if (result.kind !== 'committed') {
    throw new Error(`Unexpected rejection: ${result.reason}`)
  }
  return result
}

describe('TransformationKernel Comment edits', () => {
  it('preserves residual nodes and rejects hidden Comment loss', () => {
    const kernel = createTransformationKernel()

    const paired = open(
      'A {==before {++residual++} {>>inner<<} after==}{>>note<<} Z'
    )
    const pairedComment = nodeOf(paired, 'comment', 1)
    const removedPair = committed(kernel.apply(paired, {
      kind: 'remove-comment',
      target: pairedComment.nodeId
    }))
    expect(removedPair.edits).toEqual([
      {
        start: 2,
        end: 57,
        insert: 'before {++residual++} {>>inner<<} after'
      }
    ])
    expect(removedPair.revision.source.text)
      .toBe('A before {++residual++} {>>inner<<} after Z')
    expect(nodeOf(removedPair.revision, 'addition').range).toEqual({
      start: 9,
      end: 23
    })
    expect(sourceOfNode(removedPair.revision, nodeOf(
      removedPair.revision,
      'comment'
    ))).toBe('{>>inner<<}')

    const destructive = [
      {
        source: '{--visible {>>hidden<<} tail--}',
        kind: 'deletion' as const,
        decision: 'accept' as const
      },
      {
        source: '{++visible {>>hidden<<} tail++}',
        kind: 'addition' as const,
        decision: 'reject' as const
      },
      {
        source: '{~~old {>>hidden<<}~>new~~}',
        kind: 'substitution' as const,
        decision: 'accept' as const
      }
    ]
    for (const row of destructive) {
      const before = open(row.source)
      const result = kernel.apply(before, {
        kind: 'resolve-change',
        target: nodeOf(before, row.kind).nodeId,
        decision: row.decision
      })
      expect(result).toMatchObject({
        kind: 'rejected',
        reason: 'hidden-comment-loss',
        revision: before
      })
      expect(result.revision).toBe(before)
      expect(before.source.text).toBe(row.source)
    }

    const nestedComment = open('{>>outer {>>hidden<<} tail<<}')
    const nestedRemoval = kernel.apply(nestedComment, {
      kind: 'remove-comment',
      target: nodeOf(nestedComment, 'comment').nodeId
    })
    expect(nestedRemoval).toMatchObject({
      kind: 'rejected',
      reason: 'hidden-comment-loss',
      revision: nestedComment
    })
    const nestedEdit = kernel.apply(nestedComment, {
      kind: 'edit-comment',
      target: nodeOf(nestedComment, 'comment').nodeId,
      comment: 'outer tail'
    })
    expect(nestedEdit).toMatchObject({
      kind: 'rejected',
      reason: 'hidden-comment-loss',
      revision: nestedComment
    })

    const bulkBefore = open('{++keep++}{--lose {>>hidden<<}--}')
    const bulkRejected = kernel.apply(bulkBefore, {
      kind: 'resolve-all-changes',
      decision: 'accept'
    })
    expect(bulkRejected).toMatchObject({
      kind: 'rejected',
      reason: 'hidden-comment-loss',
      revision: bulkBefore
    })
  })

  it('adds exactly one raw Highlight Comment pair and rejects invalid drafts atomically', () => {
    const kernel = createTransformationKernel()
    const before = open('A raw {++nested++} selection Z')
    const start = before.source.text.indexOf('raw')
    const end = before.source.text.indexOf(' Z')
    const rawNote = 'outer {++proposal++} {>>inner<<} tail'
    const result = committed(kernel.apply(before, {
      kind: 'add-comment',
      range: sourceRange(start, end),
      comment: rawNote
    }))

    const selected = before.source.text.slice(start, end)
    const exact = `{==${selected}==}{>>${rawNote}<<}`
    expect(result.edits).toEqual([{ start, end, insert: exact }])
    expect(result.revision.source.text).toBe(`A ${exact} Z`)
    expect(nodesOf(result.revision).map((node) => node.kind)).toEqual([
      'highlight',
      'addition',
      'comment',
      'addition',
      'comment'
    ])

    const invalid = [
      {
        range: sourceRange(start, start),
        comment: 'note',
        reason: 'empty-comment-anchor'
      },
      {
        range: sourceRange(start, end),
        comment: '   ',
        reason: 'empty-comment'
      },
      {
        range: sourceRange(start, end),
        comment: 'premature <<} tail',
        reason: 'invalid-comment-payload'
      }
    ] as const
    for (const row of invalid) {
      const rejected = kernel.apply(before, {
        kind: 'add-comment',
        range: row.range,
        comment: row.comment
      })
      expect(rejected).toMatchObject({
        kind: 'rejected',
        reason: row.reason,
        revision: before
      })
      expect(rejected.revision).toBe(before)
    }
  })

  it('edits only the Comment arm, preserves raw nested syntax, and rejects invalid payloads', () => {
    const kernel = createTransformationKernel()
    const before = open('A {==anchor==}{>>old note<<} Z')
    const target = nodeOf(before, 'comment')
    const rawNote = 'new {++proposal++} {>>inner<<}'
    const result = committed(kernel.apply(before, {
      kind: 'edit-comment',
      target: target.nodeId,
      comment: rawNote
    }))

    expect(result.edits).toEqual([
      {
        start: Number(target.arms[0].range.start),
        end: Number(target.arms[0].range.end),
        insert: rawNote
      }
    ])
    expect(result.revision.source.text)
      .toBe(`A {==anchor==}{>>${rawNote}<<} Z`)
    expect(nodesOf(result.revision).map((node) => node.kind)).toEqual([
      'highlight',
      'comment',
      'addition',
      'comment'
    ])

    for (const [comment, reason] of [
      ['', 'empty-comment'],
      ['bad <<} tail', 'invalid-comment-payload']
    ] as const) {
      const rejected = kernel.apply(before, {
        kind: 'edit-comment',
        target: target.nodeId,
        comment
      })
      expect(rejected).toMatchObject({
        kind: 'rejected',
        reason,
        revision: before
      })
      expect(rejected.revision).toBe(before)
    }
  })

  it('removes a point Comment locally and leaves neighboring review syntax byte-exact', () => {
    const kernel = createTransformationKernel()
    const before = open('{++left++} {>>point<<} {--right--}')
    const target = nodeOf(before, 'comment')
    const result = committed(kernel.apply(before, {
      kind: 'remove-comment',
      target: target.nodeId
    }))

    expect(result.edits).toEqual([
      {
        start: Number(target.range.start),
        end: Number(target.range.end),
        insert: ''
      }
    ])
    expect(result.revision.source.text).toBe('{++left++}  {--right--}')
    expect(nodesOf(result.revision).map((node) => node.kind))
      .toEqual(['addition', 'deletion'])

    const noRevisedContribution = open('{=={--gone--}==}{>>point<<}')
    const point = nodeOf(noRevisedContribution, 'comment')
    const removedPoint = committed(kernel.apply(noRevisedContribution, {
      kind: 'remove-comment',
      target: point.nodeId
    }))
    expect(removedPoint.edits).toEqual([
      {
        start: Number(point.range.start),
        end: Number(point.range.end),
        insert: ''
      }
    ])
    expect(removedPoint.revision.source.text).toBe('{=={--gone--}==}')
  })

  it('rejects an Add Comment range that cuts through an existing syntax node', () => {
    const kernel = createTransformationKernel()
    const before = open('A {++nested++} Z')
    const nested = nodeOf(before, 'addition')
    const rejected = kernel.apply(before, {
      kind: 'add-comment',
      range: sourceRange(
        Number(nested.range.start) + 1,
        Number(nested.range.end) + 1
      ),
      comment: 'note'
    })

    expect(rejected).toMatchObject({
      kind: 'rejected',
      reason: 'selection-partially-intersects-critic-markup',
      revision: before
    })

    const literal = open('`code`')
    const committedLiteral = kernel.apply(literal, {
      kind: 'add-comment',
      range: sourceRange(1, 5),
      comment: 'note'
    })
    expect(committedLiteral).toMatchObject({
      kind: 'committed',
      revision: {
        source: {
          text: '{==`code`==}{>>note<<}'
        }
      }
    })
  })
})

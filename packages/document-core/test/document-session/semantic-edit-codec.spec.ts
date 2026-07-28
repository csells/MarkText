import { describe, expect, it } from 'vitest'
import { createLanguageEngine } from '../../src/languageEngine.js'
import type {
  CompleteDocumentRevision,
  CriticMarkupNode,
  NodeId,
  ParseConfiguration
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
  const nodes = nodesOf(revision).filter((node) => node.kind === kind)
  const node = nodes[ordinal]
  if (node === undefined) {
    throw new Error(`Missing ${kind} node ${String(ordinal)}`)
  }
  return node
}

function committed(result: TransformationResult): CommittedTransformation {
  expect(result.kind).toBe('committed')
  if (result.kind !== 'committed') {
    throw new Error(`Unexpected rejection: ${result.reason}`)
  }
  return result
}

describe('TransformationKernel semantic editing', () => {
  it('protects every changed join and preserves untargeted identity', () => {
    const kernel = createTransformationKernel()
    const individual = [
      {
        source: '{==keep==} {++new++} tail',
        kind: 'addition' as const,
        decision: 'accept' as const,
        expected: '{==keep==} new tail',
        edit: { start: 11, end: 20, insert: 'new' }
      },
      {
        source: '{==keep==} {++new++} tail',
        kind: 'addition' as const,
        decision: 'reject' as const,
        expected: '{==keep==}  tail',
        edit: { start: 11, end: 20, insert: '' }
      },
      {
        source: '{==keep==} {--old--} tail',
        kind: 'deletion' as const,
        decision: 'accept' as const,
        expected: '{==keep==}  tail',
        edit: { start: 11, end: 20, insert: '' }
      },
      {
        source: '{==keep==} {--old--} tail',
        kind: 'deletion' as const,
        decision: 'reject' as const,
        expected: '{==keep==} old tail',
        edit: { start: 11, end: 20, insert: 'old' }
      },
      {
        source: '{==keep==} {~~old~>new~~} tail',
        kind: 'substitution' as const,
        decision: 'accept' as const,
        expected: '{==keep==} new tail',
        edit: { start: 11, end: 25, insert: 'new' }
      },
      {
        source: '{==keep==} {~~old~>new~~} tail',
        kind: 'substitution' as const,
        decision: 'reject' as const,
        expected: '{==keep==} old tail',
        edit: { start: 11, end: 25, insert: 'old' }
      }
    ]

    for (const row of individual) {
      const before = open(row.source)
      const untouched = nodeOf(before, 'highlight')
      const target = nodeOf(before, row.kind)
      const result = committed(kernel.apply(before, {
        kind: 'resolve-change',
        target: target.nodeId,
        decision: row.decision
      }))

      expect(result.edits).toEqual([row.edit])
      expect(result.revision.source.text).toBe(row.expected)
      expect(result.revision.configuration).toEqual(before.configuration)
      expect(nodeOf(result.revision, 'highlight').nodeId).toBe(untouched.nodeId)
      expect(result.revision.source.text.slice(0, 11)).toBe(
        before.source.text.slice(0, 11)
      )
    }

    const openerJoins = [
      ['{{--gap--}++x++}', String.raw`\{++x++}`],
      ['{{--gap--}--x--}', String.raw`\{--x--}`],
      ['{{--gap--}~~o~>n~~}', String.raw`\{~~o~>n~~}`],
      ['{{--gap--}==x==}', String.raw`\{==x==}`],
      ['{{--gap--}>>n<<}', String.raw`\{>>n<<}`]
    ] as const
    for (const [source, expected] of openerJoins) {
      const before = open(source)
      const result = committed(kernel.apply(before, {
        kind: 'resolve-change',
        target: nodeOf(before, 'deletion').nodeId,
        decision: 'accept'
      }))
      expect(result.edits).toEqual([
        { start: 0, end: 0, insert: '\\' },
        { start: 1, end: 10, insert: '' }
      ])
      expect(result.revision.source.text).toBe(expected)
      expect(nodesOf(result.revision)).toEqual([])
    }

    const closerJoins = [
      {
        source: '{++x++{--gap--}}',
        target: 'deletion' as const,
        decision: 'accept' as const,
        expected: String.raw`{++x++\}`,
        edit: { start: 6, end: 15, insert: '\\' }
      },
      {
        source: '{--x--{++gap++}}',
        target: 'addition' as const,
        decision: 'reject' as const,
        expected: String.raw`{--x--\}`,
        edit: { start: 6, end: 15, insert: '\\' }
      },
      {
        source: '{~~o~>n~~{++gap++}}',
        target: 'addition' as const,
        decision: 'reject' as const,
        expected: String.raw`{~~o~>n~~\}`,
        edit: { start: 9, end: 18, insert: '\\' }
      },
      {
        source: '{==x=={++gap++}}',
        target: 'addition' as const,
        decision: 'reject' as const,
        expected: String.raw`{==x==\}`,
        edit: { start: 6, end: 15, insert: '\\' }
      },
      {
        source: '{>>n<<{++gap++}}',
        target: 'addition' as const,
        decision: 'reject' as const,
        expected: String.raw`{>>n<<\}`,
        edit: { start: 6, end: 15, insert: '\\' }
      }
    ]
    for (const row of closerJoins) {
      const before = open(row.source)
      const result = committed(kernel.apply(before, {
        kind: 'resolve-change',
        target: nodeOf(before, row.target).nodeId,
        decision: row.decision
      }))
      expect(result.edits).toEqual([row.edit])
      expect(result.revision.source.text).toBe(row.expected)
      expect(nodesOf(result.revision)).toEqual([])
    }

    const separatorBefore = open('{~~old~{++gap++}>new~~}')
    const protectedSeparator = committed(kernel.apply(separatorBefore, {
      kind: 'resolve-change',
      target: nodeOf(separatorBefore, 'addition').nodeId,
      decision: 'reject'
    }))
    expect(protectedSeparator.edits).toEqual([
      { start: 6, end: 6, insert: '\\' },
      { start: 7, end: 16, insert: '' }
    ])
    expect(protectedSeparator.revision.source.text)
      .toBe(String.raw`{~~old\~>new~~}`)
    expect(nodesOf(protectedSeparator.revision)).toEqual([])

    const bofBefore = open('{--prefix--}\uFEFF---\na: value\n---')
    const protectedBof = committed(kernel.apply(bofBefore, {
      kind: 'resolve-change',
      target: nodeOf(bofBefore, 'deletion').nodeId,
      decision: 'accept'
    }))
    expect(protectedBof.edits).toEqual([
      { start: 0, end: 13, insert: '&#xFEFF;' }
    ])
    expect(protectedBof.revision.source.text)
      .toBe('&#xFEFF;---\na: value\n---')
  })

  it('resolves nested individual and bulk changes with sorted nonoverlapping edits', () => {
    const kernel = createTransformationKernel()
    const nested = open('{++A{--B--}C++}')
    const acceptedOuter = committed(kernel.apply(nested, {
      kind: 'resolve-change',
      target: nodeOf(nested, 'addition').nodeId,
      decision: 'accept'
    }))
    expect(acceptedOuter.edits).toEqual([
      { start: 0, end: 15, insert: 'A{--B--}C' }
    ])
    expect(acceptedOuter.revision.source.text).toBe('A{--B--}C')

    const source =
      '{++A{--B--}C++}|{--D{++E++}F--}|{~~G{++H++}~>I{--J--}K~~}'
    const expectations = [
      ['accept', 'AC||IK'],
      ['reject', '|DF|G']
    ] as const

    for (const [decision, expected] of expectations) {
      const before = open(source)
      const result = committed(kernel.apply(before, {
        kind: 'resolve-all-changes',
        decision
      }))

      expect(result.revision.source.text).toBe(expected)
      expect(result.edits).toHaveLength(3)
      for (let index = 1; index < result.edits.length; index += 1) {
        const previous = result.edits[index - 1]
        const current = result.edits[index]
        if (previous === undefined || current === undefined) {
          throw new Error('Expected a complete sorted edit pair')
        }
        expect(previous.end).toBeLessThanOrEqual(current.start)
      }
    }

    const throughCarrier = open('{++A{==B{--C--}D==}E++}')
    const carrierResult = committed(kernel.apply(throughCarrier, {
      kind: 'resolve-all-changes',
      decision: 'accept'
    }))
    expect(carrierResult.edits).toEqual([
      { start: 0, end: 23, insert: 'A{==BD==}E' }
    ])
    expect(carrierResult.revision.source.text).toBe('A{==BD==}E')
  })

  it('removes a Highlight without normalizing its raw nested payload', () => {
    const kernel = createTransformationKernel()
    const before = open('a {==raw {++nested++} tail==} z')
    const target = nodeOf(before, 'highlight')
    const result = committed(kernel.apply(before, {
      kind: 'remove-highlight',
      target: target.nodeId
    }))

    expect(result.edits).toEqual([
      { start: 2, end: 29, insert: 'raw {++nested++} tail' }
    ])
    expect(result.revision.source.text).toBe('a raw {++nested++} tail z')
    expect(nodeOf(result.revision, 'addition').range).toEqual({
      start: 6,
      end: 18
    })
  })

  it('rejects stale and wrongly typed NodeId targets without publishing a candidate', () => {
    const kernel = createTransformationKernel()
    const before = open('{++new++} {==focus==}')
    const wrongKind = kernel.apply(before, {
      kind: 'remove-highlight',
      target: nodeOf(before, 'addition').nodeId
    })
    expect(wrongKind).toMatchObject({
      kind: 'rejected',
      reason: 'wrong-target-kind',
      revision: before
    })

    const stale = kernel.apply(before, {
      kind: 'resolve-change',
      target: 'p1:missing' as NodeId,
      decision: 'accept'
    })
    expect(stale).toMatchObject({
      kind: 'rejected',
      reason: 'target-not-found',
      revision: before
    })
    expect(before.source.text).toBe('{++new++} {==focus==}')
  })
})

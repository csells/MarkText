import { describe, expect, it } from 'vitest'
import type { ExecutionBudgetId } from '@marktext/document-core'
import { parseProfile1Document } from '../../src/internal/profile1Document.js'
import { createProfile1SyntaxGraphCore } from '../../src/internal/profile1/syntaxGraph.js'

const TEST_BUDGET: ExecutionBudgetId = {
  limitsProfile: 'test-unbounded',
  accountingSchema: 'syntax-accounting-1'
}

describe('Profile 1 canonical Markdown parse artifact', () => {
  it('retains parser checkpoints, consumed tape slices, and emitted facts per lane', () => {
    const source = '{++paragraph\n++}tail'
    const parsed = parseProfile1Document(source, TEST_BUDGET)

    expect(parsed.kind).toBe('complete')
    if (parsed.kind !== 'complete') {
      throw new Error('Expected a complete Profile 1 parse')
    }

    const artifact = parsed.canonicalMarkdownParse
    expect(parsed.canonicalMarkdown.root.parseArtifact).toBe(artifact.root)
    expect(artifact.root.items.map((item) => item.kind)).toEqual([
      'critic-branch',
      'source'
    ])

    const branch = artifact.branches[0]
    expect(branch?.node).toBe(parsed.criticMarkup.roots[0])
    const arm = branch?.arms[0]
    expect(arm).toBeDefined()
    expect(parsed.canonicalMarkdown.lanes[arm?.id ?? -1]?.parseArtifact).toBe(arm)
    expect(arm?.armBoundaries).toEqual([])
    expect(arm?.entryCheckpoint).not.toBe(arm?.exitCheckpoint)
    expect(
      arm?.transitions.flatMap((transition) =>
        transition.consumed.map((slice) =>
          source.slice(slice.range.start, slice.range.end)
        )
      ).join('')
    ).toBe('paragraph\n')
    expect(
      arm?.transitions.some((transition) =>
        transition.emittedFacts.block.paragraphOpen
      )
    ).toBe(true)
  })

  it('retains parser-owned enter and exit events for each Substitution arm', () => {
    const parsed = parseProfile1Document('{~~old~>new~~}', TEST_BUDGET)

    expect(parsed.kind).toBe('complete')
    if (parsed.kind !== 'complete') {
      throw new Error('Expected a complete Profile 1 parse')
    }

    const arms = parsed.canonicalMarkdownParse.branches[0]?.arms
    expect(arms?.map((arm) => arm.armBoundaries)).toEqual([
      [
        {
          kind: 'substitution-arm-boundary',
          role: 'enter',
          sourcePosition: 3
        },
        {
          kind: 'substitution-arm-boundary',
          role: 'exit',
          sourcePosition: 6
        }
      ],
      [
        {
          kind: 'substitution-arm-boundary',
          role: 'enter',
          sourcePosition: 8
        },
        {
          kind: 'substitution-arm-boundary',
          role: 'exit',
          sourcePosition: 11
        }
      ]
    ])
  })

  it('refuses to synthesize a missing parser lane branch from the CM forest', () => {
    const source = '{++x++}'
    const parsed = parseProfile1Document(source, TEST_BUDGET)

    expect(parsed.kind).toBe('complete')
    if (parsed.kind !== 'complete') {
      throw new Error('Expected a complete Profile 1 parse')
    }

    const rootWithoutBranch = Object.freeze({
      ...parsed.canonicalMarkdownParse.root,
      items: Object.freeze(
        parsed.canonicalMarkdownParse.root.items.filter(
          (item) => item.kind === 'source'
        )
      )
    })
    const artifactWithoutBranch = Object.freeze({
      ...parsed.canonicalMarkdownParse,
      root: rootWithoutBranch,
      lanes: Object.freeze([
        rootWithoutBranch,
        ...parsed.canonicalMarkdownParse.lanes.slice(1)
      ]),
      branches: Object.freeze([])
    })

    expect(() => createProfile1SyntaxGraphCore(
      source,
      parsed.criticMarkup,
      parsed.markdownLiterals,
      parsed.canonicalTape,
      parsed.markerDecisions,
      artifactWithoutBranch
    )).toThrow(/parser artifact/i)
  })
})

import { describe, expect, it } from 'vitest'

import {
  createProfile1DocumentReuseCache,
  parseProfile1Document
} from '../src/internal/profile1Document.js'
import { createPhysicalTraversalRecorderV1 } from '../src/internal/profile1/physicalTraversalAccounting.js'
import {
  applyRegionalInventory,
  createRegionalInventory,
  type RegionalInventoryRecorder
} from '../src/internal/profile1/regionalInventory.js'
import type { ExecutionBudgetId } from '../src/revision.js'

const executionBudget: ExecutionBudgetId = Object.freeze({
  limitsProfile: 'desktop-v1',
  accountingSchema: 'syntax-accounting-1'
})

const markdownOptions = Object.freeze({
  schema: 'markdown-options-1' as const,
  gfm: true,
  gfmAutolinks: true,
  gfmTagFilter: true,
  frontMatter: true,
  math: true,
  gitLabMath: false,
  footnotes: false,
  subscriptAndSuperscript: true
})

const sourceView = (source: string): Readonly<{
  length: number
  slice: (start: number, end: number) => string
}> => Object.freeze({
  length: source.length,
  slice: (start: number, end: number): string => source.slice(start, end)
})

describe('regional inventory', () => {
  it('falls back before root allocation when its conservative budget is full', () => {
    let candidateParses = 0
    let rootsAttempted = 0
    let changedLeaves = 0
    const recorder: RegionalInventoryRecorder = Object.freeze({
      recordBuildUnit: (): void => {},
      recordLookupComparison: (): void => {},
      recordNodeVisited: (): void => {},
      recordNodeAllocated: (): void => {},
      recordNodeShared: (): void => {},
      recordChangedLeaf: (): void => { changedLeaves += 1 },
      recordRootAttempted: (): void => { rootsAttempted += 1 },
      recordRootCommitted: (): void => {},
      recordCandidateRegionParse: (): void => { candidateParses += 1 },
      recordAnnotationMaterialized: (): void => {}
    })
    const source = [
      'head {++one++}\n\n',
      'middle {++word++}\n\n',
      'far {>>note<<}\n\n',
      'tail\n'
    ].join('')
    const physical = createPhysicalTraversalRecorderV1()
    const parsed = parseProfile1Document(
      source,
      executionBudget,
      undefined,
      markdownOptions,
      false,
      undefined,
      createProfile1DocumentReuseCache(),
      physical
    )
    if (parsed.kind !== 'complete') throw new Error('Expected complete parse')
    const initialUnits = parsed.accountingCounts.reduce(
      (total, count) => total + count,
      0
    )
    const inventory = createRegionalInventory(
      parsed,
      source.length,
      recorder,
      initialUnits + 1
    )
    if (inventory === undefined) throw new Error('Expected inventory')
    const start = source.indexOf('word')
    const next = source.slice(0, start) + 'WORDS' + source.slice(start + 4)
    const result = applyRegionalInventory(
      inventory,
      sourceView(source),
      sourceView(next),
      [{ start, end: start + 4, insert: 'WORDS' }],
      [{ name: 'markup' }],
      executionBudget,
      markdownOptions,
      physical
    )
    expect(result).toEqual({
      kind: 'fallback',
      reason: 'fixed-region-ineligible'
    })
    expect(candidateParses).toBe(1)
    expect(rootsAttempted).toBe(0)
    expect(changedLeaves).toBe(0)
  })
})

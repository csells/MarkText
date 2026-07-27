import { describe, expect, it } from 'vitest'
import { deriveKeyedToc } from '@/util/tocKeys'

const flatKeys = (nodes: ReturnType<typeof deriveKeyedToc>): string[] =>
  nodes.flatMap((node) => [node.key, ...flatKeys(node.children)])

describe('deriveKeyedToc', () => {
  it('uses parser NodeId as the tree key even when heading text repeats', () => {
    const keyed = deriveKeyedToc([
      { label: 'Intro', nodeId: 'heading:first', children: [] },
      { label: 'Intro', nodeId: 'heading:second', children: [] }
    ])

    expect(keyed.map((node) => node.key)).toEqual([
      'heading:first',
      'heading:second'
    ])
  })

  it('preserves parser identity through nested tree projection', () => {
    const keyed = deriveKeyedToc([
      {
        label: 'A',
        nodeId: 'heading:a',
        children: [{
          label: 'B',
          nodeId: 'heading:b',
          children: []
        }]
      },
      { label: 'C', nodeId: 'heading:c', children: [] }
    ])

    expect(flatKeys(keyed)).toEqual([
      'heading:a',
      'heading:b',
      'heading:c'
    ])
    expect(keyed[0]?.children[0]?.nodeId).toBe('heading:b')
  })

  it('rejects a TOC node without parser identity', () => {
    expect(() => deriveKeyedToc([
      { label: 'No identity', children: [] }
    ])).toThrow(/parser NodeId/u)
  })
})

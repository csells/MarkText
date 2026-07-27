import type {
  MarkupCoordinateMapV1,
  MarkupRenderBlock,
  MarkupRenderRun,
  ModelRange,
  NodeId,
  SourceRange
} from '@marktext/document-core'
import {
  decodeDocumentCoreLiveDeltaV1,
  encodeDocumentCoreLiveDeltaV1,
  type DecodedDocumentCoreLiveDeltaV1
} from '@shared/documentCoreLiveWire'
import { describe, expect, it } from 'vitest'

function modelRange(start: number, end: number): ModelRange {
  return Object.freeze({ start, end })
}

function sourceRange(start: number, end: number): SourceRange {
  return Object.freeze({
    start: start as SourceRange['start'],
    end: end as SourceRange['end']
  })
}

function identityRun(
  key: string,
  text: string,
  start: number,
  end: number
): MarkupRenderRun {
  return Object.freeze({
    key,
    text,
    elements: Object.freeze([]),
    modelRange: modelRange(start, end),
    sourceRange: sourceRange(start, end)
  })
}

function identityCoordinateMap(source: string): MarkupCoordinateMapV1 {
  return Object.freeze({
    schema: 'markup-coordinate-map-1',
    affinity: 'previous-left-next-right-1',
    sourceLength: source.length,
    modelLength: source.length,
    spans: source.length === 0
      ? Object.freeze([])
      : Object.freeze([Object.freeze({
        modelStart: 0,
        modelEnd: source.length,
        sourceStart: 0,
        sourceEnd: source.length
      })])
  })
}

function identityLiveDelta(source: string): DecodedDocumentCoreLiveDeltaV1 {
  const run = identityRun('run:identity', source, 0, source.length)
  const block: MarkupRenderBlock = Object.freeze({
    kind: 'paragraph',
    attributes: Object.freeze({}),
    modelRange: modelRange(0, source.length),
    runs: Object.freeze([run]),
    tree: Object.freeze({
      key: 'node:paragraph',
      kind: 'paragraph',
      attributes: Object.freeze({}),
      modelRange: modelRange(0, source.length),
      elements: Object.freeze([]),
      text: Object.freeze([Object.freeze({
        key: 'text:identity',
        text: source,
        elements: Object.freeze([]),
        modelRange: modelRange(0, source.length),
        sourceRange: sourceRange(0, source.length),
        boundaryMapping: 'identity'
      })]),
      children: Object.freeze([])
    })
  })
  return Object.freeze({
    schema: 'document-core-live-plan-delta-1',
    modelText: source,
    markupCoordinateMap: identityCoordinateMap(source),
    blocks: Object.freeze([block]),
    outline: Object.freeze([]),
    listItems: Object.freeze([])
  })
}

const markedContract = (markupModelLength: number) => Object.freeze({
  projection: 'marked' as const,
  markupModelLength
})

const encodeMarked = (
  source: string,
  value: DecodedDocumentCoreLiveDeltaV1
) => encodeDocumentCoreLiveDeltaV1(
  source,
  value,
  markedContract(value.markupCoordinateMap.modelLength)
)

const decodeMarked = (
  source: string,
  value: unknown,
  markupModelLength: number
) => decodeDocumentCoreLiveDeltaV1(
  source,
  value,
  markedContract(markupModelLength)
)

describe('document-core compact live wire', () => {
  it('references canonical and model ranges instead of repeating identity text', () => {
    const source = 'x'.repeat(1_000_000)
    const rich = identityLiveDelta(source)

    const encoded = encodeMarked(source, rich)
    const serialized = JSON.stringify(encoded)

    expect(serialized.length).toBeLessThan(2_048)
    expect(serialized).not.toContain('xxxxxxxxxxxxxxxx')
    expect(decodeMarked(
      source,
      encoded,
      rich.markupCoordinateMap.modelLength
    )).toEqual(rich)
  })

  it('carries parser heading identity and unique anchors without reconstruction', () => {
    const source = '# Repeat\n\n# Repeat\n'
    const base = identityLiveDelta(source)
    const headingBlock = (
      key: NodeId,
      start: number,
      end: number
    ): MarkupRenderBlock => {
      const text = source.slice(start, end)
      return Object.freeze({
        kind: 'heading',
        attributes: Object.freeze({ level: 1 }),
        modelRange: modelRange(start, end),
        runs: Object.freeze([identityRun(`run:${key}`, text, start, end)]),
        tree: Object.freeze({
          key,
          kind: 'heading',
          attributes: Object.freeze({ level: 1 }),
          modelRange: modelRange(start, end),
          elements: Object.freeze([]),
          text: Object.freeze([Object.freeze({
            key: `text:${key}`,
            text,
            elements: Object.freeze([]),
            modelRange: modelRange(start, end),
            sourceRange: sourceRange(start, end),
            boundaryMapping: 'identity'
          })]),
          children: Object.freeze([])
        })
      })
    }
    const rich: DecodedDocumentCoreLiveDeltaV1 = Object.freeze({
      ...base,
      blocks: Object.freeze([
        headingBlock('heading:first' as NodeId, 0, 8),
        headingBlock('heading:second' as NodeId, 10, 18)
      ]),
      outline: Object.freeze([
        Object.freeze({
          nodeId: 'heading:first' as NodeId,
          level: 1,
          content: 'Repeat',
          slug: 'repeat',
          sourceOffset: 0
        }),
        Object.freeze({
          nodeId: 'heading:second' as NodeId,
          level: 1,
          content: 'Repeat',
          slug: 'repeat-1',
          sourceOffset: 10
        })
      ])
    })

    const encoded = encodeMarked(source, rich)
    expect(decodeMarked(
      source,
      encoded,
      rich.markupCoordinateMap.modelLength
    ).outline).toEqual(
      rich.outline
    )
  })

  it('retains transformed semantic text while rehydrating every identity carrier', () => {
    const source = '{++new++} &amp;\n'
    const modelText = 'new &amp;\n'
    const first = Object.freeze({
      key: 'run:new',
      text: 'new',
      elements: Object.freeze(['ins'] as const),
      modelRange: modelRange(0, 3),
      sourceRange: sourceRange(3, 6)
    })
    const second = Object.freeze({
      key: 'run:tail',
      text: ' &amp;\n',
      elements: Object.freeze([]),
      modelRange: modelRange(3, modelText.length),
      sourceRange: sourceRange(9, source.length)
    })
    const rich: DecodedDocumentCoreLiveDeltaV1 = Object.freeze({
      schema: 'document-core-live-plan-delta-1',
      modelText,
      markupCoordinateMap: Object.freeze({
        schema: 'markup-coordinate-map-1',
        affinity: 'previous-left-next-right-1',
        sourceLength: source.length,
        modelLength: modelText.length,
        spans: Object.freeze([
          Object.freeze({
            modelStart: 0,
            modelEnd: 3,
            sourceStart: 3,
            sourceEnd: 6
          }),
          Object.freeze({
            modelStart: 3,
            modelEnd: modelText.length,
            sourceStart: 9,
            sourceEnd: source.length
          })
        ])
      }),
      blocks: Object.freeze([Object.freeze({
        kind: 'paragraph',
        attributes: Object.freeze({}),
        modelRange: modelRange(0, modelText.length),
        runs: Object.freeze([first, second]),
        tree: Object.freeze({
          key: 'node:paragraph',
          kind: 'paragraph',
          attributes: Object.freeze({}),
          modelRange: modelRange(0, modelText.length),
          elements: Object.freeze([]),
          text: Object.freeze([
            Object.freeze({
              key: 'text:new',
              text: 'new',
              elements: Object.freeze(['ins'] as const),
              modelRange: modelRange(0, 3),
              sourceRange: sourceRange(3, 6),
              boundaryMapping: 'identity'
            }),
            Object.freeze({
              key: 'text:space',
              text: ' ',
              elements: Object.freeze([]),
              modelRange: modelRange(3, 4),
              sourceRange: sourceRange(9, 10),
              boundaryMapping: 'identity'
            }),
            Object.freeze({
              key: 'text:entity',
              text: '&',
              elements: Object.freeze([]),
              modelRange: modelRange(4, 9),
              sourceRange: sourceRange(10, 15),
              boundaryMapping: 'collapsed'
            })
          ]),
          children: Object.freeze([])
        })
      })]),
      outline: Object.freeze([]),
      listItems: Object.freeze([])
    })

    const encoded = encodeMarked(source, rich)
    const decoded = decodeMarked(
      source,
      encoded,
      rich.markupCoordinateMap.modelLength
    )

    expect(encoded.modelText).toEqual({
      kind: 'materialized',
      text: modelText
    })
    expect(JSON.stringify(encoded)).toContain('"text":"&"')
    expect(decoded).toEqual(rich)
    expect(Object.isFrozen(decoded)).toBe(true)
    expect(Object.isFrozen(decoded.blocks[0]?.tree.text)).toBe(true)
  })

  it.each(['original', 'revised'] as const)(
    'roundtrips a %s display model while retaining the distinct Markup coordinate map',
    (projection) => {
      const source = '{~~old~>new~~}'
      const displayText = projection === 'original' ? 'old' : 'new'
      const rich: DecodedDocumentCoreLiveDeltaV1 = Object.freeze({
        ...identityLiveDelta(displayText),
        markupCoordinateMap: Object.freeze({
          schema: 'markup-coordinate-map-1',
          affinity: 'previous-left-next-right-1',
          sourceLength: source.length,
          modelLength: 6,
          spans: Object.freeze([
            Object.freeze({
              modelStart: 0,
              modelEnd: 3,
              sourceStart: 3,
              sourceEnd: 6
            }),
            Object.freeze({
              modelStart: 3,
              modelEnd: 6,
              sourceStart: 8,
              sourceEnd: 11
            })
          ])
        })
      })
      const contract = Object.freeze({
        projection,
        markupModelLength: 6
      })

      const encoded = encodeDocumentCoreLiveDeltaV1(source, rich, contract)

      expect(
        decodeDocumentCoreLiveDeltaV1(source, encoded, contract)
      ).toEqual(rich)
    }
  )

  it('rejects open records and values outside the live-plan vocabulary', () => {
    const source = 'plain'
    const encoded = encodeMarked(source, identityLiveDelta(source))
    const markupModelLength = encoded.markupCoordinateMap.modelLength
    expect(() => decodeMarked(source, {
      ...encoded,
      unexpected: true
    }, markupModelLength)).toThrow(/unexpected field/u)
    expect(() => decodeMarked(source, {
      ...encoded,
      modelText: {
        kind: 'canonical-source',
        text: 'smuggled duplicate'
      }
    }, markupModelLength)).toThrow(/unexpected field/u)
    expect(() => decodeMarked(source, {
      ...encoded,
      markupCoordinateMap: {
        ...encoded.markupCoordinateMap,
        sourceLength: source.length + 1,
        spans: [{
          modelStart: 0,
          modelEnd: source.length,
          sourceStart: 0,
          sourceEnd: source.length
        }]
      }
    }, markupModelLength)).toThrow(/canonical source/u)
    const block = encoded.blocks[0]
    if (block === undefined) throw new Error('Expected one encoded block')
    expect(() => decodeMarked(source, {
      ...encoded,
      blocks: [{
        ...block,
        kind: 'invented-node-kind'
      }]
    }, markupModelLength)).toThrow(/Markdown node kind/u)
    expect(() => decodeMarked(source, {
      ...encoded,
      outline: [{
        nodeId: 'p1:heading:1',
        level: 7,
        content: 'outside heading levels',
        slug: 'outside-heading-levels',
        sourceOffset: 0
      }]
    }, markupModelLength)).toThrow(/heading level/u)
  })

  it('rejects model text whose length disagrees with its coordinate map', () => {
    const source = 'a'
    const encoded = encodeMarked(source, identityLiveDelta(source))
    expect(() => decodeMarked(source, {
      ...encoded,
      modelText: {
        kind: 'materialized',
        text: 'ab'
      }
    }, encoded.markupCoordinateMap.modelLength))
      .toThrow(/display text|model length|coordinate map/i)
  })

  it('rejects hostile tree depth with a bounded validation error', () => {
    const source = 'a'
    const encoded = encodeMarked(source, identityLiveDelta(source))
    const block = encoded.blocks[0]
    if (block === undefined) throw new Error('Expected one encoded block')
    let tree: unknown = block.tree
    for (let index = 0; index < 12_000; index += 1) {
      tree = {
        key: `hostile:${index}`,
        kind: 'paragraph',
        attributes: {},
        modelRange: { start: 0, end: 1 },
        elements: [],
        text: [],
        children: [tree]
      }
    }
    expect(() => decodeMarked(source, {
      ...encoded,
      blocks: [{ ...block, tree }]
    }, encoded.markupCoordinateMap.modelLength))
      .toThrow(/tree depth|node limit/i)
  })

  it('authenticates live topology and semantic index references', () => {
    const source = 'a'
    const encoded = encodeMarked(source, identityLiveDelta(source))
    const markupModelLength = encoded.markupCoordinateMap.modelLength
    const block = encoded.blocks[0]
    if (block === undefined) throw new Error('Expected one encoded block')
    const child = {
      ...block.tree,
      key: 'node:duplicate',
      text: [],
      children: []
    }
    expect(() => decodeMarked(source, {
      ...encoded,
      blocks: [{
        ...block,
        tree: {
          ...block.tree,
          children: [child, child]
        }
      }]
    }, markupModelLength)).toThrow(/duplicate.*node|node.*duplicate/i)
    expect(() => decodeMarked(source, {
      ...encoded,
      blocks: [{
        ...block,
        kind: 'heading'
      }]
    }, markupModelLength)).toThrow(/block.*tree|tree.*block/i)
    expect(() => decodeMarked(source, {
      ...encoded,
      outline: [{
        nodeId: 'heading:not-in-tree',
        level: 1,
        content: 'a',
        slug: 'a',
        sourceOffset: 0
      }]
    }, markupModelLength)).toThrow(/outline.*heading|heading.*outline/i)
    expect(() => decodeMarked(source, {
      ...encoded,
      listItems: [{ start: 0, end: 1 }]
    }, markupModelLength)).toThrow(/list.*item|item.*list/i)
  })
})

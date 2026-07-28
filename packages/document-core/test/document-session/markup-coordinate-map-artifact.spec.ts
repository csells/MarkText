import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  decodeMarkupCoordinateMapV1,
  modelPositionAtMarkupCoordinateMap,
  sourcePositionAtMarkupCoordinateMap,
  type ModelPosition,
  type ParseConfiguration
} from '@marktext/document-core'

const CONFIGURATION: ParseConfiguration = Object.freeze({
  markdownProfile: 'markdown-profile-1',
  criticMarkupProfile: 'marktext-profile-1',
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  markdownOptions: Object.freeze({
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  }),
  executionBudget: Object.freeze({
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  })
})

function expectedModelPosition(
  runs: readonly {
    readonly modelRange: { readonly start: number, readonly end: number }
    readonly sourceRange: { readonly start: number, readonly end: number }
  }[],
  modelLength: number,
  direct: ModelPosition | null,
  position: ModelPosition
): ModelPosition {
  if (direct !== null) return direct
  const nearest = position.affinity === 'previous'
    ? [...runs].reverse().find(
      run => Number(run.sourceRange.end) <= position.offset
    )
    : runs.find(
      run => Number(run.sourceRange.start) >= position.offset
    )
  return Object.freeze({
    offset: nearest === undefined
      ? position.affinity === 'previous'
        ? 0
        : modelLength
      : position.affinity === 'previous'
        ? nearest.modelRange.end
        : nearest.modelRange.start,
    affinity: position.affinity
  })
}

describe('parser-owned Markup coordinate map artifact', () => {
  it('publishes compact spans with explicit affinity semantics', async() => {
    const source =
      'before {==outer {++inner++} tail==}{>>hidden note<<} ' +
      '{~~old~>new~~} after'
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: CONFIGURATION
    })
    const snapshot = session.snapshot()
    if (snapshot.kind !== 'complete') {
      throw new Error('Expected a complete snapshot')
    }
    const map = snapshot.livePlan.coordinateMap

    expect(map).toMatchObject({
      schema: 'markup-coordinate-map-1',
      affinity: 'previous-left-next-right-1',
      sourceLength: source.length,
      modelLength: snapshot.livePlan.modelLength
    })
    for (const affinity of ['previous', 'next'] as const) {
      for (
        let modelOffset = 0;
        modelOffset <= map.modelLength;
        modelOffset += 1
      ) {
        const position = { offset: modelOffset, affinity }
        expect(sourcePositionAtMarkupCoordinateMap(map, position))
          .toEqual(snapshot.livePlan.sourcePositionAt(position))
      }
      for (
        let sourceOffset = 0;
        sourceOffset <= source.length;
        sourceOffset += 1
      ) {
        const position = { offset: sourceOffset, affinity }
        expect(modelPositionAtMarkupCoordinateMap(map, position)).toEqual(
          expectedModelPosition(
            snapshot.livePlan.runs,
            snapshot.livePlan.modelLength,
            snapshot.livePlan.modelPositionAt(position),
            position
          )
        )
      }
    }
  })

  it('strictly rejects open, unbounded, overlapping, and implicit-affinity maps', () => {
    const valid = {
      schema: 'markup-coordinate-map-1',
      affinity: 'previous-left-next-right-1',
      sourceLength: 9,
      modelLength: 3,
      spans: [{
        modelStart: 0,
        modelEnd: 3,
        sourceStart: 3,
        sourceEnd: 6
      }]
    }
    expect(decodeMarkupCoordinateMapV1(valid)).toEqual(valid)
    expect(() => decodeMarkupCoordinateMapV1({
      ...valid,
      topology: 'renderer-selected'
    })).toThrow(/closed|unexpected|field/i)
    expect(() => decodeMarkupCoordinateMapV1({
      ...valid,
      affinity: undefined
    })).toThrow(/affinity/i)
    expect(() => decodeMarkupCoordinateMapV1({
      ...valid,
      spans: [{
        modelStart: 0,
        modelEnd: 3,
        sourceStart: 3,
        sourceEnd: 7
      }]
    })).toThrow(/length|span/i)
    expect(() => decodeMarkupCoordinateMapV1({
      ...valid,
      modelLength: 4,
      spans: [
        {
          modelStart: 0,
          modelEnd: 2,
          sourceStart: 0,
          sourceEnd: 2
        },
        {
          modelStart: 2,
          modelEnd: 4,
          sourceStart: 1,
          sourceEnd: 3
        }
      ]
    })).toThrow(/overlap|span/i)
    expect(() => decodeMarkupCoordinateMapV1({
      ...valid,
      modelLength: 3,
      spans: [
        {
          modelStart: 0,
          modelEnd: 1,
          sourceStart: 0,
          sourceEnd: 1
        },
        {
          modelStart: 2,
          modelEnd: 3,
          sourceStart: 3,
          sourceEnd: 4
        }
      ]
    })).toThrow(/model|span/i)
    expect(() => decodeMarkupCoordinateMapV1({
      ...valid,
      spans: Array.from({ length: 2_000_001 }, () => valid.spans[0])
    })).toThrow(/bounded|span|limit/i)
  })
})

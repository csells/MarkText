import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type ModelPosition,
  type ParseConfiguration
} from '@marktext/document-core'
import { createMarkupView } from '../../src/internal/session/markupView.js'

const CONFIGURATION: ParseConfiguration = {
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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function revisionFor(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete revision')
  }
  return revision
}

function unitOrigins(revision: CompleteDocumentRevision): readonly number[] {
  const origins: number[] = []
  for (
    let ordinal = 0;
    ordinal < revision.markup.runCount;
    ordinal += 1
  ) {
    const run = revision.markup.runAt(ordinal)
    for (let offset = 0; offset < run.text.length; offset += 1) {
      origins.push(Number(run.sourceRange.start) + offset)
    }
  }
  return origins
}

function referenceSourcePosition(
  origins: readonly number[],
  sourceLength: number,
  position: ModelPosition
): number {
  if (origins.length === 0) return 0
  const originAt = (index: number): number => {
    const origin = origins[index]
    if (origin === undefined) {
      throw new Error(`Reference origin ${index} is outside the model`)
    }
    return origin
  }
  if (position.offset === 0) return originAt(0)
  if (position.offset === origins.length) return sourceLength
  return position.affinity === 'previous'
    ? originAt(position.offset - 1) + 1
    : originAt(position.offset)
}

function referenceModelPosition(
  origins: readonly number[],
  sourceLength: number,
  sourceOffset: number,
  affinity: ModelPosition['affinity']
): ModelPosition | null {
  for (let modelOffset = 0; modelOffset <= origins.length; modelOffset += 1) {
    const position = { offset: modelOffset, affinity }
    if (
      referenceSourcePosition(origins, sourceLength, position) === sourceOffset
    ) {
      return position
    }
  }
  return null
}

describe('MarkupView compact origin span index', () => {
  it('matches the former code-unit mapping at every run and elision boundary', () => {
    const source =
      'a {++new++} b {--old--} c {~~before~>after~~} ' +
      '{{>>note<<}++tail++}'
    const revision = revisionFor(source)
    const origins = unitOrigins(revision)
    const view = createMarkupView(revision)

    expect(view.modelLength).toBe(origins.length)
    for (const affinity of ['previous', 'next'] as const) {
      for (
        let modelOffset = 0;
        modelOffset <= origins.length;
        modelOffset += 1
      ) {
        expect(view.sourcePositionAt({
          offset: modelOffset,
          affinity
        }).offset).toBe(referenceSourcePosition(
          origins,
          source.length,
          { offset: modelOffset, affinity }
        ))
      }
      for (
        let sourceOffset = 0;
        sourceOffset <= source.length;
        sourceOffset += 1
      ) {
        expect(view.modelPositionAt({
          offset: sourceOffset,
          affinity
        })).toEqual(referenceModelPosition(
          origins,
          source.length,
          sourceOffset,
          affinity
        ))
      }
    }
  })

  it('indexes a high-run-count document by spans while preserving gap affinity', () => {
    const runCount = 20_000
    const source = '{++x++}'.repeat(runCount)
    const view = createMarkupView(revisionFor(source))

    expect(view.runs).toHaveLength(runCount)
    expect(view.modelLength).toBe(runCount)
    for (const modelOffset of [1, 10_000, runCount - 1]) {
      expect(view.sourcePositionAt({
        offset: modelOffset,
        affinity: 'previous'
      }).offset).toBe((modelOffset - 1) * 7 + 4)
      expect(view.sourcePositionAt({
        offset: modelOffset,
        affinity: 'next'
      }).offset).toBe(modelOffset * 7 + 3)
      expect(view.modelPositionAt({
        offset: modelOffset * 7 + 3,
        affinity: 'next'
      })).toEqual({ offset: modelOffset, affinity: 'next' })
    }
  })
})

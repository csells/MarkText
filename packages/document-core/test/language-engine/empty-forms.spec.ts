import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CriticMarkupNode,
  type ParseConfiguration
} from '@marktext/document-core'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function open(
  sourceText: string,
  expectedOriginal: string,
  expectedRevised: string
): CriticMarkupNode {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(sourceText),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete document revision')
  }
  const root = revision.criticMarkup.rootAt(0)
  if (root === undefined || revision.criticMarkup.rootCount !== 1) {
    throw new Error('Expected exactly one CriticMarkup root')
  }
  expect(revision.projection('original').source).toBe(expectedOriginal)
  expect(revision.projection('revised').source).toBe(expectedRevised)
  return root
}

describe('LanguageEngine.open empty forms', () => {
  it.each([
    ['{++++}', 'addition'],
    ['{----}', 'deletion'],
    ['{====}', 'highlight'],
    ['{>><<}', 'comment']
  ] as const)('recognizes complete empty %s syntax', (sourceText, kind) => {
    const root = open(sourceText, '', '')
    expect(root).toMatchObject({
      kind,
      range: { start: 0, end: 6 },
      markers: {
        open: { start: 0, end: 3 },
        close: { start: 3, end: 6 }
      },
      arms: [{ range: { start: 3, end: 3 }, children: [] }]
    })
  })

  it.each([
    [
      '{~~~>new~~}',
      '',
      'new',
      { old: [3, 3], separator: [3, 5], new: [5, 8], close: [8, 11] }
    ],
    [
      '{~~old~>~~}',
      'old',
      '',
      { old: [3, 6], separator: [6, 8], new: [8, 8], close: [8, 11] }
    ],
    [
      '{~~~>~~}',
      '',
      '',
      { old: [3, 3], separator: [3, 5], new: [5, 5], close: [5, 8] }
    ]
  ] as const)(
    'recognizes complete empty Substitution arms in %s',
    (sourceText, original, revised, ranges) => {
      const root = open(sourceText, original, revised)
      expect(root.kind).toBe('substitution')
      if (root.kind !== 'substitution') {
        throw new Error('Expected a Substitution')
      }
      expect(root).toEqual({
        kind: 'substitution',
        range: { start: 0, end: sourceText.length },
        markers: {
          open: { start: 0, end: 3 },
          separator: { start: ranges.separator[0], end: ranges.separator[1] },
          close: { start: ranges.close[0], end: ranges.close[1] }
        },
        arms: [
          {
            name: 'old',
            range: { start: ranges.old[0], end: ranges.old[1] },
            children: []
          },
          {
            name: 'new',
            range: { start: ranges.new[0], end: ranges.new[1] },
            children: []
          }
        ]
      })
    }
  )
})

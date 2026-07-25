import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import { rootsOf, runsOf } from '../helpers/collections.js'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('LanguageEngine.open boundary-safe projection', () => {
  it('protects an opener assembled across an elided node with generated provenance', () => {
    const sourceText = '{{--z--}++x++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      { kind: 'deletion', range: { start: 1, end: 8 } }
    ])
    expect(revision.projection('original').source).toBe('{z++x++}')

    const revised = revision.projection('revised')
    expect(revised.source).toBe(String.raw`\{++x++}`)
    expect(
      Array.from({ length: revised.source.length }, (_, offset) =>
        revised.provenance.originAt(offset)
      )
    ).toEqual([
      { kind: 'generated', sourcePosition: 0, affinity: 'next' },
      { kind: 'canonical', sourceOffset: 0 },
      { kind: 'canonical', sourceOffset: 8 },
      { kind: 'canonical', sourceOffset: 9 },
      { kind: 'canonical', sourceOffset: 10 },
      { kind: 'canonical', sourceOffset: 11 },
      { kind: 'canonical', sourceOffset: 12 },
      { kind: 'canonical', sourceOffset: 13 }
    ])
  })

  it('protects a retained non-top closer before elision can retarget it', () => {
    const sourceText = '{++a{--b++}c--}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const original = revision.projection('original')
    expect(original.source).toBe(String.raw`{++ab++\}c`)
    expect(original.provenance.originAt(7)).toEqual({
      kind: 'generated',
      sourcePosition: 10,
      affinity: 'next'
    })
    expect(revision.projection('revised').source).toBe('{++a')
  })

  it('continues through overlapping marker decisions after protecting an opener', () => {
    const sourceText = '{~~{=={~~>~~}==}~~}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      { kind: 'highlight', range: { start: 3, end: 16 } }
    ])
    expect(revision.diagnostics.count).toBe(2)
    expect(revision.projection('original').source).toBe(String.raw`{~~\{~\~>~~\}~~}`)
    expect(revision.projection('revised').source).toBe(String.raw`{~~\{~\~>~~\}~~}`)
  })

  it('lets an enclosing closer preempt an unclosed arm-local fence', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++{++++}~~~{>>++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toEqual([{
      kind: 'addition',
      range: { start: 0, end: 18 },
      markers: {
        open: { start: 0, end: 3 },
        close: { start: 15, end: 18 }
      },
      arms: [{
        name: 'content',
        range: { start: 3, end: 15 },
        children: [{
          kind: 'addition',
          range: { start: 3, end: 9 },
          markers: {
            open: { start: 3, end: 6 },
            close: { start: 6, end: 9 }
          },
          arms: [{
            name: 'content',
            range: { start: 6, end: 6 },
            children: []
          }]
        }]
      }]
    }])
    expect(revision.diagnostics.count).toBe(0)
    expect(revision.ownership.ownerAt(12)).toEqual({
      range: { start: 9, end: 15 },
      owner: {
        kind: 'markdown-literal',
        provider: 'fenced-code',
        ownerRange: { start: 9, end: 15 }
      }
    })
    expect(revision.projection('original').source).toBe('')
    expect(revision.projection('revised').source).toBe('~~~{>>')
  })

  it('is source-idempotent when elision moves malformed marker text to virtual BOF', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{--x--}{++~~~}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    for (const view of ['original', 'revised'] as const) {
      const first = revision.projection(view).source
      const reopened = createLanguageEngine().open(
        createSourceSnapshot(first),
        TEST_CONFIGURATION
      )
      if (reopened.kind !== 'complete') {
        throw new Error('Expected a complete reopened projection')
      }
      expect(rootsOf(reopened.criticMarkup)).toEqual([])
      expect(reopened.projection(view).source).toBe(first)
    }
  })

  it('protects CM when elision invalidates a canonical definition dependency', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('p{--\n--}[r]: /{++y++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const revised = revision.projection('revised')
    expect(revised.source).toBe(String.raw`p[r]: /\{++y++\}`)
    expect(revised.markdown.root.childAt(0)).toMatchObject({
      kind: 'paragraph',
      range: { start: 0, end: revised.source.length }
    })

    const reopened = createLanguageEngine().open(
      createSourceSnapshot(revised.source),
      TEST_CONFIGURATION
    )
    if (reopened.kind !== 'complete') {
      throw new Error('Expected a complete reopened projection')
    }
    expect(rootsOf(reopened.criticMarkup)).toEqual([])
    expect(reopened.projection('revised').source).toBe(revised.source)
  })
})

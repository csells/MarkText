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

describe('Profile 1 reference-definition scopes', () => {
  it('does not resolve a new-arm reference from its mutually exclusive old arm', () => {
    const sourceText =
      '{~~[ref]: /x\n~>[outer [inner][ref]](out/{++literal++})~~}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([{
      kind: 'substitution',
      arms: [
        { name: 'old', children: [] },
        { name: 'new', children: [] }
      ]
    }])
    expect(revision.ownership.ownerAt(40).owner).toEqual({
      kind: 'markdown-literal',
      provider: 'link-destination',
      ownerRange: { start: 35, end: 54 }
    })
    expect(revision.projection('revised').source).toBe(
      '[outer [inner][ref]](out/{++literal++})'
    )
  })

  it('does not resolve an old-arm reference from its mutually exclusive new arm', () => {
    const sourceText =
      '{~~[outer [inner][ref]](out/{++literal++})~>[ref]: /x~~}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([{
      kind: 'substitution',
      arms: [
        { name: 'old', children: [] },
        { name: 'new', children: [] }
      ]
    }])
    expect(revision.projection('original').source).toBe(
      '[outer [inner][ref]](out/{++literal++})'
    )
  })

  it('does not inherit root definitions into an isolated Comment document', () => {
    const sourceText =
      '[ref]: /x\n\n{>>[outer [inner][ref]](out/{++literal++})<<}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup).at(-1)).toMatchObject({
      kind: 'comment',
      arms: [{ name: 'comment', children: [] }]
    })
    expect(
      revision.ownership.ownerAt(sourceText.indexOf('{++')).owner
    ).toMatchObject({
      kind: 'markdown-literal',
      provider: 'link-destination'
    })
  })

  it('does not export Comment-local definitions into the root document', () => {
    const sourceText =
      '{>>[ref]: /x<<}\n\n[outer [inner][ref]](out/{++literal++})'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toHaveLength(1)
    expect(revision.criticMarkup.rootAt(0)).toMatchObject({ kind: 'comment' })
    expect(
      revision.ownership.ownerAt(sourceText.indexOf('{++')).owner
    ).toMatchObject({
      kind: 'markdown-literal',
      provider: 'link-destination'
    })
  })

  it('resolves a later definition within the same Comment document', () => {
    const sourceText =
      '{>>[outer [inner][ref]](out/{++literal++})\n\n[ref]: /x<<}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([{
      kind: 'comment',
      arms: [{
        name: 'comment',
        children: [{ kind: 'addition' }]
      }]
    }])
  })

  it('inherits a root definition into compatible non-Comment branches', () => {
    const sourceText =
      '[ref]: /x\n\n{++[outer [inner][ref]](out/{--literal--})++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup).at(-1)).toMatchObject({
      kind: 'addition',
      arms: [{
        name: 'content',
        children: [{ kind: 'deletion' }]
      }]
    })
  })
})

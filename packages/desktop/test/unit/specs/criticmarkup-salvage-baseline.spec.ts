import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  collectCriticMarkupSalvageBaseline,
  type CriticMarkupSalvageBaseline,
  type CriticMarkupSalvageDispositionOverlay,
  validateCriticMarkupSalvageDispositions
} from '../../../../../scripts/criticmarkupSalvageBaseline'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const baselineCommit = '43bd8b77795fb27b1a9512737c000f7362031ea0'
const snapshots = {
  native: '9a5b6d8e0d8dcd1131f07eb1a8a2cf621ccd7d28',
  research: '37ea7e842fb16dfb8ee9fd0c0d0ac07f3e3626b9'
} as const

const oneCandidateBaseline = (): CriticMarkupSalvageBaseline => ({
  schema: 'marktext-criticmarkup-salvage-candidates-v1',
  baselineCommit,
  snapshots,
  summary: {
    native: { added: 1, modified: 0, deleted: 0, total: 1 },
    research: { added: 0, modified: 0, deleted: 0, total: 0 },
    total: 1
  },
  candidates: [{
    id: 'native:new-file',
    snapshot: 'native',
    path: 'new-file',
    change: 'added',
    before: null,
    after: { mode: '100644', oid: 'a'.repeat(40) }
  }]
})

const disposedOverlay = (): CriticMarkupSalvageDispositionOverlay => ({
  schema: 'marktext-criticmarkup-salvage-dispositions-v1',
  baselineCommit,
  snapshots,
  assets: [{
    id: 'new-file',
    title: 'New file',
    disposition: 'adapt',
    rationale: 'Carry the behavior into the new architecture.',
    refs: ['specs/plans/0010-marktext-criticmarkup-core-integration.md'],
    candidates: ['native:new-file']
  }]
})

const firstAsset = (
  overlay: CriticMarkupSalvageDispositionOverlay
): CriticMarkupSalvageDispositionOverlay['assets'][number] => {
  const asset = overlay.assets[0]
  if (!asset) throw new Error('Test overlay is missing its asset')
  return asset
}

describe('CriticMarkup salvage baseline', () => {
  it('derives every snapshot/path candidate from pinned Git objects', () => {
    const baseline = collectCriticMarkupSalvageBaseline(repoRoot, {
      baselineCommit,
      snapshots
    })

    expect(baseline.summary).toEqual({
      native: { added: 447, modified: 304, deleted: 2, total: 753 },
      research: { added: 709, modified: 283, deleted: 1196, total: 2188 },
      total: 2941
    })
    expect(baseline.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'native:.gitattributes',
        change: 'added',
        before: null
      }),
      expect.objectContaining({
        id: 'research:.github/workflows/muya-build.yml',
        change: 'deleted',
        after: null
      })
    ]))
    expect(() => validateCriticMarkupSalvageDispositions(baseline, {
      schema: 'marktext-criticmarkup-salvage-dispositions-v1',
      baselineCommit,
      snapshots,
      assets: []
    })).toThrow(/2941 salvage candidates are undisposed/)
  })

  it('canonicalizes Git refs and requires baseline-to-native-to-research lineage', () => {
    const baseline = collectCriticMarkupSalvageBaseline(repoRoot, {
      baselineCommit: baselineCommit.slice(0, 12),
      snapshots: {
        native: 'feat/native-criticmarkup',
        research: 'criticmarkup-engine-research-2026-08-10'
      }
    })
    expect(baseline.baselineCommit).toBe(baselineCommit)
    expect(baseline.snapshots).toEqual(snapshots)

    expect(() => collectCriticMarkupSalvageBaseline(repoRoot, {
      baselineCommit,
      snapshots: {
        native: snapshots.research,
        research: snapshots.native
      }
    })).toThrow(/baseline → native → research/)
  })

  it('requires a human decision to partition every generated candidate exactly once', () => {
    const baseline = oneCandidateBaseline()
    expect(() => validateCriticMarkupSalvageDispositions(
      baseline,
      disposedOverlay()
    )).not.toThrow()

    const stale = disposedOverlay()
    firstAsset(stale).candidates = ['native:stale']
    expect(() => validateCriticMarkupSalvageDispositions(baseline, stale))
      .toThrow(/stale candidate native:stale/)

    const duplicate = disposedOverlay()
    duplicate.assets.push({
      ...firstAsset(duplicate),
      id: 'duplicate'
    })
    expect(() => validateCriticMarkupSalvageDispositions(baseline, duplicate))
      .toThrow(/disposed more than once/)
  })

  it('rejects malformed runtime JSON and unsupported dispositions', () => {
    const baseline = oneCandidateBaseline()
    expect(() => validateCriticMarkupSalvageDispositions({
      ...baseline,
      schema: 'wrong'
    } as unknown as CriticMarkupSalvageBaseline, disposedOverlay()))
      .toThrow(/candidate schema is invalid/)

    const malformed = disposedOverlay()
    firstAsset(malformed).disposition = 'invented' as 'adapt'
    expect(() => validateCriticMarkupSalvageDispositions(baseline, malformed))
      .toThrow(/invalid disposition/)

    const superseded = disposedOverlay()
    firstAsset(superseded).disposition = 'supersede'
    expect(() => validateCriticMarkupSalvageDispositions(baseline, superseded))
      .toThrow(/requires a replacement reference/)
  })
})

import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  readCriticMarkupRepresentativeDocuments,
  validateCriticMarkupRepresentativeDocuments
} from '../../../../../scripts/criticmarkupRepresentativeDocuments'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const manifestPath = resolve(
  repoRoot,
  'specs/baselines/criticmarkup-representative-documents.json'
)

describe('CriticMarkup representative documents', () => {
  it('pins a reproducible corpus covering every required performance surface', () => {
    const manifest = readCriticMarkupRepresentativeDocuments(manifestPath)

    expect(() => validateCriticMarkupRepresentativeDocuments(
      repoRoot,
      manifest
    )).not.toThrow()
    expect(manifest.status).toBe('proposed-unratified')
    expect(manifest.documents.map(document => document.id)).toEqual([
      'all-blocks',
      'dense-criticmarkup',
      'long-markdown-guide',
      'math-and-diagram',
      'unicode-prose'
    ])
  })

  it('cannot imply owner ratification from structural corpus checks', () => {
    const manifest = structuredClone(
      readCriticMarkupRepresentativeDocuments(manifestPath)
    )
    Object.assign(manifest, { status: 'ratified' })

    expect(() => validateCriticMarkupRepresentativeDocuments(
      repoRoot,
      manifest
    )).toThrow(/must remain proposed-unratified/)
  })

  it('rejects self-declared coverage with stale source measurements', () => {
    const manifest = structuredClone(readCriticMarkupRepresentativeDocuments(manifestPath))
    Object.assign(manifest.documents[0], { sourceUnits: 1 })

    expect(() => validateCriticMarkupRepresentativeDocuments(
      repoRoot,
      manifest
    )).toThrow(/source-unit count is stale/)

    const unverified = structuredClone(
      readCriticMarkupRepresentativeDocuments(manifestPath)
    )
    Object.assign(unverified.documents[0].evidence[0] ?? {}, {
      coverage: 'plain-prose',
      anchor: 'not present in the pinned document'
    })
    expect(() => validateCriticMarkupRepresentativeDocuments(
      repoRoot,
      unverified
    )).toThrow(/has no verified plain-prose anchor/)

    const staleAsset = structuredClone(
      readCriticMarkupRepresentativeDocuments(manifestPath)
    )
    const asset = staleAsset.documents
      .find(document => document.id === 'math-and-diagram')
      ?.dependentAssets?.[0]
    if (asset === undefined) throw new Error('Pinned image asset is missing')
    Object.assign(asset, { sha256: '0'.repeat(64) })
    expect(() => validateCriticMarkupRepresentativeDocuments(
      repoRoot,
      staleAsset
    )).toThrow(/Representative asset hash is stale/)
  })
})

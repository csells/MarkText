import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

export type CriticMarkupRepresentativeCoverage =
  | 'plain-prose'
  | 'long-document'
  | 'tables'
  | 'code'
  | 'unicode'
  | 'math'
  | 'diagrams'
  | 'images'
  | 'dense-criticmarkup'

export interface CriticMarkupRepresentativeDocument {
  id: string
  path: string
  sha256: string
  sourceUnits: number
  coverage: CriticMarkupRepresentativeCoverage[]
  evidence: ReadonlyArray<Readonly<{
    coverage: CriticMarkupRepresentativeCoverage
    anchor: string
  }>>
  dependentAssets?: ReadonlyArray<Readonly<{
    path: string
    reference: string
    sha256: string
  }>>
}

export interface CriticMarkupRepresentativeDocuments {
  schema: 'marktext-criticmarkup-representative-documents-v1'
  status: 'proposed-unratified'
  documents: CriticMarkupRepresentativeDocument[]
}

const REQUIRED_COVERAGE: readonly CriticMarkupRepresentativeCoverage[] = [
  'plain-prose',
  'long-document',
  'tables',
  'code',
  'unicode',
  'math',
  'diagrams',
  'images',
  'dense-criticmarkup'
]

export const readCriticMarkupRepresentativeDocuments = (
  path: string
): CriticMarkupRepresentativeDocuments => JSON.parse(
  readFileSync(path, 'utf8')
) as CriticMarkupRepresentativeDocuments

export const validateCriticMarkupRepresentativeDocuments = (
  repoRoot: string,
  manifest: CriticMarkupRepresentativeDocuments
): void => {
  if (manifest.schema !== 'marktext-criticmarkup-representative-documents-v1') {
    throw new Error('CriticMarkup representative-document schema is invalid')
  }
  if (manifest.status !== 'proposed-unratified') {
    throw new Error('CriticMarkup representative documents must remain proposed-unratified')
  }
  if (manifest.documents.length === 0) {
    throw new Error('CriticMarkup representative-document manifest is empty')
  }

  const ids = new Set<string>()
  const paths = new Set<string>()
  const coverage = new Set<CriticMarkupRepresentativeCoverage>()
  const expectedOrder = [...manifest.documents]
    .map(document => document.id)
    .sort((left, right) => left.localeCompare(right))

  if (manifest.documents.some((document, index) => document.id !== expectedOrder[index])) {
    throw new Error('CriticMarkup representative documents must be sorted by ID')
  }

  for (const document of manifest.documents) {
    if (!document.id.trim() || ids.has(document.id)) {
      throw new Error(`CriticMarkup representative document ID is invalid: ${document.id}`)
    }
    ids.add(document.id)

    if (isAbsolute(document.path) || paths.has(document.path)) {
      throw new Error(`CriticMarkup representative document path is invalid: ${document.path}`)
    }
    const absolutePath = resolve(repoRoot, document.path)
    const pathWithinRepo = relative(repoRoot, absolutePath)
    if (pathWithinRepo.startsWith('..') || isAbsolute(pathWithinRepo)) {
      throw new Error(`CriticMarkup representative document leaves the repository: ${document.path}`)
    }
    paths.add(document.path)

    const sourceBytes = readFileSync(absolutePath)
    const source = sourceBytes.toString('utf8')
    const actualHash = createHash('sha256').update(sourceBytes).digest('hex')
    if (actualHash !== document.sha256) {
      throw new Error(`CriticMarkup representative document hash is stale: ${document.id}`)
    }
    if (document.sourceUnits !== source.length) {
      throw new Error(`CriticMarkup representative document source-unit count is stale: ${document.id}`)
    }
    if (document.coverage.length === 0) {
      throw new Error(`CriticMarkup representative document has no coverage: ${document.id}`)
    }
    for (const surface of document.coverage) {
      if (!REQUIRED_COVERAGE.includes(surface)) {
        throw new Error(`Unknown representative-document coverage: ${surface}`)
      }
      coverage.add(surface)
      const evidence = document.evidence?.find(entry => entry.coverage === surface)
      if (!evidence?.anchor || !source.includes(evidence.anchor)) {
        throw new Error(
          `CriticMarkup representative document has no verified ${surface} anchor: ${document.id}`
        )
      }
    }
    if (document.coverage.includes('long-document') && source.length < 20_000) {
      throw new Error(`CriticMarkup representative long document is too small: ${document.id}`)
    }
    for (const asset of document.dependentAssets ?? []) {
      if (!asset.reference || !source.includes(asset.reference)) {
        throw new Error(`Representative asset is not referenced by ${document.id}`)
      }
      const assetPath = resolve(repoRoot, asset.path)
      const assetWithinRepo = relative(repoRoot, assetPath)
      if (assetWithinRepo.startsWith('..') || isAbsolute(assetWithinRepo)) {
        throw new Error(`Representative asset leaves the repository: ${asset.path}`)
      }
      const actualAssetHash = createHash('sha256')
        .update(readFileSync(assetPath))
        .digest('hex')
      if (actualAssetHash !== asset.sha256) {
        throw new Error(`Representative asset hash is stale: ${asset.path}`)
      }
    }
  }

  const missing = REQUIRED_COVERAGE.filter(surface => !coverage.has(surface))
  if (missing.length > 0) {
    throw new Error(`Representative-document coverage is missing: ${missing.join(', ')}`)
  }
}

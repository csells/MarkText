import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type CriticMarkupSalvageSnapshot = 'native' | 'research'
export type CriticMarkupSalvageChange = 'added' | 'modified' | 'deleted'

export interface CriticMarkupSalvageObject {
  mode: string
  oid: string
}

export interface CriticMarkupSalvageCandidate {
  id: string
  snapshot: CriticMarkupSalvageSnapshot
  path: string
  change: CriticMarkupSalvageChange
  before: CriticMarkupSalvageObject | null
  after: CriticMarkupSalvageObject | null
}

export interface CriticMarkupSalvageBaseline {
  schema: 'marktext-criticmarkup-salvage-candidates-v1'
  baselineCommit: string
  snapshots: Readonly<Record<CriticMarkupSalvageSnapshot, string>>
  summary: Readonly<{
    native: Readonly<Record<CriticMarkupSalvageChange | 'total', number>>
    research: Readonly<Record<CriticMarkupSalvageChange | 'total', number>>
    total: number
  }>
  candidates: CriticMarkupSalvageCandidate[]
}

export interface CriticMarkupSalvageDispositionAsset {
  id: string
  title: string
  disposition: 'import' | 'adapt' | 'supersede' | 'reject'
  rationale: string
  refs: string[]
  replacementRef?: string
  candidates: string[]
}

export interface CriticMarkupSalvageDispositionOverlay {
  schema: 'marktext-criticmarkup-salvage-dispositions-v1'
  baselineCommit: string
  snapshots: Readonly<Record<CriticMarkupSalvageSnapshot, string>>
  assets: CriticMarkupSalvageDispositionAsset[]
}

interface CollectOptions {
  baselineCommit: string
  snapshots: Readonly<Record<CriticMarkupSalvageSnapshot, string>>
}

const commitOid = (repoRoot: string, revision: string): string => {
  try {
    return execFileSync(
      'git',
      ['rev-parse', '--verify', `${revision}^{commit}`],
      { cwd: repoRoot, encoding: 'utf8' }
    ).trim()
  } catch {
    throw new Error(`CriticMarkup salvage revision is not a commit: ${revision}`)
  }
}

const isAncestor = (
  repoRoot: string,
  ancestor: string,
  descendant: string
): boolean => {
  try {
    execFileSync(
      'git',
      ['merge-base', '--is-ancestor', ancestor, descendant],
      { cwd: repoRoot, stdio: 'ignore' }
    )
    return true
  } catch {
    return false
  }
}

const parseRawDiff = (
  repoRoot: string,
  baselineCommit: string,
  snapshot: CriticMarkupSalvageSnapshot,
  snapshotCommit: string
): CriticMarkupSalvageCandidate[] => {
  const output = execFileSync('git', [
    'diff-tree', '-r', '--no-commit-id', '--raw', '-z', '--no-renames',
    '--abbrev=40', baselineCommit, snapshotCommit
  ], { cwd: repoRoot, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const fields = output.toString('utf8').split('\0')
  const candidates: CriticMarkupSalvageCandidate[] = []
  for (let index = 0; index < fields.length - 1; index += 2) {
    const metadata = fields[index]
    const path = fields[index + 1]
    if (!metadata || !path) throw new Error('CriticMarkup salvage raw diff is malformed')
    const match = metadata.match(
      /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([AMD])$/u
    )
    if (!match) throw new Error(`CriticMarkup salvage raw entry is unsupported: ${metadata}`)
    const [, beforeMode, afterMode, beforeOid, afterOid, status] = match
    const change: CriticMarkupSalvageChange = status === 'A'
      ? 'added'
      : status === 'M' ? 'modified' : 'deleted'
    const absent = '0'.repeat(40)
    candidates.push({
      id: `${snapshot}:${path}`,
      snapshot,
      path,
      change,
      before: beforeOid === absent ? null : { mode: beforeMode ?? '', oid: beforeOid ?? '' },
      after: afterOid === absent ? null : { mode: afterMode ?? '', oid: afterOid ?? '' }
    })
  }
  return candidates
}

export const collectCriticMarkupSalvageBaseline = (
  repoRoot: string,
  options: CollectOptions
): CriticMarkupSalvageBaseline => {
  const baselineCommit = commitOid(repoRoot, options.baselineCommit)
  const snapshots = {
    native: commitOid(repoRoot, options.snapshots.native),
    research: commitOid(repoRoot, options.snapshots.research)
  } as const
  if (
    !isAncestor(repoRoot, baselineCommit, snapshots.native) ||
    !isAncestor(repoRoot, snapshots.native, snapshots.research)
  ) {
    throw new Error('CriticMarkup salvage lineage must be baseline → native → research')
  }
  const candidates = (Object.entries(snapshots) as Array<[
    CriticMarkupSalvageSnapshot,
    string
  ]>).flatMap(([snapshot, commit]) =>
    parseRawDiff(repoRoot, baselineCommit, snapshot, commit)
  ).sort((left, right) => left.id.localeCompare(right.id))
  const counts = (snapshot: CriticMarkupSalvageSnapshot) => {
    const selected = candidates.filter(candidate => candidate.snapshot === snapshot)
    return {
      added: selected.filter(candidate => candidate.change === 'added').length,
      modified: selected.filter(candidate => candidate.change === 'modified').length,
      deleted: selected.filter(candidate => candidate.change === 'deleted').length,
      total: selected.length
    }
  }
  return {
    schema: 'marktext-criticmarkup-salvage-candidates-v1',
    baselineCommit,
    snapshots,
    summary: {
      native: counts('native'),
      research: counts('research'),
      total: candidates.length
    },
    candidates
  }
}

export const validateCriticMarkupSalvageDispositions = (
  baseline: CriticMarkupSalvageBaseline,
  overlay: CriticMarkupSalvageDispositionOverlay
): void => {
  if (baseline.schema !== 'marktext-criticmarkup-salvage-candidates-v1') {
    throw new Error('CriticMarkup salvage candidate schema is invalid')
  }
  if (overlay.schema !== 'marktext-criticmarkup-salvage-dispositions-v1') {
    throw new Error('CriticMarkup salvage disposition schema is invalid')
  }
  if (
    overlay.baselineCommit !== baseline.baselineCommit ||
    overlay.snapshots.native !== baseline.snapshots.native ||
    overlay.snapshots.research !== baseline.snapshots.research
  ) {
    throw new Error('CriticMarkup salvage dispositions target different Git objects')
  }
  const candidateIds = new Set(baseline.candidates.map(candidate => candidate.id))
  if (candidateIds.size !== baseline.candidates.length) {
    throw new Error('CriticMarkup salvage baseline has duplicate candidate IDs')
  }
  const disposed = new Set<string>()
  const assetIds = new Set<string>()
  for (const asset of overlay.assets) {
    if (
      !asset.id.trim() || assetIds.has(asset.id) ||
      !asset.title.trim() || !asset.rationale.trim()
    ) {
      throw new Error(`CriticMarkup salvage asset is incomplete: ${asset.id}`)
    }
    assetIds.add(asset.id)
    if (!(['import', 'adapt', 'supersede', 'reject'] as const).includes(asset.disposition)) {
      throw new Error(`CriticMarkup salvage asset ${asset.id} has invalid disposition`)
    }
    if (asset.refs.length === 0 || asset.refs.some(ref => !ref.trim())) {
      throw new Error(`CriticMarkup salvage asset ${asset.id} requires a reference`)
    }
    if (asset.disposition === 'supersede' && !asset.replacementRef?.trim()) {
      throw new Error(`CriticMarkup salvage asset ${asset.id} requires a replacement reference`)
    }
    if (asset.candidates.length === 0) {
      throw new Error(`CriticMarkup salvage asset ${asset.id} requires a candidate`)
    }
    for (const candidate of asset.candidates) {
      if (!candidateIds.has(candidate)) {
        throw new Error(`CriticMarkup salvage asset ${asset.id} has stale candidate ${candidate}`)
      }
      if (disposed.has(candidate)) {
        throw new Error(`CriticMarkup salvage candidate is disposed more than once: ${candidate}`)
      }
      disposed.add(candidate)
    }
  }
  const missing = baseline.candidates.filter(candidate => !disposed.has(candidate.id))
  if (missing.length > 0) {
    throw new Error(`${missing.length} salvage candidates are undisposed`)
  }
}

const readBaseline = (path: string): CriticMarkupSalvageBaseline =>
  JSON.parse(readFileSync(path, 'utf8')) as CriticMarkupSalvageBaseline

const readOverlay = (path: string): CriticMarkupSalvageDispositionOverlay =>
  JSON.parse(readFileSync(path, 'utf8')) as CriticMarkupSalvageDispositionOverlay

const generatedBaseline = (
  repoRoot: string,
  recorded: Pick<CriticMarkupSalvageBaseline, 'baselineCommit' | 'snapshots'>
): CriticMarkupSalvageBaseline => collectCriticMarkupSalvageBaseline(repoRoot, {
  baselineCommit: recorded.baselineCommit,
  snapshots: recorded.snapshots
})

const checkBaseline = (
  repoRoot: string,
  path: string
): CriticMarkupSalvageBaseline => {
  const recorded = readBaseline(path)
  const generated = generatedBaseline(repoRoot, recorded)
  if (JSON.stringify(recorded) !== JSON.stringify(generated)) {
    throw new Error('CriticMarkup salvage candidate baseline is stale; regenerate it')
  }
  return recorded
}

const runCli = (): void => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const baselinePath = resolve(
    repoRoot,
    'specs/baselines/criticmarkup-salvage-candidates.json'
  )
  const overlayPath = resolve(
    repoRoot,
    'specs/baselines/criticmarkup-salvage-dispositions.json'
  )
  const [command, baselineCommit, nativeCommit, researchCommit] = process.argv
    .slice(2)
    .filter(argument => argument !== '--')

  if (command === '--write' && baselineCommit && nativeCommit && researchCommit) {
    const baseline = collectCriticMarkupSalvageBaseline(repoRoot, {
      baselineCommit,
      snapshots: { native: nativeCommit, research: researchCommit }
    })
    mkdirSync(dirname(baselinePath), { recursive: true })
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    return
  }
  if (command === '--check') {
    checkBaseline(repoRoot, baselinePath)
    return
  }
  if (command === '--validate') {
    validateCriticMarkupSalvageDispositions(
      checkBaseline(repoRoot, baselinePath),
      readOverlay(overlayPath)
    )
    return
  }
  throw new Error(
    'Usage: tsx scripts/criticmarkupSalvageBaseline.ts ' +
    '--write <baseline-commit> <native-commit> <research-commit> | --check | --validate'
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}

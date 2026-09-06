import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  CriticMarkupParityBaseline,
  CriticMarkupParityDisposition,
  CriticMarkupParityDispositionOverlay,
  CriticMarkupParityRowManifest
} from './criticmarkupParityBaseline'
import type {
  CriticMarkupSalvageBaseline,
  CriticMarkupSalvageCandidate,
  CriticMarkupSalvageChange,
  CriticMarkupSalvageDispositionOverlay,
  CriticMarkupSalvageObject,
  CriticMarkupSalvageSnapshot
} from './criticmarkupSalvageBaseline'
import {
  type CriticMarkupPerformanceMeasurementManifest,
  requireCriticMarkupPerformanceEvidenceForRatification
} from './criticmarkupPerformanceMeasurements'

type ProposedParityDisposition =
  | 'parity-row'
  | 'unaffected'
  | 'approved-decision'

export interface CriticMarkupParityProposalGroup {
  id: string
  kinds: string[]
  proposedDisposition: ProposedParityDisposition
  proposedRef: string
  rationale: string
  refs: string[]
  expectedCount: number
  itemIdsSha256: string
}

export interface CriticMarkupParityItemCompatibilityDecision {
  itemId: string
  approvalDecisionId: 'parity-manifest'
  proposedDisposition: 'approved-decision'
  proposedRef: string
  mechanicalFinding: string
  ownerQuestion: string
  refs: string[]
}

export interface CriticMarkupParityProposal {
  schema: 'marktext-criticmarkup-parity-proposal-v2'
  status: 'proposed-unapproved'
  baselineCommit: string
  groups: CriticMarkupParityProposalGroup[]
  itemCompatibilityDecisions: CriticMarkupParityItemCompatibilityDecision[]
}

const auditedReadmeCompatibilityDecisionRefs = {
  'readme-feature:ada27f4ce6a3': 'readme-wysiwyg-subjective-outcome',
  'readme-feature:0b8caa1ea286': 'readme-shortcut-efficiency-subjective-outcome',
  'muya-readme-feature:57b5c6a23c6a': 'muya-collaborative-transport-scope'
} as const
const auditedReadmeCompatibilityDecisionIds = Object.keys(
  auditedReadmeCompatibilityDecisionRefs
)

export type CriticMarkupParitySourceRelation =
  | 'unchanged'
  | 'changed'
  | 'missing'

export type CriticMarkupParityProposedOracle =
  | 'retained-upstream-test'
  | 'retained-manual-oracle'
  | 'new-production-path-test'
  | 'owner-decision'
  | 'unaffected'

export interface CriticMarkupParityOracleProposalGroup {
  id: string
  kinds: string[]
  sourceRelations: CriticMarkupParitySourceRelation[]
  proposedOracle: CriticMarkupParityProposedOracle
  namedProductionPathTests?: Record<string, string>
  rationale: string
  refs: string[]
  expectedCount: number
  itemIdsSha256: string
}

export interface CriticMarkupParityOracleProposal {
  schema: 'marktext-criticmarkup-parity-oracle-proposal-v1'
  status: 'proposed-unapproved'
  baselineCommit: string
  evidenceCommit: string
  groups: CriticMarkupParityOracleProposalGroup[]
}

export type CriticMarkupSalvageEvidenceRelation =
  | 'matches-snapshot'
  | 'matches-upstream'
  | 'diverged'
  | 'absent'

export interface CriticMarkupSalvageProposalGroup {
  id: string
  snapshot: CriticMarkupSalvageSnapshot
  change: CriticMarkupSalvageChange
  evidenceRelation: CriticMarkupSalvageEvidenceRelation
  proposedDisposition: 'import' | 'adapt' | 'supersede' | 'reject'
  proposedReplacementRef?: string
  rationale: string
  refs: string[]
  expectedCount: number
  candidateIdsSha256: string
}

export interface CriticMarkupSalvageProposal {
  schema: 'marktext-criticmarkup-salvage-proposal-v1'
  status: 'proposed-unapproved'
  baselineCommit: string
  snapshots: Readonly<Record<CriticMarkupSalvageSnapshot, string>>
  evidenceCommit: string
  groups: CriticMarkupSalvageProposalGroup[]
}

export interface CriticMarkupPhase0Evidence {
  id: string
  path: string
  sha256: string
}

export interface CriticMarkupPhase0Decision {
  id: string
  status: 'pending-owner-decision' | 'approved'
  question: string
  proposal: string
  evidenceRefs: string[]
  decidedBy?: string
  decidedAt?: string
  rationale?: string
}

export interface CriticMarkupPhase0Approval {
  schema: 'marktext-criticmarkup-phase0-approval-v1'
  status: 'proposed-unapproved' | 'ratified'
  baselineCommit: string
  evidenceCommit: string
  evidence: CriticMarkupPhase0Evidence[]
  decisions: CriticMarkupPhase0Decision[]
}

export interface CriticMarkupPhase0MaterializationInput {
  parityBaseline: CriticMarkupParityBaseline
  parityProposal: CriticMarkupParityProposal
  parityOracleProposal: CriticMarkupParityOracleProposal
  salvageBaseline: CriticMarkupSalvageBaseline
  salvageProposal: CriticMarkupSalvageProposal
  approval: CriticMarkupPhase0Approval
}

export interface CriticMarkupPhase0Materialization {
  parityOverlay: CriticMarkupParityDispositionOverlay
  parityRows: CriticMarkupParityRowManifest
  salvageOverlay: CriticMarkupSalvageDispositionOverlay
}

const sha256 = (value: string | Buffer): string => createHash('sha256')
  .update(value)
  .digest('hex')

const identifierDigest = (ids: string[]): string => sha256(
  [...ids].sort().join('\n')
)

const nonEmpty = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value
}

const stringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.some(entry => (
    typeof entry !== 'string' || !entry.trim()
  ))) {
    throw new Error(`${label} requires at least one non-empty entry`)
  }
  return value
}

const requireSha256 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`)
  }
  return value
}

export const validateCriticMarkupParityProposal = (
  baseline: CriticMarkupParityBaseline,
  proposal: CriticMarkupParityProposal
): void => {
  if (baseline.schema !== 'marktext-criticmarkup-parity-baseline-v1') {
    throw new Error('CriticMarkup parity baseline schema is invalid')
  }
  if (proposal.schema !== 'marktext-criticmarkup-parity-proposal-v2') {
    throw new Error('CriticMarkup parity proposal schema is invalid')
  }
  if (proposal.status !== 'proposed-unapproved') {
    throw new Error('CriticMarkup parity proposal must remain proposed-unapproved')
  }
  if (proposal.baselineCommit !== baseline.baselineCommit) {
    throw new Error('CriticMarkup parity proposal targets a different upstream baseline')
  }

  const knownKinds = new Set(baseline.sources.map(source => source.kind))
  const proposedItems = new Set<string>()
  const groupIds = new Set<string>()
  const proposedKinds = new Set<string>()
  for (const group of proposal.groups) {
    if (!group.id.trim() || groupIds.has(group.id)) {
      throw new Error(`CriticMarkup parity proposal group is missing or duplicated: ${group.id}`)
    }
    groupIds.add(group.id)
    nonEmpty(group.proposedRef, `Parity proposal ${group.id} reference`)
    nonEmpty(group.rationale, `Parity proposal ${group.id} rationale`)
    stringArray(group.refs, `Parity proposal ${group.id} evidence`)
    if (!(['parity-row', 'unaffected', 'approved-decision'] as const)
      .includes(group.proposedDisposition)) {
      throw new Error(`Parity proposal ${group.id} has invalid proposed disposition`)
    }

    const kinds = stringArray(group.kinds, `Parity proposal ${group.id} kinds`)
    for (const kind of kinds) {
      if (!knownKinds.has(kind)) {
        throw new Error(`Parity proposal ${group.id} has unknown source kind ${kind}`)
      }
      if (proposedKinds.has(kind)) {
        throw new Error(`Parity source kind has more than one proposal: ${kind}`)
      }
      proposedKinds.add(kind)
    }
    const selected = baseline.items.filter(item => kinds.includes(item.kind))
    if (selected.length !== group.expectedCount) {
      throw new Error(`Parity proposal ${group.id} item count is stale`)
    }
    if (identifierDigest(selected.map(item => item.id)) !== group.itemIdsSha256) {
      throw new Error(`Parity proposal ${group.id} item-ID digest is stale`)
    }
    selected.forEach(item => proposedItems.add(item.id))
  }

  const missing = baseline.items.filter(item => !proposedItems.has(item.id))
  if (missing.length > 0) {
    throw new Error(`${missing.length} upstream parity items have no proposal`)
  }

  if (!Array.isArray(proposal.itemCompatibilityDecisions)) {
    throw new Error(
      'CriticMarkup parity item compatibility-decision set is incomplete or stale'
    )
  }
  const compatibilityDecisionIds = proposal.itemCompatibilityDecisions
    .map(decision => decision.itemId)
  const uniqueCompatibilityDecisionIds = new Set(compatibilityDecisionIds)
  const missingCompatibilityDecisions = auditedReadmeCompatibilityDecisionIds.filter(id => (
    !uniqueCompatibilityDecisionIds.has(id)
  ))
  const staleCompatibilityDecisions = compatibilityDecisionIds.filter(id => (
    !auditedReadmeCompatibilityDecisionIds.includes(
      id as typeof auditedReadmeCompatibilityDecisionIds[number]
    )
  ))
  if (
    uniqueCompatibilityDecisionIds.size !== compatibilityDecisionIds.length ||
    missingCompatibilityDecisions.length > 0 ||
    staleCompatibilityDecisions.length > 0
  ) {
    throw new Error(
      'CriticMarkup parity item compatibility-decision set is incomplete or stale'
    )
  }
  const itemIds = new Set(baseline.items.map(item => item.id))
  for (const decision of proposal.itemCompatibilityDecisions) {
    if (!itemIds.has(decision.itemId)) {
      throw new Error(`Parity item compatibility decision is unknown: ${decision.itemId}`)
    }
    if (
      decision.approvalDecisionId !== 'parity-manifest' ||
      decision.proposedDisposition !== 'approved-decision' ||
      decision.proposedRef !== auditedReadmeCompatibilityDecisionRefs[
        decision.itemId as keyof typeof auditedReadmeCompatibilityDecisionRefs
      ]
    ) {
      throw new Error(
        `Parity item compatibility decision ${decision.itemId} ` +
        'does not match its audited proposal binding'
      )
    }
    nonEmpty(
      decision.mechanicalFinding,
      `Parity item compatibility decision ${decision.itemId} mechanical finding`
    )
    nonEmpty(
      decision.ownerQuestion,
      `Parity item compatibility decision ${decision.itemId} owner question`
    )
    stringArray(decision.refs, `Parity item compatibility decision ${decision.itemId} evidence`)
  }
}

const requireFullCommit = (
  repoRoot: string,
  revision: string,
  label: string
): string => {
  let commit: string
  try {
    commit = execFileSync(
      'git',
      ['rev-parse', '--verify', `${revision}^{commit}`],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim()
  } catch {
    throw new Error(`CriticMarkup Phase 0 ${label} revision is not a commit: ${revision}`)
  }
  if (commit !== revision) {
    throw new Error(`CriticMarkup Phase 0 must pin a full ${label} commit`)
  }
  return commit
}

const requireCommitAncestor = (
  repoRoot: string,
  ancestor: string,
  descendant: string,
  label: string
): void => {
  try {
    execFileSync(
      'git',
      ['merge-base', '--is-ancestor', ancestor, descendant],
      { cwd: repoRoot, stdio: 'ignore' }
    )
  } catch {
    throw new Error(`CriticMarkup Phase 0 ${label} must be an ancestor of the working baseline`)
  }
}

const listTree = (
  repoRoot: string,
  revision: string,
  label = 'evidence'
): Map<string, CriticMarkupSalvageObject> => {
  const commit = requireFullCommit(repoRoot, revision, label)
  const output = execFileSync(
    'git',
    ['ls-tree', '-r', '-z', '--full-tree', commit],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  const tree = new Map<string, CriticMarkupSalvageObject>()
  for (const entry of output.split('\0').filter(Boolean)) {
    const match = entry.match(/^(\d+) \w+ ([0-9a-f]{40})\t(.*)$/su)
    if (!match) throw new Error('CriticMarkup Phase 0 evidence tree is malformed')
    tree.set(match[3] ?? '', { mode: match[1] ?? '', oid: match[2] ?? '' })
  }
  return tree
}

const sameObject = (
  left: CriticMarkupSalvageObject | null,
  right: CriticMarkupSalvageObject | null
): boolean => left === null || right === null
  ? left === right
  : left.mode === right.mode && left.oid === right.oid

const paritySourceRelation = (
  source: string,
  baselineTree: Map<string, CriticMarkupSalvageObject>,
  evidenceTree: Map<string, CriticMarkupSalvageObject>
): CriticMarkupParitySourceRelation => {
  const baselineObject = baselineTree.get(source) ?? null
  const evidenceObject = evidenceTree.get(source) ?? null
  if (evidenceObject === null) return 'missing'
  return sameObject(baselineObject, evidenceObject) ? 'unchanged' : 'changed'
}

const retainedTestKinds = new Set([
  'desktopUnitTest',
  'desktopE2eTest',
  'muyaUnitTest',
  'muyaE2eTest'
])

const ownerDecisionKinds = new Set([
  'deferredTest',
  'backlogItem',
  'disabledCommand'
])

export const validateCriticMarkupParityOracleProposal = (
  repoRoot: string,
  baseline: CriticMarkupParityBaseline,
  proposal: CriticMarkupParityOracleProposal
): void => {
  if (baseline.schema !== 'marktext-criticmarkup-parity-baseline-v1') {
    throw new Error('CriticMarkup parity baseline schema is invalid')
  }
  if (proposal.schema !== 'marktext-criticmarkup-parity-oracle-proposal-v1') {
    throw new Error('CriticMarkup parity oracle proposal schema is invalid')
  }
  if (proposal.status !== 'proposed-unapproved') {
    throw new Error('CriticMarkup parity oracle proposal must remain proposed-unapproved')
  }
  if (proposal.baselineCommit !== baseline.baselineCommit) {
    throw new Error('CriticMarkup parity oracle proposal targets a different baseline')
  }
  const baselineTree = listTree(repoRoot, baseline.baselineCommit, 'baseline')
  const evidenceTree = listTree(repoRoot, proposal.evidenceCommit, 'evidence')
  const knownKinds = new Set(baseline.sources.map(source => source.kind))
  const selectedItems = new Set<string>()
  const groupIds = new Set<string>()
  for (const group of proposal.groups) {
    if (!group.id.trim() || groupIds.has(group.id)) {
      throw new Error(`Parity oracle proposal group is missing or duplicated: ${group.id}`)
    }
    groupIds.add(group.id)
    const kinds = stringArray(group.kinds, `Parity oracle proposal ${group.id} kinds`)
    const relations = stringArray(
      group.sourceRelations,
      `Parity oracle proposal ${group.id} source relations`
    ) as CriticMarkupParitySourceRelation[]
    for (const kind of kinds) {
      if (!knownKinds.has(kind)) {
        throw new Error(`Parity oracle proposal ${group.id} has unknown kind ${kind}`)
      }
    }
    for (const relation of relations) {
      if (!(['unchanged', 'changed', 'missing'] as const).includes(relation)) {
        throw new Error(`Parity oracle proposal ${group.id} has invalid source relation`)
      }
    }
    if (!([
      'retained-upstream-test',
      'retained-manual-oracle',
      'new-production-path-test',
      'owner-decision',
      'unaffected'
    ] as const).includes(group.proposedOracle)) {
      throw new Error(`Parity oracle proposal ${group.id} has invalid oracle class`)
    }
    nonEmpty(group.rationale, `Parity oracle proposal ${group.id} rationale`)
    stringArray(group.refs, `Parity oracle proposal ${group.id} evidence`)
    if (
      group.proposedOracle === 'retained-upstream-test' &&
      (kinds.some(kind => !retainedTestKinds.has(kind)) ||
        relations.some(relation => relation !== 'unchanged'))
    ) {
      throw new Error(
        `Parity oracle proposal ${group.id} cannot claim a retained upstream test`
      )
    }
    if (
      group.proposedOracle === 'retained-manual-oracle' &&
      (kinds.some(kind => kind !== 'manualParityCase') ||
        relations.some(relation => relation !== 'unchanged'))
    ) {
      throw new Error(
        `Parity oracle proposal ${group.id} cannot claim a retained manual oracle`
      )
    }
    if (
      group.proposedOracle === 'owner-decision' &&
      kinds.some(kind => !ownerDecisionKinds.has(kind))
    ) {
      throw new Error(
        `Parity oracle proposal ${group.id} cannot replace executable evidence with an owner decision`
      )
    }
    const selected = baseline.items.filter(item => (
      kinds.includes(item.kind) &&
      relations.includes(paritySourceRelation(item.source, baselineTree, evidenceTree))
    ))
    if (selected.length !== group.expectedCount) {
      throw new Error(`Parity oracle proposal ${group.id} item count is stale`)
    }
    if (identifierDigest(selected.map(item => item.id)) !== group.itemIdsSha256) {
      throw new Error(`Parity oracle proposal ${group.id} item-ID digest is stale`)
    }
    const namedProductionPathTests = group.namedProductionPathTests ?? {}
    if (
      typeof namedProductionPathTests !== 'object' ||
      namedProductionPathTests === null ||
      Array.isArray(namedProductionPathTests)
    ) {
      throw new Error(`Parity oracle proposal ${group.id} named production paths are invalid`)
    }
    const selectedIds = new Set(selected.map(item => item.id))
    for (const [itemId, productionPathTest] of Object.entries(namedProductionPathTests)) {
      if (group.proposedOracle !== 'new-production-path-test' || !selectedIds.has(itemId)) {
        throw new Error(
          `Parity oracle proposal ${group.id} has a named production path for an unselected item`
        )
      }
      nonEmpty(
        productionPathTest,
        `Parity oracle proposal ${group.id} named production path for ${itemId}`
      )
    }
    for (const item of selected) {
      if (selectedItems.has(item.id)) {
        throw new Error(`Parity item has more than one oracle proposal: ${item.id}`)
      }
      selectedItems.add(item.id)
    }
  }
  const missing = baseline.items.filter(item => !selectedItems.has(item.id))
  if (missing.length > 0) {
    throw new Error(`${missing.length} upstream parity items have no oracle proposal`)
  }
}

const evidenceRelation = (
  candidate: CriticMarkupSalvageCandidate,
  tree: Map<string, CriticMarkupSalvageObject>
): CriticMarkupSalvageEvidenceRelation => {
  const current = tree.get(candidate.path) ?? null
  if (sameObject(current, candidate.after)) return 'matches-snapshot'
  if (sameObject(current, candidate.before)) return 'matches-upstream'
  return current === null ? 'absent' : 'diverged'
}

const selectSalvageCandidates = (
  baseline: CriticMarkupSalvageBaseline,
  group: CriticMarkupSalvageProposalGroup,
  tree: Map<string, CriticMarkupSalvageObject>
): CriticMarkupSalvageCandidate[] => baseline.candidates.filter(candidate => (
  candidate.snapshot === group.snapshot &&
  candidate.change === group.change &&
  evidenceRelation(candidate, tree) === group.evidenceRelation
))

export const validateCriticMarkupSalvageProposal = (
  repoRoot: string,
  baseline: CriticMarkupSalvageBaseline,
  proposal: CriticMarkupSalvageProposal
): void => {
  if (baseline.schema !== 'marktext-criticmarkup-salvage-candidates-v1') {
    throw new Error('CriticMarkup salvage candidate schema is invalid')
  }
  if (proposal.schema !== 'marktext-criticmarkup-salvage-proposal-v1') {
    throw new Error('CriticMarkup salvage proposal schema is invalid')
  }
  if (proposal.status !== 'proposed-unapproved') {
    throw new Error('CriticMarkup salvage proposal must remain proposed-unapproved')
  }
  if (
    proposal.baselineCommit !== baseline.baselineCommit ||
    proposal.snapshots.native !== baseline.snapshots.native ||
    proposal.snapshots.research !== baseline.snapshots.research
  ) {
    throw new Error('CriticMarkup salvage proposal targets different Git objects')
  }
  const tree = listTree(repoRoot, proposal.evidenceCommit)
  const proposedCandidates = new Set<string>()
  const groupIds = new Set<string>()
  const selectors = new Set<string>()
  for (const group of proposal.groups) {
    if (!group.id.trim() || groupIds.has(group.id)) {
      throw new Error(`CriticMarkup salvage proposal group is missing or duplicated: ${group.id}`)
    }
    groupIds.add(group.id)
    nonEmpty(group.rationale, `Salvage proposal ${group.id} rationale`)
    stringArray(group.refs, `Salvage proposal ${group.id} evidence`)
    if (!(['native', 'research'] as const).includes(group.snapshot)) {
      throw new Error(`Salvage proposal ${group.id} has invalid snapshot`)
    }
    if (!(['added', 'modified', 'deleted'] as const).includes(group.change)) {
      throw new Error(`Salvage proposal ${group.id} has invalid change`)
    }
    if (!(['matches-snapshot', 'matches-upstream', 'diverged', 'absent'] as const)
      .includes(group.evidenceRelation)) {
      throw new Error(`Salvage proposal ${group.id} has invalid evidence relation`)
    }
    if (!(['import', 'adapt', 'supersede', 'reject'] as const)
      .includes(group.proposedDisposition)) {
      throw new Error(`Salvage proposal ${group.id} has invalid proposed disposition`)
    }
    if (
      group.proposedDisposition === 'supersede' &&
      !group.proposedReplacementRef?.trim()
    ) {
      throw new Error(`Salvage proposal ${group.id} requires a replacement reference`)
    }
    const selector = [group.snapshot, group.change, group.evidenceRelation].join(':')
    if (selectors.has(selector)) {
      throw new Error(`Salvage evidence selector has more than one proposal: ${selector}`)
    }
    selectors.add(selector)
    const selected = selectSalvageCandidates(baseline, group, tree)
    if (selected.length !== group.expectedCount) {
      throw new Error(`Salvage proposal ${group.id} candidate count is stale`)
    }
    if (identifierDigest(selected.map(candidate => candidate.id)) !== group.candidateIdsSha256) {
      throw new Error(`Salvage proposal ${group.id} candidate-ID digest is stale`)
    }
    selected.forEach(candidate => proposedCandidates.add(candidate.id))
  }
  const missing = baseline.candidates.filter(candidate => !proposedCandidates.has(candidate.id))
  if (missing.length > 0) {
    throw new Error(`${missing.length} salvage candidates have no proposal`)
  }
}

const requiredDecisionIds = [
  'working-baseline',
  'upstream-oracle-run',
  'parity-manifest',
  'language-profile-and-adrs',
  'interaction-matrix',
  'representative-documents',
  'performance-targets',
  'salvage-inventory'
] as const

/** Historical packet validator; plan 0011 no longer requires packet approval. */
export const validateCriticMarkupPhase0ApprovalProposal = (
  repoRoot: string,
  approval: CriticMarkupPhase0Approval
): void => {
  if (approval.schema !== 'marktext-criticmarkup-phase0-approval-v1') {
    throw new Error('CriticMarkup Phase 0 approval schema is invalid')
  }
  if (!(['proposed-unapproved', 'ratified'] as const).includes(approval.status)) {
    throw new Error('CriticMarkup Phase 0 approval status is invalid')
  }
  nonEmpty(approval.baselineCommit, 'Phase 0 baseline commit')
  nonEmpty(approval.evidenceCommit, 'Phase 0 evidence commit')
  requireFullCommit(repoRoot, approval.baselineCommit, 'baseline')
  requireFullCommit(repoRoot, approval.evidenceCommit, 'evidence')

  const evidenceIds = new Set<string>()
  for (const evidence of approval.evidence) {
    if (!evidence.id.trim() || evidenceIds.has(evidence.id)) {
      throw new Error(`CriticMarkup Phase 0 evidence is missing or duplicated: ${evidence.id}`)
    }
    evidenceIds.add(evidence.id)
    const relativePath = nonEmpty(evidence.path, `Phase 0 evidence ${evidence.id} path`)
    const absolutePath = resolve(repoRoot, relativePath)
    if (absolutePath !== repoRoot && !absolutePath.startsWith(`${repoRoot}${sep}`)) {
      throw new Error(`Phase 0 evidence escapes the repository: ${relativePath}`)
    }
    const expectedDigest = requireSha256(
      evidence.sha256,
      `Phase 0 evidence ${evidence.id} digest`
    )
    const actualDigest = sha256(readFileSync(absolutePath))
    if (actualDigest !== expectedDigest) {
      throw new Error(`Phase 0 evidence digest is stale: ${evidence.id}`)
    }
  }

  const decisions = new Map<string, CriticMarkupPhase0Decision>()
  for (const decision of approval.decisions) {
    if (!decision.id.trim() || decisions.has(decision.id)) {
      throw new Error(`CriticMarkup Phase 0 decision is missing or duplicated: ${decision.id}`)
    }
    decisions.set(decision.id, decision)
    nonEmpty(decision.question, `Phase 0 decision ${decision.id} question`)
    nonEmpty(decision.proposal, `Phase 0 decision ${decision.id} proposal`)
    const refs = stringArray(
      decision.evidenceRefs,
      `Phase 0 decision ${decision.id} evidence`
    )
    for (const ref of refs) {
      if (!evidenceIds.has(ref)) {
        throw new Error(`Phase 0 decision ${decision.id} has unknown evidence ${ref}`)
      }
    }
    if (decision.status !== 'pending-owner-decision' && decision.status !== 'approved') {
      throw new Error(`Phase 0 decision ${decision.id} has invalid status`)
    }
    if (decision.status === 'approved') {
      nonEmpty(decision.decidedBy, `Phase 0 decision ${decision.id} owner`)
      nonEmpty(decision.decidedAt, `Phase 0 decision ${decision.id} timestamp`)
      nonEmpty(decision.rationale, `Phase 0 decision ${decision.id} rationale`)
    }
  }
  const missingDecisions = requiredDecisionIds.filter(id => !decisions.has(id))
  const staleDecisions = [...decisions.keys()].filter(id => (
    !requiredDecisionIds.includes(id as typeof requiredDecisionIds[number])
  ))
  if (missingDecisions.length > 0 || staleDecisions.length > 0) {
    throw new Error(
      'CriticMarkup Phase 0 decision set is incomplete or stale: ' +
      `missing ${missingDecisions.length}, stale ${staleDecisions.length}`
    )
  }
  const performanceDecision = decisions.get('performance-targets')
  if (performanceDecision?.status === 'approved') {
    const performanceEvidence = approval.evidence.find(evidence => (
      evidence.id === 'performance-measurements'
    ))
    if (
      performanceEvidence === undefined ||
      !performanceDecision.evidenceRefs.includes(performanceEvidence.id)
    ) {
      throw new Error(
        'Approved performance targets must reference the performance measurement manifest'
      )
    }
    const performanceManifest = JSON.parse(readFileSync(
      resolve(repoRoot, performanceEvidence.path),
      'utf8'
    )) as CriticMarkupPerformanceMeasurementManifest
    if (performanceManifest.baselineCommit !== approval.baselineCommit) {
      throw new Error(
        'Performance measurement baseline must equal the Phase 0 baseline'
      )
    }
    const calibrationEvidence = approval.evidence.find(evidence => (
      evidence.id === 'performance-calibration'
    ))
    if (
      calibrationEvidence === undefined ||
      !performanceDecision.evidenceRefs.includes(calibrationEvidence.id)
    ) {
      throw new Error(
        'Approved performance targets must reference the authenticated calibration report'
      )
    }
    requireCriticMarkupPerformanceEvidenceForRatification(
      repoRoot,
      performanceManifest,
      {
        path: calibrationEvidence.path,
        sha256: calibrationEvidence.sha256
      }
    )
  }
  const pending = approval.decisions.filter(decision => (
    decision.status === 'pending-owner-decision'
  ))
  if (approval.status === 'ratified' && pending.length > 0) {
    throw new Error('CriticMarkup Phase 0 cannot be ratified while owner decisions are pending')
  }
  if (approval.status === 'proposed-unapproved' && pending.length === 0) {
    throw new Error('CriticMarkup Phase 0 is fully decided but the approval status is unratified')
  }
}

export const requireCriticMarkupPhase0Approval = (
  repoRoot: string,
  approval: CriticMarkupPhase0Approval
): void => {
  validateCriticMarkupPhase0ApprovalProposal(repoRoot, approval)
  const pending = approval.decisions.filter(decision => (
    decision.status === 'pending-owner-decision'
  ))
  if (pending.length > 0) {
    throw new Error(
      `${pending.length} Phase 0 decisions require explicit owner approval: ` +
      pending.map(decision => decision.id).join(', ')
    )
  }
  if (approval.status !== 'ratified') {
    throw new Error('CriticMarkup Phase 0 approval is not ratified')
  }
}

/**
 * Converts a fully approved proposal packet into the existing human-owned
 * parity and salvage schemas. This function is pure and never writes those
 * artifacts; callers choose where to persist an approved result.
 */
export const materializeCriticMarkupPhase0Dispositions = (
  repoRoot: string,
  input: CriticMarkupPhase0MaterializationInput
): CriticMarkupPhase0Materialization => {
  requireCriticMarkupPhase0Approval(repoRoot, input.approval)
  if (input.approval.baselineCommit !== input.parityBaseline.baselineCommit) {
    throw new Error('Phase 0 approval targets a different disposition baseline')
  }
  requireCommitAncestor(
    repoRoot,
    input.salvageBaseline.baselineCommit,
    input.approval.baselineCommit,
    'salvage lineage baseline'
  )
  if (input.approval.evidenceCommit !== input.salvageProposal.evidenceCommit) {
    throw new Error('Phase 0 approval targets a different salvage evidence commit')
  }
  validateCriticMarkupParityProposal(input.parityBaseline, input.parityProposal)
  validateCriticMarkupParityOracleProposal(
    repoRoot,
    input.parityBaseline,
    input.parityOracleProposal
  )
  validateCriticMarkupSalvageProposal(
    repoRoot,
    input.salvageBaseline,
    input.salvageProposal
  )

  const parityGroupByKind = new Map<string, CriticMarkupParityProposalGroup>()
  for (const group of input.parityProposal.groups) {
    group.kinds.forEach(kind => parityGroupByKind.set(kind, group))
  }
  const baselineTree = listTree(repoRoot, input.parityBaseline.baselineCommit, 'baseline')
  const evidenceTree = listTree(repoRoot, input.parityOracleProposal.evidenceCommit, 'evidence')
  const oracleGroupByItem = new Map<string, CriticMarkupParityOracleProposalGroup>()
  for (const group of input.parityOracleProposal.groups) {
    for (const item of input.parityBaseline.items) {
      if (
        group.kinds.includes(item.kind) &&
        group.sourceRelations.includes(paritySourceRelation(
          item.source,
          baselineTree,
          evidenceTree
        ))
      ) {
        oracleGroupByItem.set(item.id, group)
      }
    }
  }
  const dispositions: Record<string, CriticMarkupParityDisposition> = {}
  const rows: CriticMarkupParityRowManifest['rows'] = []
  const itemCompatibilityDecisionById = new Map(
    input.parityProposal.itemCompatibilityDecisions.map(decision => [
      decision.itemId,
      decision
    ])
  )
  for (const item of input.parityBaseline.items) {
    const group = parityGroupByKind.get(item.kind)
    if (!group) throw new Error(`Parity item has no materialization group: ${item.id}`)
    const itemCompatibilityDecision = itemCompatibilityDecisionById.get(item.id)
    if (itemCompatibilityDecision !== undefined) {
      const approvalDecision = input.approval.decisions.find(decision => (
        decision.id === itemCompatibilityDecision.approvalDecisionId
      ))
      if (
        input.approval.status !== 'ratified' ||
        approvalDecision?.status !== 'approved'
      ) {
        throw new Error(
          `Parity item compatibility decision is not ratified: ${item.id}`
        )
      }
      dispositions[item.id] = {
        kind: 'approved-decision',
        ref: 'specs/baselines/criticmarkup-phase0-approval.json#' +
          `${itemCompatibilityDecision.approvalDecisionId}:` +
          itemCompatibilityDecision.proposedRef
      }
      continue
    }
    const oracleGroup = oracleGroupByItem.get(item.id)
    if (!oracleGroup) throw new Error(`Parity item has no oracle materialization group: ${item.id}`)
    if (group.proposedDisposition === 'parity-row') {
      if (
        oracleGroup.proposedOracle === 'owner-decision' ||
        oracleGroup.proposedOracle === 'unaffected'
      ) {
        throw new Error(`Parity item has incompatible disposition and oracle proposals: ${item.id}`)
      }
      const rowId = `phase0.item.${sha256(item.id).slice(0, 24)}`
      const line = typeof item.attributes?.line === 'number'
        ? `:${item.attributes.line}`
        : ''
      const namedProductionPathTest = oracleGroup.namedProductionPathTests?.[item.id]
      rows.push({
        id: rowId,
        upstreamBehavior: `${item.kind}: ${item.label}`,
        existingOracle: `${item.source}${line}`,
        productionPathTest: oracleGroup.proposedOracle === 'retained-upstream-test'
          ? `retained-upstream-test: ${item.source}; release-candidate execution pending`
          : oracleGroup.proposedOracle === 'retained-manual-oracle'
            ? `retained-manual-oracle: ${item.source}; supported-platform execution pending`
            : namedProductionPathTest === undefined
              ? `required-new-production-path-test: ${item.id}; no oracle is claimed`
              : `named-production-path-test: ${namedProductionPathTest}`,
        status: 'planned'
      })
      dispositions[item.id] = { kind: 'parity-row', ref: rowId }
    } else if (group.proposedDisposition === 'unaffected') {
      if (oracleGroup.proposedOracle !== 'unaffected') {
        throw new Error(`Parity item has incompatible unaffected proposal: ${item.id}`)
      }
      dispositions[item.id] = {
        kind: 'unaffected',
        rationale: group.rationale
      }
    } else {
      if (oracleGroup.proposedOracle !== 'owner-decision') {
        throw new Error(`Parity item has incompatible owner-decision proposal: ${item.id}`)
      }
      dispositions[item.id] = {
        kind: 'approved-decision',
        ref: `specs/baselines/criticmarkup-phase0-approval.json#parity-manifest:${group.proposedRef}`
      }
    }
  }
  rows.sort((left, right) => left.id.localeCompare(right.id))

  const tree = listTree(repoRoot, input.salvageProposal.evidenceCommit)
  const assets: CriticMarkupSalvageDispositionOverlay['assets'] = [
    ...input.salvageProposal.groups
  ].sort((left, right) => left.id.localeCompare(right.id)).map(group => ({
    id: `proposal.${group.id}`,
    title: `Proposed salvage group: ${group.id}`,
    disposition: group.proposedDisposition,
    rationale: group.rationale,
    refs: [
      ...group.refs,
      'specs/baselines/criticmarkup-phase0-approval.json#salvage-inventory'
    ],
    ...(group.proposedReplacementRef
      ? { replacementRef: group.proposedReplacementRef }
      : {}),
    candidates: selectSalvageCandidates(
      input.salvageBaseline,
      group,
      tree
    ).map(candidate => candidate.id)
  }))

  return {
    parityOverlay: {
      schema: 'marktext-criticmarkup-parity-dispositions-v1',
      baselineCommit: input.parityBaseline.baselineCommit,
      dispositions
    },
    parityRows: {
      schema: 'marktext-criticmarkup-parity-rows-v1',
      baselineCommit: input.parityBaseline.baselineCommit,
      rows
    },
    salvageOverlay: {
      schema: 'marktext-criticmarkup-salvage-dispositions-v1',
      baselineCommit: input.salvageBaseline.baselineCommit,
      snapshots: input.salvageBaseline.snapshots,
      assets
    }
  }
}

const readJson = <Artifact>(path: string): Artifact => JSON.parse(
  readFileSync(path, 'utf8')
) as Artifact

const runCli = (): void => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const baselineDirectory = resolve(repoRoot, 'specs/baselines')
  const parityBaseline = readJson<CriticMarkupParityBaseline>(
    resolve(baselineDirectory, 'criticmarkup-upstream-parity.json')
  )
  const parityProposal = readJson<CriticMarkupParityProposal>(
    resolve(baselineDirectory, 'criticmarkup-parity-proposal.json')
  )
  const parityOracleProposal = readJson<CriticMarkupParityOracleProposal>(
    resolve(baselineDirectory, 'criticmarkup-parity-oracle-proposal.json')
  )
  const salvageBaseline = readJson<CriticMarkupSalvageBaseline>(
    resolve(baselineDirectory, 'criticmarkup-salvage-candidates.json')
  )
  const salvageProposal = readJson<CriticMarkupSalvageProposal>(
    resolve(baselineDirectory, 'criticmarkup-salvage-proposal.json')
  )
  const approval = readJson<CriticMarkupPhase0Approval>(
    resolve(baselineDirectory, 'criticmarkup-phase0-approval.json')
  )
  validateCriticMarkupParityProposal(parityBaseline, parityProposal)
  validateCriticMarkupParityOracleProposal(
    repoRoot,
    parityBaseline,
    parityOracleProposal
  )
  validateCriticMarkupSalvageProposal(repoRoot, salvageBaseline, salvageProposal)
  if (process.argv[2] === '--validate-proposal') {
    validateCriticMarkupPhase0ApprovalProposal(repoRoot, approval)
    return
  }
  if (process.argv[2] === '--require-approval') {
    requireCriticMarkupPhase0Approval(repoRoot, approval)
    return
  }
  throw new Error(
    'Usage: tsx scripts/criticmarkupPhase0Review.ts ' +
    '--validate-proposal | --require-approval'
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}

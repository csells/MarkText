import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  type CriticMarkupParityBaseline,
  type CriticMarkupParityDispositionOverlay,
  type CriticMarkupParityRowManifest,
  validateCriticMarkupParityDispositions
} from '../../../../../scripts/criticmarkupParityBaseline'
import {
  type CriticMarkupSalvageBaseline,
  type CriticMarkupSalvageDispositionOverlay,
  validateCriticMarkupSalvageDispositions
} from '../../../../../scripts/criticmarkupSalvageBaseline'
import {
  materializeCriticMarkupPhase0Dispositions,
  requireCriticMarkupPhase0Approval,
  type CriticMarkupParityOracleProposal,
  type CriticMarkupParityProposal,
  type CriticMarkupPhase0Approval,
  type CriticMarkupSalvageProposal,
  validateCriticMarkupParityProposal,
  validateCriticMarkupParityOracleProposal,
  validateCriticMarkupPhase0ApprovalProposal,
  validateCriticMarkupSalvageProposal
} from '../../../../../scripts/criticmarkupPhase0Review'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const readJson = <Artifact>(path: string): Artifact => JSON.parse(
  readFileSync(resolve(repoRoot, path), 'utf8')
) as Artifact

const parityBaseline = readJson<CriticMarkupParityBaseline>(
  'specs/baselines/criticmarkup-upstream-parity.json'
)
const parityProposal = readJson<CriticMarkupParityProposal>(
  'specs/baselines/criticmarkup-parity-proposal.json'
)
const parityOracleProposal = readJson<CriticMarkupParityOracleProposal>(
  'specs/baselines/criticmarkup-parity-oracle-proposal.json'
)
const salvageBaseline = readJson<CriticMarkupSalvageBaseline>(
  'specs/baselines/criticmarkup-salvage-candidates.json'
)
const salvageProposal = readJson<CriticMarkupSalvageProposal>(
  'specs/baselines/criticmarkup-salvage-proposal.json'
)
const approval = readJson<CriticMarkupPhase0Approval>(
  'specs/baselines/criticmarkup-phase0-approval.json'
)
const reviewPacket = readFileSync(resolve(
  repoRoot,
  'specs/baselines/criticmarkup-phase0-review.md'
), 'utf8')
const finalParityOverlay = readJson<CriticMarkupParityDispositionOverlay>(
  'specs/baselines/criticmarkup-parity-dispositions.json'
)
const finalParityRows = readJson<CriticMarkupParityRowManifest>(
  'specs/baselines/criticmarkup-parity-rows.json'
)
const finalSalvageOverlay = readJson<CriticMarkupSalvageDispositionOverlay>(
  'specs/baselines/criticmarkup-salvage-dispositions.json'
)

const first = <Value>(values: Value[]): Value => {
  const value = values[0]
  if (value === undefined) throw new Error('Test fixture requires at least one entry')
  return value
}

describe('CriticMarkup Phase 0 review proposal', () => {
  it('requires an exact Git-backed oracle classification for every parity item', () => {
    const proposal: CriticMarkupParityOracleProposal = {
      schema: 'marktext-criticmarkup-parity-oracle-proposal-v1',
      status: 'proposed-unapproved',
      baselineCommit: parityBaseline.baselineCommit,
      evidenceCommit: '177a13f24fe5e5c265dcef468f71988186d1f85e',
      groups: [{
        id: 'all-require-production-evidence',
        kinds: parityBaseline.sources.map(source => source.kind),
        sourceRelations: ['unchanged', 'changed', 'missing'],
        proposedOracle: 'new-production-path-test',
        rationale: 'Conservative fixture: no existing oracle is claimed.',
        refs: ['specs/plans/0010-marktext-criticmarkup-core-integration.md'],
        expectedCount: 829,
        itemIdsSha256: 'ab2c18664e1fd31766c5bcba25d2becb51660ddb073148f45d533a7d11778759'
      }]
    }

    expect(() => validateCriticMarkupParityOracleProposal(
      repoRoot,
      parityBaseline,
      proposal
    )).not.toThrow()
  })

  it('does not confuse source retention with green production evidence', () => {
    expect(() => validateCriticMarkupParityOracleProposal(
      repoRoot,
      parityBaseline,
      parityOracleProposal
    )).not.toThrow()
    expect(Object.fromEntries(parityOracleProposal.groups.map(group => [
      group.proposedOracle,
      (parityOracleProposal.groups
        .filter(candidate => candidate.proposedOracle === group.proposedOracle)
        .reduce((sum, candidate) => sum + candidate.expectedCount, 0))
    ]))).toEqual({
      'new-production-path-test': 367,
      'retained-upstream-test': 392,
      'retained-manual-oracle': 4,
      'owner-decision': 66
    })
    expect(parityOracleProposal.groups.some(group => (
      group.proposedOracle === 'unaffected'
    ))).toBe(false)

    const falseRetention = structuredClone(parityOracleProposal)
    first(falseRetention.groups).proposedOracle = 'retained-upstream-test'
    expect(() => validateCriticMarkupParityOracleProposal(
      repoRoot,
      parityBaseline,
      falseRetention
    )).toThrow(/cannot claim a retained upstream test/)
  })

  it('partitions all 829 parity items into reviewable, unapproved proposals', () => {
    expect(parityProposal).toMatchObject({
      status: 'proposed-unapproved',
      baselineCommit: parityBaseline.baselineCommit
    })
    expect(parityProposal.groups.reduce((sum, group) => sum + group.expectedCount, 0))
      .toBe(829)
    expect(() => validateCriticMarkupParityProposal(parityBaseline, parityProposal))
      .not.toThrow()
  })

  it('rejects parity proposal drift or a hidden denominator gap', () => {
    const staleDigest = structuredClone(parityProposal)
    first(staleDigest.groups).itemIdsSha256 = '0'.repeat(64)
    expect(() => validateCriticMarkupParityProposal(parityBaseline, staleDigest))
      .toThrow(/item-ID digest is stale/)

    const incomplete = structuredClone(parityProposal)
    incomplete.groups.pop()
    expect(() => validateCriticMarkupParityProposal(parityBaseline, incomplete))
      .toThrow(/upstream parity items have no proposal/)
  })

  it('partitions all 2,941 salvage candidates by observable Git relation', () => {
    expect(salvageProposal).toMatchObject({
      status: 'proposed-unapproved',
      baselineCommit: salvageBaseline.baselineCommit,
      snapshots: salvageBaseline.snapshots
    })
    expect(salvageProposal.groups.reduce((sum, group) => sum + group.expectedCount, 0))
      .toBe(2941)
    expect(() => validateCriticMarkupSalvageProposal(
      repoRoot,
      salvageBaseline,
      salvageProposal
    )).not.toThrow()
  })

  it('rejects salvage proposal drift rather than silently reclassifying a path', () => {
    const staleCount = structuredClone(salvageProposal)
    first(staleCount.groups).expectedCount += 1
    expect(() => validateCriticMarkupSalvageProposal(
      repoRoot,
      salvageBaseline,
      staleCount
    )).toThrow(/candidate count is stale/)

    const staleDigest = structuredClone(salvageProposal)
    first(staleDigest.groups).candidateIdsSha256 = '0'.repeat(64)
    expect(() => validateCriticMarkupSalvageProposal(
      repoRoot,
      salvageBaseline,
      staleDigest
    )).toThrow(/candidate-ID digest is stale/)
  })

  it('validates a pinned proposal but keeps every owner decision explicitly pending', () => {
    expect(approval).toMatchObject({
      status: 'proposed-unapproved',
      baselineCommit: parityBaseline.baselineCommit,
      evidenceCommit: '177a13f24fe5e5c265dcef468f71988186d1f85e'
    })
    expect(approval.decisions).toHaveLength(8)
    expect(approval.decisions.every(decision => decision.status === 'pending-owner-decision'))
      .toBe(true)
    expect(() => validateCriticMarkupPhase0ApprovalProposal(repoRoot, approval))
      .not.toThrow()
    expect(() => requireCriticMarkupPhase0Approval(repoRoot, approval))
      .toThrow(/8 Phase 0 decisions require explicit owner approval/)
  })

  it('records authenticated interaction execution without owner ratification', () => {
    const interactionDecision = approval.decisions.find(
      decision => decision.id === 'interaction-matrix'
    )

    expect(interactionDecision?.status).toBe('pending-owner-decision')
    expect(interactionDecision?.proposal).toContain(
      'hash-pinned stable-commit installed execution record authenticates all 25 rows as passing'
    )
    expect(reviewPacket).toContain('25 green installed executions')
    expect(reviewPacket).toContain('addd76f29ac28b0efc13db33868b1f62dd0f9724')
    expect(reviewPacket).toContain('still-unratified expected behavior')
  })

  it('rejects stale evidence and an unsupported ratification claim', () => {
    const stale = structuredClone(approval)
    first(stale.evidence).sha256 = '0'.repeat(64)
    expect(() => validateCriticMarkupPhase0ApprovalProposal(repoRoot, stale))
      .toThrow(/evidence digest is stale/)

    const falseApproval = structuredClone(approval)
    falseApproval.status = 'ratified'
    expect(() => validateCriticMarkupPhase0ApprovalProposal(repoRoot, falseApproval))
      .toThrow(/cannot be ratified while owner decisions are pending/)
  })

  it('requires the approval record to pin full Git commit identities', () => {
    const abbreviated = structuredClone(approval)
    abbreviated.evidenceCommit = approval.evidenceCommit.slice(0, 12)
    expect(() => validateCriticMarkupPhase0ApprovalProposal(repoRoot, abbreviated))
      .toThrow(/must pin a full evidence commit/)

    const missing = structuredClone(approval)
    missing.baselineCommit = 'f'.repeat(40)
    expect(() => validateCriticMarkupPhase0ApprovalProposal(repoRoot, missing))
      .toThrow(/baseline revision is not a commit/)
  })

  it('refuses to materialize human-owned dispositions from the unapproved packet', () => {
    expect(() => materializeCriticMarkupPhase0Dispositions(repoRoot, {
      parityBaseline,
      parityProposal,
      parityOracleProposal,
      salvageBaseline,
      salvageProposal,
      approval
    })).toThrow(/8 Phase 0 decisions require explicit owner approval/)

    expect(finalParityOverlay.dispositions).toEqual({})
    expect(finalParityRows.rows).toEqual([])
    expect(finalSalvageOverlay.assets).toEqual([])
  })

  it('deterministically materializes a synthetic ratified packet', () => {
    const ratified = structuredClone(approval)
    ratified.status = 'ratified'
    ratified.decisions.forEach(decision => {
      decision.status = 'approved'
      decision.decidedBy = 'Synthetic test owner'
      decision.decidedAt = '2026-08-13T00:00:00.000Z'
      decision.rationale = 'Synthetic approval used only to exercise materialization.'
    })

    const materialized = materializeCriticMarkupPhase0Dispositions(repoRoot, {
      parityBaseline,
      parityProposal,
      parityOracleProposal,
      salvageBaseline,
      salvageProposal,
      approval: ratified
    })

    expect(Object.keys(materialized.parityOverlay.dispositions)).toHaveLength(829)
    expect(materialized.parityRows.rows).toHaveLength(763)
    expect(materialized.parityRows.rows.every(row => row.status === 'planned')).toBe(true)
    expect(materialized.parityRows.rows.filter(row => (
      row.productionPathTest.startsWith('retained-upstream-test:')
    ))).toHaveLength(392)
    expect(materialized.parityRows.rows.filter(row => (
      row.productionPathTest.startsWith('retained-manual-oracle:')
    ))).toHaveLength(4)
    expect(Object.fromEntries(materialized.parityRows.rows
      .filter(row => row.productionPathTest.startsWith('named-production-path-test:'))
      .map(row => [row.id, row.productionPathTest]))).toEqual({
      'phase0.item.82b57f93ae32b97bc090d680':
        'named-production-path-test: packages/desktop/test/unit/specs/file-change-content-check.spec.ts#does not compare disk bytes with stale Pinia while Core owns the document',
      'phase0.item.b9a01f70d274b7ff1480da76':
        'named-production-path-test: packages/desktop/test/unit/specs/flush-before-save.spec.ts#waits for Core authority and saves its acknowledged source instead of Pinia',
      'phase0.item.dbad87f3a634df371ca034af':
        'named-production-path-test: packages/desktop/test/unit/specs/source-code-image-action.spec.ts#rewrites ![id](old) to ![alt](result) on the matched line'
    })
    expect(materialized.parityRows.rows.filter(row => (
      row.productionPathTest.startsWith('required-new-production-path-test:')
    ))).toHaveLength(364)
    expect(() => validateCriticMarkupParityDispositions(
      parityBaseline,
      materialized.parityOverlay,
      materialized.parityRows
    )).not.toThrow()

    expect(materialized.salvageOverlay.assets.reduce(
      (sum, asset) => sum + asset.candidates.length,
      0
    )).toBe(2941)
    expect(() => validateCriticMarkupSalvageDispositions(
      salvageBaseline,
      materialized.salvageOverlay
    )).not.toThrow()

    const repeated = materializeCriticMarkupPhase0Dispositions(repoRoot, {
      parityBaseline,
      parityProposal,
      parityOracleProposal,
      salvageBaseline,
      salvageProposal,
      approval: ratified
    })
    expect(repeated).toEqual(materialized)
  })
})

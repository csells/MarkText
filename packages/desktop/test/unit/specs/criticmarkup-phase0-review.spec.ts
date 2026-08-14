import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as performanceMeasurements from '../../../../../scripts/criticmarkupPerformanceMeasurements'

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
const baselineGuide = readFileSync(resolve(
  repoRoot,
  'specs/baselines/README.md'
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

const preferenceProductionPath =
  'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-preference-production-surfaces.spec.ts#registers and initializes every production preference surface with exact schema/default coverage'
const preferenceItemIds = [
  'phase0.item.07d4585c6d1417eea049e211',
  'phase0.item.0963eb1936f7eec7c4363440',
  'phase0.item.11f06a14373267d0a7f04298',
  'phase0.item.1607b7aa015096064b31983f',
  'phase0.item.17b7db58e1606231d3757072',
  'phase0.item.2b8ba225a6f585296383bc42',
  'phase0.item.31e25fb56687c92740bc1e35',
  'phase0.item.3237df39c5c91c2fb09eff70',
  'phase0.item.36792315e9ac6ee174edafa2',
  'phase0.item.36f604e003eb09b84c4955fc',
  'phase0.item.3e58393bb9f9f235d90de4fc',
  'phase0.item.3ecf77bed446bf3ad7435a6a',
  'phase0.item.40485d2ae060303c593659f2',
  'phase0.item.45f65cc7c6017b56a7dcae7b',
  'phase0.item.483bf9dc1681dc71f7b20ffa',
  'phase0.item.4dd34f884b5b084dcba2b05a',
  'phase0.item.4e1b4ec46f855a5c3b83c397',
  'phase0.item.51a3d9e531cf5bc2bfe06e3f',
  'phase0.item.53968b3b5038faf0c53657f3',
  'phase0.item.53b94952f21a902376267d4d',
  'phase0.item.57649db13400e1385222f46a',
  'phase0.item.5a661f5accd9b32c9c30e49f',
  'phase0.item.5d6b4ddbddfde301afd527ad',
  'phase0.item.61f3c83186367ba93d77e03f',
  'phase0.item.69b6f1e450255ee44a8ee740',
  'phase0.item.6a62d179c9e090235100853e',
  'phase0.item.6dd8a49fe69b582ac630eeca',
  'phase0.item.6eb9fa70cfd8e314b0e5ad77',
  'phase0.item.6ec0b0c0736f4035859befed',
  'phase0.item.6f769db0df82412bfc3fae12',
  'phase0.item.707b868a8f9f7a8e3300cfad',
  'phase0.item.719e6686ea4f5ed950bc1afd',
  'phase0.item.81acd9bcc256d3dbb39f463f',
  'phase0.item.86afb40ce311b20a7e5f20b4',
  'phase0.item.89d542e5cb5e311f66811571',
  'phase0.item.8d906452daf4ad3fa23c973c',
  'phase0.item.8e88388fcedf3a798477337d',
  'phase0.item.8ea4389f490643b32c06eba8',
  'phase0.item.95adfaad82953c953d426b6b',
  'phase0.item.9f29f1c81e58ffc1c0773151',
  'phase0.item.ae8fe4dd07e32e7fd7f1cc46',
  'phase0.item.af3275ee5c572d281e9899e2',
  'phase0.item.b00c589d1018a5509fdf3720',
  'phase0.item.b0f5089e6b9e2a6379a9f612',
  'phase0.item.b5810549726378e809e30c5f',
  'phase0.item.b7e86ed8e9a6b5e921e16fb8',
  'phase0.item.b8cd35ad097880e4058b623d',
  'phase0.item.bbbc199d7a0983e8b59d1547',
  'phase0.item.bde00d2807bfbc2f0f4604ed',
  'phase0.item.be1d783ce29f9d47451e300b',
  'phase0.item.c2fe785e682e9bf3d5c57f22',
  'phase0.item.c37335e7c7369cb5fb191ea7',
  'phase0.item.cab5174111f8bbf74766d6bd',
  'phase0.item.cd6421c1e1295806eb13c78e',
  'phase0.item.d0a1fa85ba22ec5ce03b0edd',
  'phase0.item.d30450f8e442b6fa87fb5832',
  'phase0.item.d3f00d049c973994a58429c0',
  'phase0.item.dc1a9dfc54883d12daf7494b',
  'phase0.item.de9f903df554117cf99f0f65',
  'phase0.item.e2eb15d365a975654beb5c97',
  'phase0.item.e3b27feca889f95d71e49c59',
  'phase0.item.e48c1b4db7c917ef7d5cd3c3',
  'phase0.item.e91e1c4b4d04dd51d4d909e6',
  'phase0.item.e94a6d3a18b806faf2318781',
  'phase0.item.eb0a5c0593487c0e740f79a7',
  'phase0.item.ef911de2e75f14cb5080d245',
  'phase0.item.f2f64a10adab5b54cec4e065',
  'phase0.item.f57f5dae1a1344b2d58ec87b',
  'phase0.item.f8b9a6bf6ffbbcdfe64be171',
  'phase0.item.fd29702e47a7bb31ca27c217',
  'phase0.item.fe916f0a9ef2b5c783ae04ac',
  'phase0.item.ffa81e56602d915d5b52e949'
] as const

describe('CriticMarkup Phase 0 review proposal', () => {
  afterEach(() => vi.restoreAllMocks())

  it('requires the v2 proposal schema for item-level compatibility decisions', () => {
    expect(parityProposal.schema).toBe('marktext-criticmarkup-parity-proposal-v2')
    const legacy = {
      ...parityProposal,
      schema: 'marktext-criticmarkup-parity-proposal-v1'
    } as unknown as CriticMarkupParityProposal
    expect(() => validateCriticMarkupParityProposal(parityBaseline, legacy))
      .toThrow(/parity proposal schema is invalid/)
    expect(baselineGuide).toContain(
      'v2 item-level compatibility-decision proposals'
    )
  })

  it('proposes exactly the three audited README outcomes under parity-manifest review', () => {
    const itemDecisions = parityProposal.itemCompatibilityDecisions

    expect(itemDecisions.map(proposal => proposal.itemId)).toEqual([
      'readme-feature:ada27f4ce6a3',
      'readme-feature:0b8caa1ea286',
      'muya-readme-feature:57b5c6a23c6a'
    ])
    expect(itemDecisions.every(proposal => (
      proposal.approvalDecisionId === 'parity-manifest'
    ))).toBe(true)
    expect(itemDecisions[0]?.mechanicalFinding).toContain(
      'objective WYSIWYG behavior is already proved'
    )
    expect(itemDecisions[0]?.ownerQuestion).toContain(
      'clean/simple/distraction-free outcome is nonmechanical'
    )
    expect(itemDecisions[1]?.mechanicalFinding).toContain(
      'all 87 declared shortcuts are proved'
    )
    expect(itemDecisions[1]?.ownerQuestion).toContain(
      'writing-efficiency outcome is nonmechanical'
    )
    expect(itemDecisions[2]?.mechanicalFinding).toContain(
      'collaborative transport is not shipped'
    )
    expect(itemDecisions[2]?.ownerQuestion).toContain('owner scope decision')
    expect(approval.decisions).toHaveLength(8)
    expect(approval.decisions.every(decision => (
      decision.status === 'pending-owner-decision'
    ))).toBe(true)
    const parityManifestDecision = approval.decisions.find(decision => (
      decision.id === 'parity-manifest'
    ))
    expect(parityManifestDecision?.proposal).toContain(
      'three item-level README compatibility-decision proposals'
    )
    expect(parityManifestDecision?.proposal).toContain(
      '69 compatibility decisions if ratified'
    )
    for (const itemId of itemDecisions.map(proposal => proposal.itemId)) {
      expect(parityManifestDecision?.question).toContain(itemId)
      expect(parityManifestDecision?.proposal).toContain(itemId)
    }
    expect(itemDecisions[2]).toMatchObject({
      refs: expect.arrayContaining(['packages/muya/e2e/BACKLOG.md'])
    })
  })

  it('requires an exact Git-backed oracle classification for every parity item', () => {
    const proposal: CriticMarkupParityOracleProposal = {
      schema: 'marktext-criticmarkup-parity-oracle-proposal-v1',
      status: 'proposed-unapproved',
      baselineCommit: parityBaseline.baselineCommit,
      evidenceCommit: '4041de04661523214c151be318e0fff60cdb7e77',
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

  it('rejects compatibility-decision proposals outside the three audited README items', () => {
    const expanded = structuredClone(parityProposal)
    expanded.itemCompatibilityDecisions.push({
      ...first(expanded.itemCompatibilityDecisions),
      itemId: 'readme-feature:06d04490689f',
      proposedRef: 'unaudited-readme-item'
    })

    expect(() => validateCriticMarkupParityProposal(parityBaseline, expanded))
      .toThrow(/item compatibility-decision set is incomplete or stale/)
  })

  it('rejects drift in an audited README compatibility-decision binding', () => {
    const drifted = structuredClone(parityProposal)
    first(drifted.itemCompatibilityDecisions).proposedRef = 'drifted-owner-scope'

    expect(() => validateCriticMarkupParityProposal(parityBaseline, drifted))
      .toThrow(/does not match its audited proposal binding/)

    const misbound = structuredClone(parityProposal)
    const misboundDecision = first(misbound.itemCompatibilityDecisions) as {
      approvalDecisionId: string
    }
    misboundDecision.approvalDecisionId = 'interaction-matrix'
    expect(() => validateCriticMarkupParityProposal(parityBaseline, misbound))
      .toThrow(/does not match its audited proposal binding/)
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
      evidenceCommit: '4041de04661523214c151be318e0fff60cdb7e77'
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
    expect(reviewPacket).toContain('506d45bab802177a5b52cc05e69b70ae77679b4b')
    expect(reviewPacket).toContain('eight installed Phase 4 consumer workflows')
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

  it('rejects an approved performance decision without complete green evidence', () => {
    const falsePerformanceApproval = structuredClone(approval)
    const performanceDecision = falsePerformanceApproval.decisions.find(
      decision => decision.id === 'performance-targets'
    )
    if (performanceDecision === undefined) {
      throw new Error('Performance target decision is missing')
    }
    performanceDecision.status = 'approved'
    performanceDecision.decidedBy = 'Synthetic owner'
    performanceDecision.decidedAt = '2026-08-13T22:00:00.000Z'
    performanceDecision.rationale = 'Synthetic approval without evidence'

    expect(() => validateCriticMarkupPhase0ApprovalProposal(
      repoRoot,
      falsePerformanceApproval
    )).toThrow(/approved performance targets must reference.*calibration report/i)
  })

  it('rejects approved performance evidence for a different Phase 0 baseline', () => {
    const mismatched = structuredClone(approval)
    mismatched.baselineCommit = execFileSync(
      'git',
      ['-C', repoRoot, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' }
    ).trim()
    const performanceDecision = mismatched.decisions.find(
      decision => decision.id === 'performance-targets'
    )
    if (performanceDecision === undefined) {
      throw new Error('Performance target decision is missing')
    }
    performanceDecision.status = 'approved'
    performanceDecision.decidedBy = 'Synthetic owner'
    performanceDecision.decidedAt = '2026-08-14T08:00:00.000Z'
    performanceDecision.rationale = 'Synthetic cross-baseline approval attack.'

    expect(() => validateCriticMarkupPhase0ApprovalProposal(repoRoot, mismatched))
      .toThrow(/performance measurement baseline must equal the Phase 0 baseline/i)
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

  it('deterministically materializes dispositions after a separately green gate', () => {
    const performanceGate = vi.spyOn(
      performanceMeasurements,
      'requireCriticMarkupPerformanceEvidenceForRatification'
    ).mockReturnValue(undefined as never)
    const ratified = structuredClone(approval)
    const performanceManifestEvidence = ratified.evidence.find(
      evidence => evidence.id === 'performance-measurements'
    )
    if (performanceManifestEvidence === undefined) {
      throw new Error('Performance measurement evidence is missing')
    }
    ratified.evidence.push({
      ...performanceManifestEvidence,
      id: 'performance-calibration'
    })
    ratified.status = 'ratified'
    ratified.decisions.forEach(decision => {
      decision.status = 'approved'
      decision.decidedBy = 'Synthetic test owner'
      decision.decidedAt = '2026-08-13T00:00:00.000Z'
      decision.rationale = 'Synthetic approval used only to exercise materialization.'
    })
    const performanceDecision = ratified.decisions.find(
      decision => decision.id === 'performance-targets'
    )
    if (performanceDecision === undefined) {
      throw new Error('Performance target decision is missing')
    }
    performanceDecision.evidenceRefs.push('performance-calibration')

    const materialized = materializeCriticMarkupPhase0Dispositions(repoRoot, {
      parityBaseline,
      parityProposal,
      parityOracleProposal,
      salvageBaseline,
      salvageProposal,
      approval: ratified
    })

    expect(Object.keys(materialized.parityOverlay.dispositions)).toHaveLength(829)
    expect(materialized.parityRows.rows).toHaveLength(760)
    expect(materialized.parityRows.rows.every(row => row.status === 'planned')).toBe(true)
    expect(Object.fromEntries([
      'readme-feature:ada27f4ce6a3',
      'readme-feature:0b8caa1ea286',
      'muya-readme-feature:57b5c6a23c6a'
    ].map(itemId => [
      itemId,
      materialized.parityOverlay.dispositions[itemId]
    ]))).toEqual({
      'readme-feature:ada27f4ce6a3': {
        kind: 'approved-decision',
        ref: 'specs/baselines/criticmarkup-phase0-approval.json#parity-manifest:readme-wysiwyg-subjective-outcome'
      },
      'readme-feature:0b8caa1ea286': {
        kind: 'approved-decision',
        ref: 'specs/baselines/criticmarkup-phase0-approval.json#parity-manifest:readme-shortcut-efficiency-subjective-outcome'
      },
      'muya-readme-feature:57b5c6a23c6a': {
        kind: 'approved-decision',
        ref: 'specs/baselines/criticmarkup-phase0-approval.json#parity-manifest:muya-collaborative-transport-scope'
      }
    })
    expect(Object.values(materialized.parityOverlay.dispositions).filter(disposition => (
      disposition.kind === 'approved-decision'
    ))).toHaveLength(69)
    expect(materialized.parityRows.rows.filter(row => (
      row.productionPathTest.startsWith('retained-upstream-test:')
    ))).toHaveLength(392)
    expect(materialized.parityRows.rows.filter(row => (
      row.productionPathTest.startsWith('retained-manual-oracle:')
    ))).toHaveLength(4)
    expect(performanceGate).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({ baselineCommit: ratified.baselineCommit }),
      {
        path: performanceManifestEvidence.path,
        sha256: performanceManifestEvidence.sha256
      }
    )
    expect(Object.fromEntries(materialized.parityRows.rows
      .filter(row => row.productionPathTest.startsWith('named-production-path-test:'))
      .map(row => [row.id, row.productionPathTest]))).toEqual({
      'phase0.item.155c18d97f38bc97408f0312':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes Edit line-ending choices and exposes their exact containers',
      'phase0.item.16b16963d8264860b2a4f249':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#exposes exact Theme root, groups, and follow-system disabled notice',
      'phase0.item.3b044ad4b25f78346c9bcfea':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes Edit line-ending choices and exposes their exact containers',
      'phase0.item.624bfe7d353c593deb5a1d41':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes every Sidebar context-menu item to its exact filesystem action',
      'phase0.item.67958822db1d4d79d176fffd':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes every Sidebar context-menu item to its exact filesystem action',
      'phase0.item.7de6448da8c84ac41dcf4e90':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes every Sidebar context-menu item to its exact filesystem action',
      'phase0.item.8c4e8b1e3a26398bd06147fe':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes every Sidebar context-menu item to its exact filesystem action',
      'phase0.item.a027ffd4684bf29ee977de48':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes every Sidebar context-menu item to its exact filesystem action',
      'phase0.item.b1c3b55cbc79cb8c4926b39f':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes Edit line-ending choices and exposes their exact containers',
      'phase0.item.b4469e1fa8cb164d0c911441':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes every Sidebar context-menu item to its exact filesystem action',
      'phase0.item.bca72256520bff35d4bb4a9f':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#exposes exact Theme root, groups, and follow-system disabled notice',
      'phase0.item.c1b8f8c1bc21bf824d643f2a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes every Sidebar context-menu item to its exact filesystem action',
      'phase0.item.c35e01092900730a5dbe66a8':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#exposes the Format root for its already-proven executable leaves',
      'phase0.item.d296a569d209baf623d5fdcc':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes every Sidebar context-menu item to its exact filesystem action',
      'phase0.item.e8c3e9a6162fca1a29a9b14a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#exposes exact Theme root, groups, and follow-system disabled notice',
      'phase0.item.f5b4f0e6156c8ddacb2a4324':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#exposes exact Theme root, groups, and follow-system disabled notice',
      'phase0.item.fc0f8ce7d787ddacbd59f4f1':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-menu-production-surfaces.spec.ts#routes Edit line-ending choices and exposes their exact containers',
      'phase0.item.0a45414ba548bb267011bc3e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.0ea5c587585b8fbcf456b3dd':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.2bc695342c78272090edd54c':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.3b33192cdb536bdf1cd2734d':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.581601f3c76e76dcf9e1b4ef':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.7b6efc434f8af814eda634a6':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.83120b4bbe0f8583c4a43684':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.b868f83233f722d61b10a79a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.c3773c31842b719ac3140fc2':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.c62c35a00ad6dd8bbd5a70f1':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.de7917990f83fbc0146c7690':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.df5a6cddc1041919713dbb8c':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.e2f0377b5c04eb78dfcdcb86':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.e6875afc246a30857e3d1056':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.e6aa6bdba767f4a007aa86b5':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.e77490623185ea33a0517db9':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.f94443129e1defbeaca1c9ad':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      ...Object.fromEntries(preferenceItemIds.map(id => [id, preferenceProductionPath])),
      'phase0.item.12012502a44e0e4268e3c80a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#routes spelling root, language, and dictionary surfaces to exact boundaries',
      'phase0.item.30e90b2ac2f2372a188ce745':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#exposes exact native clipboard roles and renderer edit actions',
      'phase0.item.384d142fa11b44a6c76c329d':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#exposes exact native clipboard roles and renderer edit actions',
      'phase0.item.4088442b4019ec420b86d4a3':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#exposes exact native clipboard roles and renderer edit actions',
      'phase0.item.472cf6453e126bdb8e46eba7':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#exposes exact native clipboard roles and renderer edit actions',
      'phase0.item.4fb526d3284b6b37621c32c1':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#exposes exact native clipboard roles and renderer edit actions',
      'phase0.item.53c33b607246a008f755256a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#routes spelling root, language, and dictionary surfaces to exact boundaries',
      'phase0.item.68779e4004dc4481777569ad':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#exposes exact native clipboard roles and renderer edit actions',
      'phase0.item.6fc8716cfb3a82d474ac5669':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#routes spelling root, language, and dictionary surfaces to exact boundaries',
      'phase0.item.8fed3b67c62ab781a4610ff0':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#exposes exact native clipboard roles and renderer edit actions',
      'phase0.item.93e0ee5d97cf185d7e3c8134':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#exposes exact native clipboard roles and renderer edit actions',
      'phase0.item.f0d12953f2c0ee7b708ae62e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-editor-context-menu-production-surfaces.spec.ts#routes spelling root, language, and dictionary surfaces to exact boundaries',
      'phase0.item.1a798c59f5673401b2b1b762':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-marktext-production-surfaces.spec.ts#routes registered hide commands and paired menu surfaces to exact native responders',
      'phase0.item.43275261e04a0adf42f95e15':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-marktext-production-surfaces.spec.ts#routes registered hide commands and paired menu surfaces to exact native responders',
      'phase0.item.431ae7f8b27a695bc20a8187':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-marktext-production-surfaces.spec.ts#routes remaining executable MarkText menu surfaces to exact application boundaries',
      'phase0.item.5e786ba8dae3e0ebca55bd39':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-marktext-production-surfaces.spec.ts#routes remaining executable MarkText menu surfaces to exact application boundaries',
      'phase0.item.607e7e2785c3dec6743793cb':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-marktext-production-surfaces.spec.ts#routes registered hide commands and paired menu surfaces to exact native responders',
      'phase0.item.6d92c4206ae71053a6265227':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-marktext-production-surfaces.spec.ts#exposes exact structural MarkText root and Services menu surfaces',
      'phase0.item.72fe47c07cdeebddc51b25ff':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-marktext-production-surfaces.spec.ts#routes remaining executable MarkText menu surfaces to exact application boundaries',
      'phase0.item.78fcda1a146eb7fbc0689858':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-marktext-production-surfaces.spec.ts#routes registered hide commands and paired menu surfaces to exact native responders',
      'phase0.item.94c37fba288c9becaf8b0042':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-marktext-production-surfaces.spec.ts#routes remaining executable MarkText menu surfaces to exact application boundaries',
      'phase0.item.b2d8d83f6ee2b645ee835360':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-marktext-production-surfaces.spec.ts#exposes exact structural MarkText root and Services menu surfaces',
      'phase0.item.d53507300b7a736ffe29e023':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-marktext-production-surfaces.spec.ts#routes remaining executable MarkText menu surfaces to exact application boundaries',
      'phase0.item.057d629d092880152faea48c':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-help-production-surfaces.spec.ts#routes every external Help menu surface to its exact trusted URL',
      'phase0.item.2da152e75a4388e919d6c82a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-help-production-surfaces.spec.ts#routes every external Help menu surface to its exact trusted URL',
      'phase0.item.355fbf862935850d5cf6f882':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-help-production-surfaces.spec.ts#routes every external Help menu surface to its exact trusted URL',
      'phase0.item.42a254d83cde566bff2723fc':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-help-production-surfaces.spec.ts#routes every external Help menu surface to its exact trusted URL',
      'phase0.item.6968d36288c4583b8ff5d18c':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-help-production-surfaces.spec.ts#routes every external Help menu surface to its exact trusted URL',
      'phase0.item.6f078ef1de7ece3a3ad622f8':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-help-production-surfaces.spec.ts#routes every external Help menu surface to its exact trusted URL',
      'phase0.item.9b25f9af5d1abd34b77be659':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-help-production-surfaces.spec.ts#exposes the Help root as the container for the proven leaf surfaces',
      'phase0.item.e4b59556ae450b9b26f6c3e4':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-help-production-surfaces.spec.ts#routes platform Help actions to their exact application boundaries',
      'phase0.item.eb69929defd15174e1487c84':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-help-production-surfaces.spec.ts#routes every external Help menu surface to its exact trusted URL',
      'phase0.item.f1f68b405960f46dad168a9a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-help-production-surfaces.spec.ts#routes every external Help menu surface to its exact trusted URL',
      'phase0.item.ff2eedb48329199efc0a6a01':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-help-production-surfaces.spec.ts#routes platform Help actions to their exact application boundaries',
      'phase0.item.02646b29196eb59a5e2af71e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.093caad34fd0476546efc6a0':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.164a52750fa0c5198a12fe68':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.179877faa563ae6aa4efac05':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#exposes every remaining non-executable File menu container',
      'phase0.item.19ad0b49c2b9a723f6f9c52b':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.19f8532519c9e9fdcc61b298':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.240a26f84edfc7568a7e8be5':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#exposes every remaining non-executable File menu container',
      'phase0.item.29771eb08f2d31eadf3c07bf':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.2980f90cc3a5fdfb4a20d0dc':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.2bf44a037fcb88b59f815aa6':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.2c61834a7ea7189b0891578a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.305d0a3c8f0f597fa98e997b':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.34e5f76587817f4aa7eeab90':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.3ae7268a790327a7b847d938':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.44521896c8fa9e3b9386fbd1':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.484e54a1530979a5839b6db4':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.4d2b8ae36dab93b56c7bfe39':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.54f292af21b05e87639abdbd':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.72b4d008ae7e81aff2c4d50f':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.758d26acfcf3549f5cd0cefe':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#exposes every remaining non-executable File menu container',
      'phase0.item.766e7ec3540e1bee41f8934b':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.87f713d25537e7fb8eb77d09':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.88e3c2cea87379690fab1939':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.897a6d57000cc3c84da77daa':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.933af3bde51ca332ea032131':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.97072a58533a28194713bad9':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.a961686c94c8f5f9884d9c4a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.a9b994376d2c462acc255a96':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.ae7aeeb6d3547002ecdd4da3':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.ba5e2d32211e2d30ac2b26f8':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.dc8744cfdb39bedc3d252cdd':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining registered File command to its exact application boundary',
      'phase0.item.e991e55172b2dbc02e2f5ed8':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.f2449f622073142c6d77484b':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.fe1bf64a369c33cfccc6ee04':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.fffe9c6cf88d6c10ee87857a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-file-production-surfaces.spec.ts#routes every remaining executable File menu surface to its exact application boundary',
      'phase0.item.004c0d7dbf1b45de1e90757c':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.0401b5efadfa1bfa72b14844':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.0030c6e658a95827b05f3e99':
        'named-production-path-test: packages/desktop/test/unit/specs/file-save-production-surfaces.spec.ts#routes registered Save and Save As command and menu surfaces to the renderer save barriers',
      'phase0.item.11dee19d0d72ad669c7a6e3c':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-router-production-surfaces.spec.ts#registers every concrete editor and preference route with its exact path and component',
      'phase0.item.41c89372d4bf2f34924ab1c2':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-router-production-surfaces.spec.ts#registers every concrete editor and preference route with its exact path and component',
      'phase0.item.49e4a9595419c4a87f9fb9d0':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-router-production-surfaces.spec.ts#registers every concrete editor and preference route with its exact path and component',
      'phase0.item.5fa87d9b3672a0632188ee9c':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-router-production-surfaces.spec.ts#registers every concrete editor and preference route with its exact path and component',
      'phase0.item.6852cd2e4295b943da7a0ec0':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-router-production-surfaces.spec.ts#registers every concrete editor and preference route with its exact path and component',
      'phase0.item.703205617458f3e4a0ae6de2':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-router-production-surfaces.spec.ts#dispatches the index route to the exact editor or preference entry surface',
      'phase0.item.882e7da8952f81432684698d':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-router-production-surfaces.spec.ts#registers every concrete editor and preference route with its exact path and component',
      'phase0.item.99c769208aa2f6aa1a53b9d4':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-router-production-surfaces.spec.ts#registers every concrete editor and preference route with its exact path and component',
      'phase0.item.aba2da655f19f8fd529c8c61':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-router-production-surfaces.spec.ts#dispatches the index route to the exact editor or preference entry surface',
      'phase0.item.bf715ee180148efd4c28e47c':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-router-production-surfaces.spec.ts#registers every concrete editor and preference route with its exact path and component',
      'phase0.item.dfb4953def39e3a0378fb351':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-router-production-surfaces.spec.ts#registers every concrete editor and preference route with its exact path and component',
      'phase0.item.07f9355a3697088de1bd6500':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.0968cc6aadef3a739c6e653e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every tab context-menu surface through its exact tab bus event',
      'phase0.item.0f05f351509c0f58afa5626e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.2ce3f9c4899707a3c151cffb':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.4c75cc42223b27eec5f05513':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.4dec1da46e733fd77798de85':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.536a64439bb3d4fcb63bdfb5':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every tab context-menu surface through its exact tab bus event',
      'phase0.item.6b712a15fa39e8a5e1366216':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.6d4c790c7b2c5eb5f9c1926f':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.7f9a8b2f1269b6199dc8569d':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every tab context-menu surface through its exact tab bus event',
      'phase0.item.85b866c03e2e9594c8681c00':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.8c9404988595231b6778e6ea':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every tab context-menu surface through its exact tab bus event',
      'phase0.item.92fa2270a1928629f41b25e8':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.b8de21f61671e6c9fd48aa38':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.b9b23301ae5ae80148254184':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.bc2590799a2c816eab66b554':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every tab context-menu surface through its exact tab bus event',
      'phase0.item.c07af6e9d31eac2ba96a2867':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.db5788c147f3ea7a0268643a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.ec88c4538bfbe567463be627':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every tab context-menu surface through its exact tab bus event',
      'phase0.item.f09f28c4a68a25f3f34dfec0':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every tab context-menu surface through its exact tab bus event',
      'phase0.item.fcac4d634bf32adf38b427f8':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-tabs-production-surfaces.spec.ts#routes every registered Tabs command to its exact renderer tab action',
      'phase0.item.0431c3e8f43d336fc52f2754':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes every registered Window command and paired menu surface to its exact runtime effect',
      'phase0.item.0c3f77e6f42037a3bf316770':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes Bring All to Front and exposes the Window root menu',
      'phase0.item.0ff76b77054c2ac391d415df':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes every registered Window command and paired menu surface to its exact runtime effect',
      'phase0.item.177c2f14659cb7980911856c':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes every registered Window command and paired menu surface to its exact runtime effect',
      'phase0.item.5941785b7ce149b6044cdacb':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes every registered Window command and paired menu surface to its exact runtime effect',
      'phase0.item.b0a448c7bf4ec499976de97d':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes every registered Window command and paired menu surface to its exact runtime effect',
      'phase0.item.c930300f69bf605add7a58fb':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes every registered Window command and paired menu surface to its exact runtime effect',
      'phase0.item.d33714f91311f5995d7caa89':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes every registered Window command and paired menu surface to its exact runtime effect',
      'phase0.item.d33edcb476067b74d3f67a48':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes every registered Window command and paired menu surface to its exact runtime effect',
      'phase0.item.d5a7ccd63f56a0e8ea0b9cfc':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes Bring All to Front and exposes the Window root menu',
      'phase0.item.e2705e62da0fc23e90ac3b11':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes every registered Window command and paired menu surface to its exact runtime effect',
      'phase0.item.fd45a116caf5cd97418ea7a9':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-window-production-surfaces.spec.ts#routes every registered Window command and paired menu surface to its exact runtime effect',
      'phase0.item.0062e8c85215bf4db73a8172':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.0f12831319a9fb31c39ce63d':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.17a77761faa6c4e43bbf8668':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.1ac4f8bf4ddf2c05d8ae6f0c':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.2b531adebe3f2e57844bad74':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.53a6f52051297bb89866fe94':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.66c15b99288be17e8e983aed':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.74d0d0eb7cc96e516a808134':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.7f733b9309f2ecba26ce5afa':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.81ce51f45b6fc3d957c6c8f6':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.821fb7b4817f15f7d5bc6c1b':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#exposes the View root menu as the container for the proven leaf surfaces',
      'phase0.item.8e03af58b31e92080783f5f8':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.8e2180191dc303cd1251b04e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.b5731f14828adf87e5dbd127':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.b972f462fff3bdcce1dff867':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.bcce0f26984f9e152a104eff':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.bd5e737dee6dcd3c25a7c516':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.ce9a0daa431f8d49597e8920':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.d6fc25194c9f1b57c28c33a1':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.f46f9a684c549a8e546d36eb':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.fd9152e5c0b1c4f1dac7fb6e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-view-production-surfaces.spec.ts#routes every registered View command and leaf menu surface to its exact runtime effect',
      'phase0.item.0dc124b6c9a5fafc29d6a3e7':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-task-list-production-surfaces.spec.ts#routes registered Task List command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.00966777ae933ce5d7bb44d9':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-delete-paragraph-production-surfaces.spec.ts#routes registered Delete Paragraph command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.031b864764d6a2c693d32752':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-replace-production-surfaces.spec.ts#routes registered Replace command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.0638d0ddbe6fd90a70040c16':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-superscript-production-surfaces.spec.ts#routes registered Superscript command and Format menu surface through the renderer format-action channel',
      'phase0.item.08438adb7eca10e737d1b0cc':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-quote-block-production-surfaces.spec.ts#routes registered Quote Block command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.0ea03df77040817824e2a636':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-hyperlink-production-surfaces.spec.ts#routes registered Hyperlink command and Format menu surface through the renderer format-action channel',
      'phase0.item.117f9c6207e3742be266b4a4':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-clear-format-production-surfaces.spec.ts#routes registered Clear Format command and Format menu surface through the renderer format-action channel',
      'phase0.item.160937548f3fa957d900f04b':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-find-navigation-production-surfaces.spec.ts#routes registered Find Next and Find Previous command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.1fa6d85bb93a1f355b2d7b66':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.220a0e4a8db52e189763ec20':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.27b5e2258afa39003e0174f6':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.20a0482a18ee9492c64be652':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-bullet-list-production-surfaces.spec.ts#routes registered Bullet List command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.2e64fc29fc59f5b4a906ea56':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-highlight-format-production-surfaces.spec.ts#routes registered Highlight command and Format menu surface through the renderer format-action channel',
      'phase0.item.2f11fb7d15e0d7e577c50c70':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.357277714bd0705ceab0b50e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.27ab3556877c1891af1381db':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-hyperlink-production-surfaces.spec.ts#routes registered Hyperlink command and Format menu surface through the renderer format-action channel',
      'phase0.item.397314c6348fc4ee45514620':
        'named-production-path-test: packages/desktop/test/unit/specs/file-save-production-surfaces.spec.ts#routes registered Save and Save As command and menu surfaces to the renderer save barriers',
      'phase0.item.3b0a8c667e97401b255c8159':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-code-fence-production-surfaces.spec.ts#routes registered Code Fence command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.420fdfa5c193f0633abca434':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-native-copy-production-surfaces.spec.ts#routes registered Copy command and Edit menu surfaces through the Electron native copy runtime',
      'phase0.item.4ef010cbe4725cb0d16df008':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-screenshot-production-surfaces.spec.ts#routes registered Screenshot command and Edit menu surfaces through the screen-capture application event',
      'phase0.item.4b89002fa4e9a6375165935c':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-underline-production-surfaces.spec.ts#routes registered Underline command and Format menu surface through the renderer format-action channel',
      'phase0.item.4ab6377ef62019a975c04706':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.49512fbea5ebc0a05d0e8023':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-production-surfaces.spec.ts#routes Edit menu Undo and Redo through the renderer edit-action channel',
      'phase0.item.503ba3b99614737f7f991c9e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-create-paragraph-production-surfaces.spec.ts#routes registered Create Paragraph command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.5028e68819c2ca0038acd48b':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.4c3b89bf6f9ec79ffc815408':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-subscript-production-surfaces.spec.ts#routes registered Subscript command and Format menu surface through the renderer format-action channel',
      'phase0.item.5a233c1c0b730f92c8b26b77':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-native-copy-production-surfaces.spec.ts#routes registered Copy command and Edit menu surfaces through the Electron native copy runtime',
      'phase0.item.5a8cf05b8c8edefc7276bc74':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.5e0446eed3c50b067a946808':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-duplicate-production-surfaces.spec.ts#routes registered Duplicate command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.5eeff02652f96f31549bd069':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-find-production-surfaces.spec.ts#routes registered Find command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.5fdd30f820d652e48f5b4528':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-projected-copy-production-surfaces.spec.ts#routes Edit menu Copy as Rich and Copy as HTML entries to the editor',
      'phase0.item.61e86d3cf0ee4ad1f9ea3faa':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-inline-math-production-surfaces.spec.ts#routes registered Inline Math command and Format menu surface through the renderer format-action channel',
      'phase0.item.5614a9e6297e94476c2f1d25':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-subscript-production-surfaces.spec.ts#routes registered Subscript command and Format menu surface through the renderer format-action channel',
      'phase0.item.563693cba8f54e15f6d952b4':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-math-formula-production-surfaces.spec.ts#routes registered Math Formula command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.59db1e63aacaf4964b8df1b1':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-ordered-list-production-surfaces.spec.ts#routes registered Ordered List command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.6503ef62074e1a51ee15fb38':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-find-navigation-production-surfaces.spec.ts#routes registered Find Next and Find Previous command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.6bd96d39e9a19e9a966fdf6b':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.6c1d347e7132dff437483daf':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.6c5fc1de22b21cbc5e138455':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-strikethrough-production-surfaces.spec.ts#routes registered Strike-through command and Format menu Strikethrough surface through the renderer format-action channel',
      'phase0.item.6dc202f2b36d66fa10d2dbb3':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-strong-format-production-surfaces.spec.ts#routes registered Strong command and Bold menu surfaces through the renderer format-action channel',
      'phase0.item.6ef94e99e33b332cdce273ec':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-production-surfaces.spec.ts#routes Edit menu Undo and Redo through the renderer edit-action channel',
      'phase0.item.71f47d065b7c49e2a03cd18a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.7abd6a5e7e44b8e599d728e5':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-find-in-folder-production-surfaces.spec.ts#routes registered Find in Folder command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.786d2dd4acf6a54342a51eda':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-duplicate-production-surfaces.spec.ts#routes registered Duplicate command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.7b2afe2c3851e9bbb08c500d':
        'named-production-path-test: packages/desktop/test/unit/specs/file-save-production-surfaces.spec.ts#routes registered Save and Save As command and menu surfaces to the renderer save barriers',
      'phase0.item.780b8aabf4e014404fab9b58':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-projected-cut-production-surfaces.spec.ts#routes registered Cut command and Edit menu surfaces through the Electron native cut runtime',
      'phase0.item.783cca6a91eab34cc239b0cb':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-superscript-production-surfaces.spec.ts#routes registered Superscript command and Format menu surface through the renderer format-action channel',
      'phase0.item.802547d06b5147447bb1e3aa':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-quote-block-production-surfaces.spec.ts#routes registered Quote Block command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.82a578e423359fe5960ee572':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.831628c66c7632b18ae126fd':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-production-surfaces.spec.ts#routes registered Undo and Redo commands to the renderer edit-action channel',
      'phase0.item.84fbe7795c97058036d7c916':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-ordered-list-production-surfaces.spec.ts#routes registered Ordered List command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.865771ab05fea47f0b4e86fd':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-image-format-production-surfaces.spec.ts#routes registered Image command and Format menu surface through the renderer format-action channel',
      'phase0.item.867cc6c717a7baf2684a9c87':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-replace-production-surfaces.spec.ts#routes registered Replace command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.885a254b4b1cb4fc9b603be9':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.8aaa24678c1a92cf623b43b0':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-inline-math-production-surfaces.spec.ts#routes registered Inline Math command and Format menu surface through the renderer format-action channel',
      'phase0.item.9064d8fa0c44f1775ad60a59':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.82b57f93ae32b97bc090d680':
        'named-production-path-test: packages/desktop/test/unit/specs/file-change-content-check.spec.ts#does not compare disk bytes with stale Pinia while Core owns the document',
      'phase0.item.91c0c4cd322d1531a3e7c9ea':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-paste-as-plain-text-production-surfaces.spec.ts#routes registered Paste as Plain Text command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.919af8120487b9e837e1ea14':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-inline-code-production-surfaces.spec.ts#routes registered Inline Code command and Format menu surface through the renderer format-action channel',
      'phase0.item.94245f0a016ba18f4cd75b5a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-find-navigation-production-surfaces.spec.ts#routes registered Find Next and Find Previous command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.9825d103298403255f22149b':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-html-block-production-surfaces.spec.ts#routes registered HTML Block command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.9b98e936eca2f77816b46eb3':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-screenshot-production-surfaces.spec.ts#routes registered Screenshot command and Edit menu surfaces through the screen-capture application event',
      'phase0.item.9f3ac53aabb0eba18bc56a9d':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-inline-code-production-surfaces.spec.ts#routes registered Inline Code command and Format menu surface through the renderer format-action channel',
      'phase0.item.9dfc8781faf2ca756f7e6525':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-select-all-production-surfaces.spec.ts#routes registered Select All command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.9dfe4b390547e294c1e9f277':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-projected-paste-production-surfaces.spec.ts#routes registered Paste command and Edit menu surfaces through the Electron native paste runtime',
      'phase0.item.9e5d6d94a3bc45defd8913a9':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-strikethrough-production-surfaces.spec.ts#routes registered Strike-through command and Format menu Strikethrough surface through the renderer format-action channel',
      'phase0.item.a02a5319ea4d3a876f538622':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-task-list-production-surfaces.spec.ts#routes registered Task List command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.a67f9710d62840c4950ffff5':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-projected-copy-production-surfaces.spec.ts#routes registered Copy as Rich and Copy as HTML commands to the editor',
      'phase0.item.a70ae367e06aa43a2191dc2e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-find-production-surfaces.spec.ts#routes registered Find command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.aeb1112a9cdd35de9d811549':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.ae9c22aeff42460c77efb79b':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-strong-format-production-surfaces.spec.ts#routes registered Strong command and Bold menu surfaces through the renderer format-action channel',
      'phase0.item.afff07fa9d4d4992e0f4af41':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-html-block-production-surfaces.spec.ts#routes registered HTML Block command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.a31d9a0b8efebb43304be453':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-find-in-folder-production-surfaces.spec.ts#routes registered Find in Folder command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.b327952319820e0956248ea0':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-projected-copy-production-surfaces.spec.ts#routes Edit menu Copy as Rich and Copy as HTML entries to the editor',
      'phase0.item.b9a01f70d274b7ff1480da76':
        'named-production-path-test: packages/desktop/test/unit/specs/flush-before-save.spec.ts#waits for Core authority and saves its acknowledged source instead of Pinia',
      'phase0.item.b45b71868eb09afeb8e668ef':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-math-formula-production-surfaces.spec.ts#routes registered Math Formula command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.b5f01e00fd5f530b5a538989':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.bb1045ece7bd5b5ae4acaa55':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.c8a0caaadc6be3cf5bcd988e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-clear-format-production-surfaces.spec.ts#routes registered Clear Format command and Format menu surface through the renderer format-action channel',
      'phase0.item.c735ce5f439de584976e0414':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.c890bd520351f0194d9cae66':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.cff33de8534ca261ad97a843':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-create-paragraph-production-surfaces.spec.ts#routes registered Create Paragraph command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.ca1601efc9e96edae53113c4':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-code-fence-production-surfaces.spec.ts#routes registered Code Fence command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.cc96e4605186ca739bb0a3e1':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-image-format-production-surfaces.spec.ts#routes registered Image command and Format menu surface through the renderer format-action channel',
      'phase0.item.d2ee99917de52f08a9d7d9e8':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-emphasis-production-surfaces.spec.ts#routes registered Emphasis command and Format menu Italic surface through the renderer format-action channel',
      'phase0.item.d47275960775bbd34457e2ed':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-production-surfaces.spec.ts#routes registered Undo and Redo commands to the renderer edit-action channel',
      'phase0.item.d4a789b1042d4eadeabe24d1':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-paste-as-plain-text-production-surfaces.spec.ts#routes registered Paste as Plain Text command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.d67038c93ede2dfc8a17c89e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.da95faaeb7a2d182fd99425f':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-find-navigation-production-surfaces.spec.ts#routes registered Find Next and Find Previous command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.dbad87f3a634df371ca034af':
        'named-production-path-test: packages/desktop/test/unit/specs/source-code-image-action.spec.ts#rewrites ![id](old) to ![alt](result) on the matched line',
      'phase0.item.db1ac2550683023a41679b46':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-delete-paragraph-production-surfaces.spec.ts#routes registered Delete Paragraph command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.de5dd4ce3d0fd8eebdc1b5c7':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-emphasis-production-surfaces.spec.ts#routes registered Emphasis command and Format menu Italic surface through the renderer format-action channel',
      'phase0.item.deb8142f7f05d1825bfcbaac':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-projected-copy-production-surfaces.spec.ts#routes registered Copy as Rich and Copy as HTML commands to the editor',
      'phase0.item.dc86ff19be75e8821827baca':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.e5b3aa0ed74e8f679eb30fc7':
        'named-production-path-test: packages/desktop/test/unit/specs/file-save-production-surfaces.spec.ts#routes registered Save and Save As command and menu surfaces to the renderer save barriers',
      'phase0.item.e9ed537dc5b08910ab2e2406':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-underline-production-surfaces.spec.ts#routes registered Underline command and Format menu surface through the renderer format-action channel',
      'phase0.item.e6535358877c2140948a2e91':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.ec98d87a0d244b1a3df19848':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-bullet-list-production-surfaces.spec.ts#routes registered Bullet List command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.eba6acc288c5b6b240e283f7':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-highlight-format-production-surfaces.spec.ts#routes registered Highlight command and Format menu surface through the renderer format-action channel',
      'phase0.item.e37d7c32ed645c4702548f07':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-projected-cut-production-surfaces.spec.ts#routes registered Cut command and Edit menu surfaces through the Electron native cut runtime',
      'phase0.item.ed75c2e03726b7d71723d712':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-projected-paste-production-surfaces.spec.ts#routes registered Paste command and Edit menu surfaces through the Electron native paste runtime',
      'phase0.item.f2ed7455148ce0b51f98f2cf':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.f45865bed4e34a14fbb94d8f':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.f78f04d7f9fa96caccc33e59':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-remaining-paragraph-production-surfaces.spec.ts#covers remaining Paragraph command and menu entry production surfaces',
      'phase0.item.fa4e61798208bb8ac4978df6':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-select-all-production-surfaces.spec.ts#routes registered Select All command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.cb5d9a07e7600cc5f641c514':
        'named-production-path-test: packages/muya/test/spec/commonmark.spec.ts#CommonMark 0.31 spec conformance + packages/muya/test/spec/gfm.spec.ts#GFM 0.29-gfm spec conformance + packages/muya/src/state/__tests__/renderToStaticHTML.spec.ts#option surface',
      'phase0.item.b3bdd03b350a040bc2e7f314':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-readme-production-capabilities.spec.ts#readme-feature:06d04490689f proves every objective subclaim at its public production seam',
      'phase0.item.f1c8a0de8639795cfde5c76e':
        'named-production-path-test: packages/desktop/test/unit/specs/exportHtml.spec.ts#exportStyledHTML — wrapper parity + packages/desktop/test/e2e/export-pdf.spec.ts#PDF export to a real file (item 231)',
      'phase0.item.afdb7841a2decb8ceb69f966':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-readme-production-capabilities.spec.ts#readme-feature:3d27e259bc96 proves every objective subclaim at its public production seam',
      'phase0.item.338c11d2187ce7aa541bbe3a':
        'named-production-path-test: packages/desktop/test/e2e/view-modes.spec.ts#View modes',
      'phase0.item.e25bdfbf46b8677e8a5d4b7a':
        'named-production-path-test: packages/muya/src/clipboard/__tests__/parityImagePaste.spec.ts#parity PG5: binary/bitmap clipboard image paste',
      'phase0.item.8ccf372e15eba602206783f6':
        'named-production-path-test: packages/muya/test/spec/commonmark.spec.ts#CommonMark 0.31 spec conformance + packages/muya/test/spec/gfm.spec.ts#GFM 0.29-gfm spec conformance + packages/muya/test/spec/roundTrip.spec.ts#marktext markdown-basic round-trip',
      'phase0.item.7e0aa4fe32d42246ca2af051':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-readme-production-capabilities.spec.ts#muya-readme-feature:3f2f1ac8d864 proves every objective subclaim at its public production seam + packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.f498439c9dc434f7ca24cca5':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-readme-production-capabilities.spec.ts#muya-readme-feature:30de6cbcfc7d proves every objective subclaim at its public production seam + packages/desktop/test/unit/specs/criticmarkup-editor-plugin-production-surfaces.spec.ts#registers every editor plugin with exact options once per renderer',
      'phase0.item.ef200cd1ceef55f8f1e094ca':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-readme-production-capabilities.spec.ts#muya-readme-feature:e447f6844445 proves every objective subclaim at its public production seam',
      'phase0.item.81c4f4154230199c00008949':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-readme-production-capabilities.spec.ts#muya-readme-feature:ac0cb96fc735 proves every objective subclaim at its public production seam',
      'phase0.item.00e3c785fafc2411e7058632':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-readme-production-capabilities.spec.ts#muya-readme-feature:422f2e921e62 proves every objective subclaim at its public production seam',
      'phase0.item.439b080e59d5af228df72c53':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-readme-production-capabilities.spec.ts#muya-readme-feature:9bf7137484d1 proves every objective subclaim at its public production seam',
      'phase0.item.7265e41fc785d5c77dd18db5':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-readme-production-capabilities.spec.ts#muya-readme-feature:6618a086adb9 proves every objective subclaim at its public production seam',
      'phase0.item.112b59f0d798550476e4c0c8':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-readme-production-capabilities.spec.ts#muya-readme-feature:f0ccce744042 proves every objective subclaim at its public production seam',
      'phase0.item.0c53ef6a10be597a5a1146cb':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-muya-package-consumer.spec.ts#ships self-contained public types to a blank TypeScript consumer'
    })
    expect(materialized.parityRows.rows.filter(row => (
      row.productionPathTest.startsWith('required-new-production-path-test:')
    ))).toHaveLength(0)
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

    const unrelatedSalvageBaseline = structuredClone(salvageBaseline)
    unrelatedSalvageBaseline.baselineCommit = ratified.evidenceCommit
    expect(() => materializeCriticMarkupPhase0Dispositions(repoRoot, {
      parityBaseline,
      parityProposal,
      parityOracleProposal,
      salvageBaseline: unrelatedSalvageBaseline,
      salvageProposal,
      approval: ratified
    })).toThrow(/salvage lineage baseline must be an ancestor of the working baseline/)

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

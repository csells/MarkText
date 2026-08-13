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
      'phase0.item.0030c6e658a95827b05f3e99':
        'named-production-path-test: packages/desktop/test/unit/specs/file-save-production-surfaces.spec.ts#routes registered Save and Save As command and menu surfaces to the renderer save barriers',
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
      'phase0.item.20a0482a18ee9492c64be652':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-bullet-list-production-surfaces.spec.ts#routes registered Bullet List command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.2e64fc29fc59f5b4a906ea56':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-highlight-format-production-surfaces.spec.ts#routes registered Highlight command and Format menu surface through the renderer format-action channel',
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
      'phase0.item.49512fbea5ebc0a05d0e8023':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-production-surfaces.spec.ts#routes Edit menu Undo and Redo through the renderer edit-action channel',
      'phase0.item.503ba3b99614737f7f991c9e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-create-paragraph-production-surfaces.spec.ts#routes registered Create Paragraph command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.4c3b89bf6f9ec79ffc815408':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-subscript-production-surfaces.spec.ts#routes registered Subscript command and Format menu surface through the renderer format-action channel',
      'phase0.item.5a233c1c0b730f92c8b26b77':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-native-copy-production-surfaces.spec.ts#routes registered Copy command and Edit menu surfaces through the Electron native copy runtime',
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
      'phase0.item.59db1e63aacaf4964b8df1b1':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-ordered-list-production-surfaces.spec.ts#routes registered Ordered List command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.6503ef62074e1a51ee15fb38':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-find-navigation-production-surfaces.spec.ts#routes registered Find Next and Find Previous command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.6c5fc1de22b21cbc5e138455':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-strikethrough-production-surfaces.spec.ts#routes registered Strike-through command and Format menu Strikethrough surface through the renderer format-action channel',
      'phase0.item.6dc202f2b36d66fa10d2dbb3':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-strong-format-production-surfaces.spec.ts#routes registered Strong command and Bold menu surfaces through the renderer format-action channel',
      'phase0.item.6ef94e99e33b332cdce273ec':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-production-surfaces.spec.ts#routes Edit menu Undo and Redo through the renderer edit-action channel',
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
      'phase0.item.831628c66c7632b18ae126fd':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-production-surfaces.spec.ts#routes registered Undo and Redo commands to the renderer edit-action channel',
      'phase0.item.84fbe7795c97058036d7c916':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-ordered-list-production-surfaces.spec.ts#routes registered Ordered List command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.865771ab05fea47f0b4e86fd':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-image-format-production-surfaces.spec.ts#routes registered Image command and Format menu surface through the renderer format-action channel',
      'phase0.item.867cc6c717a7baf2684a9c87':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-replace-production-surfaces.spec.ts#routes registered Replace command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.8aaa24678c1a92cf623b43b0':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-inline-math-production-surfaces.spec.ts#routes registered Inline Math command and Format menu surface through the renderer format-action channel',
      'phase0.item.82b57f93ae32b97bc090d680':
        'named-production-path-test: packages/desktop/test/unit/specs/file-change-content-check.spec.ts#does not compare disk bytes with stale Pinia while Core owns the document',
      'phase0.item.91c0c4cd322d1531a3e7c9ea':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-paste-as-plain-text-production-surfaces.spec.ts#routes registered Paste as Plain Text command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.919af8120487b9e837e1ea14':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-inline-code-production-surfaces.spec.ts#routes registered Inline Code command and Format menu surface through the renderer format-action channel',
      'phase0.item.94245f0a016ba18f4cd75b5a':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-find-navigation-production-surfaces.spec.ts#routes registered Find Next and Find Previous command and Edit menu surfaces through the renderer edit-action channel',
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
      'phase0.item.ae9c22aeff42460c77efb79b':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-strong-format-production-surfaces.spec.ts#routes registered Strong command and Bold menu surfaces through the renderer format-action channel',
      'phase0.item.a31d9a0b8efebb43304be453':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-find-in-folder-production-surfaces.spec.ts#routes registered Find in Folder command and Edit menu surfaces through the renderer edit-action channel',
      'phase0.item.b327952319820e0956248ea0':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-projected-copy-production-surfaces.spec.ts#routes Edit menu Copy as Rich and Copy as HTML entries to the editor',
      'phase0.item.b9a01f70d274b7ff1480da76':
        'named-production-path-test: packages/desktop/test/unit/specs/flush-before-save.spec.ts#waits for Core authority and saves its acknowledged source instead of Pinia',
      'phase0.item.c8a0caaadc6be3cf5bcd988e':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-clear-format-production-surfaces.spec.ts#routes registered Clear Format command and Format menu surface through the renderer format-action channel',
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
      'phase0.item.e5b3aa0ed74e8f679eb30fc7':
        'named-production-path-test: packages/desktop/test/unit/specs/file-save-production-surfaces.spec.ts#routes registered Save and Save As command and menu surfaces to the renderer save barriers',
      'phase0.item.e9ed537dc5b08910ab2e2406':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-underline-production-surfaces.spec.ts#routes registered Underline command and Format menu surface through the renderer format-action channel',
      'phase0.item.ec98d87a0d244b1a3df19848':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-bullet-list-production-surfaces.spec.ts#routes registered Bullet List command and Paragraph menu surface through the renderer paragraph-action channel',
      'phase0.item.eba6acc288c5b6b240e283f7':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-highlight-format-production-surfaces.spec.ts#routes registered Highlight command and Format menu surface through the renderer format-action channel',
      'phase0.item.e37d7c32ed645c4702548f07':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-projected-cut-production-surfaces.spec.ts#routes registered Cut command and Edit menu surfaces through the Electron native cut runtime',
      'phase0.item.ed75c2e03726b7d71723d712':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-projected-paste-production-surfaces.spec.ts#routes registered Paste command and Edit menu surfaces through the Electron native paste runtime',
      'phase0.item.fa4e61798208bb8ac4978df6':
        'named-production-path-test: packages/desktop/test/unit/specs/criticmarkup-select-all-production-surfaces.spec.ts#routes registered Select All command and Edit menu surfaces through the renderer edit-action channel'
    })
    expect(materialized.parityRows.rows.filter(row => (
      row.productionPathTest.startsWith('required-new-production-path-test:')
    ))).toHaveLength(290)
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

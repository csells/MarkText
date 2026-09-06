import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  extractCriticMarkupProfileRuleIds,
  validateCriticMarkupProfileConformance
} from '../../../../../scripts/criticmarkupProfileConformance'

const repoRoot = resolve(import.meta.dirname, '../../../../..')

const profilePath = 'specs/language/marktext-markdown-profile-1.md'
const profileDigest = (): string => createHash('sha256')
  .update(readFileSync(resolve(repoRoot, profilePath))).digest('hex')
// The archived map is not a completion gate under plan 0011. These fixtures
// exercise structural validation against current text without changing the
// archived map, reviewing its semantic expectations, or ratifying a profile.
const structuralFixture = (): unknown => {
  const manifest = JSON.parse(readFileSync(resolve(
    repoRoot, 'specs/baselines/criticmarkup-profile-conformance.json'
  ), 'utf8'))
  manifest.profile.sha256 = profileDigest()
  return manifest
}

describe('CriticMarkup Profile 1 conformance-map structure', () => {
  it('continues rejecting stale identity in synthetic structural fixtures', () => {
    const manifest = structuralFixture() as { profile: { sha256: string } }
    manifest.profile.sha256 = '0'.repeat(64)
    expect(() => validateCriticMarkupProfileConformance(repoRoot, manifest))
      .toThrow(/targets a different Profile 1 revision/)
  })

  it('rejects duplicate normative rule IDs in the pinned Profile source', () => {
    const profile = readFileSync(resolve(
      repoRoot,
      'specs/language/marktext-markdown-profile-1.md'
    ), 'utf8')

    expect(() => extractCriticMarkupProfileRuleIds(
      `${profile}\n- **P1 — Duplicate normative declaration.**\n`
    )).toThrow(/duplicate normative rule ID P1/)
  })

  it('does not let semantic rules replace conformance cases with governance prose', () => {
    const manifest = structuralFixture() as {
      rules: Array<{
        id: string
        cases?: string[]
        governanceEvidence?: Array<{ ref: string, rationale: string }>
      }>
      cases: Array<{ id: string }>
    }
    const rule = manifest.rules.find(candidate => candidate.id === 'P1')
    if (rule === undefined) throw new Error('Fixture is missing P1')
    delete rule.cases
    rule.governanceEvidence = [{
      ref: 'specs/language/marktext-markdown-profile-1.md#1-scope-and-design-principles',
      rationale: 'Governance prose is not an executable semantic result.'
    }]
    manifest.cases = manifest.cases.filter(candidate => candidate.id !== 'case-P1')

    expect(() => validateCriticMarkupProfileConformance(repoRoot, manifest)).toThrow(
      /Semantic Profile rule P1 requires a conformance case/
    )
  })

  it('rejects conformance cases with an operation the structural schema does not define', () => {
    const manifest = structuralFixture() as { cases: Array<{ id: string, operation: string }> }
    manifest.cases[0].operation = 'invented-operation'

    expect(() => validateCriticMarkupProfileConformance(repoRoot, manifest)).toThrow(
      /Profile case case-P1 operation is unsupported/
    )
  })

  it('rejects conformance cases that name no expected observable', () => {
    const manifest = structuralFixture() as { cases: Array<{ id: string, expectedObservable: Record<string, unknown> }> }
    manifest.cases[0].expectedObservable = {}

    expect(() => validateCriticMarkupProfileConformance(repoRoot, manifest)).toThrow(
      /Profile case case-P1 expectedObservable must name at least one result/
    )
  })

  it('does not accept an invented provenance string as independent review', () => {
    const manifest = structuralFixture() as {
      cases: Array<{
        id: string
        provenance: string
        status: string
        reviewEvidence?: unknown
      }>
    }
    manifest.cases[0].provenance = 'invented'
    manifest.cases[0].status = 'reviewed'
    delete manifest.cases[0].reviewEvidence

    expect(() => validateCriticMarkupProfileConformance(repoRoot, manifest)).toThrow(
      /Reviewed Profile case case-P1 requires independent review evidence/
    )
  })

  it('rejects reviewed status backed by a stale review record', () => {
    const manifest = structuralFixture() as {
      cases: Array<{
        id: string
        status: string
        reviewEvidence?: {
          reviewer: string
          reviewedAt: string
          ref: string
        }
      }>
    }
    manifest.cases[0].status = 'reviewed'
    manifest.cases[0].reviewEvidence = {
      reviewer: 'Independent reviewer',
      reviewedAt: '2026-08-12T12:00:00.000Z',
      ref: 'specs/language/marktext-markdown-profile-1.md#not-a-review-record'
    }

    expect(() => validateCriticMarkupProfileConformance(repoRoot, manifest)).toThrow(
      /Reviewed Profile case case-P1 review reference does not resolve/
    )
  })

  it('rejects stale governance evidence anchors', () => {
    const manifest = structuralFixture() as {
      rules: Array<{
        id: string
        governanceEvidence?: Array<{ ref: string, rationale: string }>
      }>
    }
    const rule = manifest.rules.find(candidate => candidate.id === 'P5')
    if (rule?.governanceEvidence === undefined) {
      throw new Error('Fixture is missing P5 governance evidence')
    }
    rule.governanceEvidence[0].ref =
      'specs/language/marktext-markdown-profile-1.md#not-a-real-profile-heading'

    expect(() => validateCriticMarkupProfileConformance(repoRoot, manifest)).toThrow(
      /Profile rule P5 governance evidence ref does not resolve/
    )
  })

  it('does not let the structural map claim Profile ratification', () => {
    const manifest = structuralFixture() as { status: string }
    manifest.status = 'ratified'

    expect(() => validateCriticMarkupProfileConformance(repoRoot, manifest)).toThrow(
      /Profile conformance map must remain structural-draft-unratified/
    )
  })

  it('requires all 44 rules while keeping the complete structural map unreviewed', () => {
    expect(() => validateCriticMarkupProfileConformance(repoRoot, {
      schema: 'marktext-criticmarkup-profile-conformance-v1',
      status: 'structural-draft-unratified',
      profile: {
        path: 'specs/language/marktext-markdown-profile-1.md',
        sha256: profileDigest()
      },
      rules: [],
      cases: []
    })).toThrow(/44 missing Profile 1 rule mappings/)

    const profile = readFileSync(resolve(
      repoRoot,
      'specs/language/marktext-markdown-profile-1.md'
    ), 'utf8')
    const manifest = structuralFixture() as { status: string, cases: Array<{ status: string }> }
    expect(extractCriticMarkupProfileRuleIds(profile)).toHaveLength(44)
    expect(() => validateCriticMarkupProfileConformance(repoRoot, manifest)).not.toThrow()
    expect(manifest.status).toBe('structural-draft-unratified')
    expect(manifest.cases.every(candidate =>
      candidate.status === 'proposed-unreviewed'
    )).toBe(true)
  })
})

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  extractCriticMarkupProfileRuleIds,
  extractProfile2RuleIds,
  validateCriticMarkupProfileConformance
} from '../../../../../scripts/criticmarkupProfileConformance'

const repoRoot = resolve(import.meta.dirname, '../../../../..')

const profilePath = 'specs/language/marktext-markdown-profile-1.md'
const profileDigest = (): string => createHash('sha256')
  .update(readFileSync(resolve(repoRoot, profilePath))).digest('hex')
// The committed map pins Profile 1 and both Profile 2 documents (plan 0012
// G44). Structural validation neither reviews its expectations nor ratifies a
// profile; each fixture is a fresh copy of the committed map.
const structuralFixture = (): unknown => JSON.parse(readFileSync(resolve(
  repoRoot, 'specs/baselines/criticmarkup-profile-conformance.json'
), 'utf8'))

type Profile2Fixture = {
  profile2: Array<{ path: string, sha256: string, rules: Array<{ id: string, tests: Array<{ file: string, name: string }> }> }>
}
const profile2Document = (manifest: Profile2Fixture, path: string) => {
  const document = manifest.profile2.find(candidate => candidate.path === path)
  if (document === undefined) throw new Error(`No mapping for ${path}`)
  return document
}
const firstRule = (manifest: Profile2Fixture, path: string) => {
  const rule = profile2Document(manifest, path).rules[0]
  if (rule === undefined) throw new Error(`No rules for ${path}`)
  return rule
}
const firstTest = (manifest: Profile2Fixture, path: string) => {
  const test = firstRule(manifest, path).tests[0]
  if (test === undefined) throw new Error(`No tests for ${path}`)
  return test
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
      schema: 'marktext-criticmarkup-profile-conformance-v2',
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

describe('CriticMarkup Profile 2 and Markdown Profile 2 conformance mappings', () => {
  const criticMarkup2 = 'specs/language/marktext-criticmarkup-profile-2.md'
  const markdown2 = 'specs/language/marktext-markdown-profile-2.md'

  it('accepts the committed map for the current Profile 1 and Profile 2 texts', () => {
    expect(() => validateCriticMarkupProfileConformance(repoRoot, structuralFixture())).not.toThrow()
    const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')
    expect(extractProfile2RuleIds(read(criticMarkup2))).toEqual(['L2c', 'L1f', 'L2b', 'C3', 'V6'])
    expect(extractProfile2RuleIds(read(markdown2))).toEqual(['IL1', 'IL2', 'IL3', 'IL4', 'IL5'])
  })

  it('rejects a stale Profile 2 digest', () => {
    const manifest = structuralFixture() as Profile2Fixture
    profile2Document(manifest, markdown2).sha256 = '0'.repeat(64)
    expect(() => validateCriticMarkupProfileConformance(repoRoot, manifest))
      .toThrow(/targets a different revision of specs\/language\/marktext-markdown-profile-2.md/)
  })

  it('requires every Profile 2 rule to be mapped to a test that executes it', () => {
    const manifest = structuralFixture() as Profile2Fixture
    const document = profile2Document(manifest, criticMarkup2)
    document.rules = document.rules.filter(rule => rule.id !== 'L1f')
    expect(() => validateCriticMarkupProfileConformance(repoRoot, manifest)).toThrow(/missing .* rule mappings: L1f/)

    const empty = structuralFixture() as Profile2Fixture
    firstRule(empty, criticMarkup2).tests = []
    expect(() => validateCriticMarkupProfileConformance(repoRoot, empty)).toThrow(/rule L2c requires a test that executes it/)
  })

  it('rejects a test the named spec does not define, or a spec no gate runs', () => {
    const renamed = structuralFixture() as Profile2Fixture
    firstTest(renamed, markdown2).name = 'a test nobody wrote'
    expect(() => validateCriticMarkupProfileConformance(repoRoot, renamed)).toThrow(/does not define: a test nobody wrote/)

    const ungated = structuralFixture() as Profile2Fixture
    firstTest(ungated, markdown2).file = 'packages/desktop/test/e2e/criticmarkup-image-size.spec.ts'
    expect(() => validateCriticMarkupProfileConformance(repoRoot, ungated)).toThrow(/is not a gated unit spec/)
  })

  it('rejects a duplicate rule heading in a Profile 2 document', () => {
    expect(() => extractProfile2RuleIds('## C3 — one\n\n## C3 — two\n')).toThrow(/duplicate rule ID C3/)
  })
})

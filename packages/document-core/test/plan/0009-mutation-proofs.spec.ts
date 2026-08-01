import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..'
)

const read = (relative: string): string =>
  readFileSync(resolve(REPO_ROOT, relative), 'utf8')

interface MutationProof {
  readonly id: string
  readonly mutation: Readonly<{
    file: string
    exactOld: string
    exactNew: string
    statement: string
  }>
  readonly baseline?: Readonly<{
    command: string
    outcome: string
    at: string
  }>
  readonly mutated?: Readonly<{ outcome: string; failureExcerpt: string }>
  readonly recordedAt?: string
  readonly finding?: string
}

// G9: a mutation proof is evidence only while it stays two-sided and
// anchored — a record whose exactOld no longer matches the production file
// is stale, and a record without both outcomes is assertion presence, not
// proof. Completeness over all 42 targets is the gap's closure condition
// and binds at the final-closure gate; this spec keeps every retained
// record honest along the way.
describe('0009 mutation proofs', () => {
  const proofs = JSON.parse(
    read('specs/migration/0009-mutation-proofs.yml')
  ) as Readonly<{ schema: string; proofs: readonly MutationProof[] }>
  const acceptance = JSON.parse(
    read('specs/migration/0009-acceptance.yml')
  ) as Readonly<{ acceptance: readonly Readonly<{ id: string }>[] }>

  it('names real targets exactly once', () => {
    expect(proofs.schema).toBe('marktext-0009-mutation-proofs-v1')
    expect(proofs.proofs.length).toBeGreaterThanOrEqual(1)
    const targetIds = new Set(acceptance.acceptance.map((entry) => entry.id))
    const seen = new Set<string>()
    for (const proof of proofs.proofs) {
      expect(targetIds.has(proof.id), proof.id).toBe(true)
      expect(seen.has(proof.id), proof.id).toBe(false)
      seen.add(proof.id)
    }
  })

  it('keeps every recorded proof two-sided and anchored', () => {
    for (const proof of proofs.proofs) {
      const { mutation } = proof
      for (const field of [
        mutation.file,
        mutation.exactOld,
        mutation.exactNew,
        mutation.statement
      ]) {
        expect(typeof field, proof.id).toBe('string')
        expect(field.length, proof.id).toBeGreaterThan(0)
      }
      expect(mutation.exactOld, proof.id).not.toBe(mutation.exactNew)
      // Staleness anchor: the stated mutation must still be exact against
      // the production file it names.
      const source = read(mutation.file)
      expect(
        source.split(mutation.exactOld).length - 1,
        `${proof.id}: exactOld must match ${mutation.file} exactly once`
      ).toBe(1)
      if (proof.baseline === undefined || proof.mutated === undefined) {
        // An authored-but-unrun mutation is pending work, not evidence; it
        // may not carry partial results, and a one-sided outcome must be
        // recorded as a finding, never forged into results.
        expect(proof.recordedAt, proof.id).toBeUndefined()
        if (proof.finding !== undefined) {
          expect(proof.finding.length, proof.id).toBeGreaterThan(40)
        }
        continue
      }
      expect(proof.baseline.outcome, proof.id).toBe('pass')
      expect(proof.baseline.command.length, proof.id).toBeGreaterThan(0)
      expect(Number.isNaN(Date.parse(proof.baseline.at)), proof.id).toBe(false)
      expect(proof.mutated.outcome, proof.id).toBe('fail')
      expect(
        proof.mutated.failureExcerpt.length,
        proof.id
      ).toBeGreaterThan(0)
      expect(
        Number.isNaN(Date.parse(proof.recordedAt ?? '')),
        proof.id
      ).toBe(false)
    }
  })
})

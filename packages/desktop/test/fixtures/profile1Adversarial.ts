import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface Profile1AdversarialCase {
  readonly id: string
  readonly tags: readonly string[]
  readonly source: string
  readonly criticKindsPreorder: readonly string[]
  readonly criticSourcePreorder: readonly string[]
  readonly originalSource: string
  readonly revisedSource: string
}

interface Profile1AdversarialCorpus {
  readonly schema: 'marktext-language-corpus-v1'
  readonly authority: 'marktext-profile-1'
  readonly cases: readonly Profile1AdversarialCase[]
}

export interface CriticMarkupDesktopCorpusRow {
  readonly id: string
  readonly tags: readonly string[]
  readonly source: string
  readonly options: Readonly<Record<string, never>>
  readonly normalization:
    | Readonly<{ kind: 'exact' }>
    | Readonly<{ kind: 'known'; output: string; reason: string }>
  readonly expected: Readonly<{
    itemTypes: readonly string[]
    itemRaw: readonly string[]
    original: string
    revised: string
  }>
}

const repoRoot = resolve(
  __dirname,
  '../../../..'
)
const corpusPath = resolve(
  repoRoot,
  'specs/migration/profile1-adversarial.yml'
)
const corpus = JSON.parse(
  readFileSync(corpusPath, 'utf8')
) as Profile1AdversarialCorpus

if (
  corpus.schema !== 'marktext-language-corpus-v1' ||
  corpus.authority !== 'marktext-profile-1'
) {
  throw new TypeError('The desktop fixture requires the target Profile 1 corpus')
}

export const CRITIC_MARKUP_CORPUS: readonly CriticMarkupDesktopCorpusRow[] =
  Object.freeze(corpus.cases.map((entry) => Object.freeze({
    id: entry.id.replace(/^P1A-/, '').toLowerCase(),
    tags: Object.freeze([...entry.tags]),
    source: entry.source,
    options: Object.freeze({}),
    normalization: Object.freeze({ kind: 'exact' as const }),
    expected: Object.freeze({
      itemTypes: Object.freeze([...entry.criticKindsPreorder]),
      itemRaw: Object.freeze([...entry.criticSourcePreorder]),
      original: entry.originalSource,
      revised: entry.revisedSource
    })
  })))

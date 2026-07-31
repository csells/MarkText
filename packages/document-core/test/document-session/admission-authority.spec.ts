import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  createAdmissionAuthority,
  EXACT_REPLAY,
  TYPED_GESTURE
} from '../../src/internal/session/admissionAuthority.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from '../../src/resourcePolicy.js'

const CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

function openBase(
  engine: ReturnType<typeof createLanguageEngine>,
  source: string
): CompleteDocumentRevision {
  const revision = engine.open(
    createSourceSnapshot(source),
    CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error(`Expected a complete base revision, got ${revision.kind}`)
  }
  return revision
}

// G34 §2 admission authority: one module turns base + edits + class into an
// admitted candidate or one named rejection, and it is the only caller of the
// language engine's reopen.
describe('admission authority', () => {
  it('is the only production caller of the language engine reopen', () => {
    const sourceRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../src'
    )
    const offenders: string[] = []
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry)
        if (statSync(path).isDirectory()) {
          walk(path)
          continue
        }
        if (!entry.endsWith('.ts')) {
          continue
        }
        if (!readFileSync(path, 'utf8').includes('.reopen(')) {
          continue
        }
        if (
          !path.endsWith('internal/session/admissionAuthority.ts') &&
          !path.endsWith('src/languageEngine.ts')
        ) {
          offenders.push(path)
        }
      }
    }
    walk(sourceRoot)
    expect(offenders).toEqual([])
  })

  it('admits a typed gesture with exact inverse edits', () => {
    const engine = createLanguageEngine()
    const base = openBase(engine, 'alpha beta gamma\n')
    const authority = createAdmissionAuthority(engine)
    const result = authority.admit(
      base,
      Object.freeze([{ start: 6, end: 10, insert: 'BETA' }]),
      TYPED_GESTURE
    )
    if (result.kind !== 'admitted') {
      throw new Error(`Expected admission, got ${result.class}`)
    }
    expect(result.revision.source.text).toBe('alpha BETA gamma\n')
    expect(result.source).toBe('alpha BETA gamma\n')
    let reverted = result.source
    for (const inverse of [...result.inverseEdits].reverse()) {
      reverted = reverted.slice(0, inverse.start) +
        inverse.insert + reverted.slice(inverse.end)
    }
    expect(reverted).toBe(base.source.text)
    expect(result.diagnostics).toBeDefined()
  })

  it('rejects a byte-identical candidate by name unless it is an exact replay', () => {
    const engine = createLanguageEngine()
    const base = openBase(engine, 'stable text\n')
    const authority = createAdmissionAuthority(engine)
    const noop = Object.freeze([{ start: 0, end: 6, insert: 'stable' }])
    expect(authority.admit(base, noop, TYPED_GESTURE)).toEqual({
      kind: 'rejected',
      class: 'no-source-change'
    })
    const replayed = authority.admit(base, noop, EXACT_REPLAY)
    expect(replayed.kind).toBe('admitted')
  })

  it('rejects a transaction over the resource policy by name', () => {
    const engine = createLanguageEngine()
    const base = openBase(engine, `${'x'.repeat(4_096)}\n`)
    const authority = createAdmissionAuthority(engine)
    const edits = Object.freeze(Array.from(
      { length:
        DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction + 1 },
      (_, ordinal) => Object.freeze({
        start: ordinal * 2,
        end: ordinal * 2 + 1,
        insert: 'y'
      })
    ))
    expect(authority.admit(base, edits, TYPED_GESTURE)).toEqual({
      kind: 'rejected',
      class: 'invalid-command-argument'
    })
  })

  it('admits a proven candidate without another parse', () => {
    const engine = createLanguageEngine()
    const base = openBase(engine, 'kernel base text\n')
    const candidate = openBase(engine, 'kernel PROVEN text\n')
    const authority = createAdmissionAuthority(engine)
    const beforeAdmit = engine.traversalCounts()
    const result = authority.admit(
      base,
      Object.freeze([{ start: 7, end: 11, insert: 'PROVEN' }]),
      Object.freeze({ kind: 'proven-candidate' as const, revision: candidate })
    )
    if (result.kind !== 'admitted') {
      throw new Error(`Expected admission, got ${result.class}`)
    }
    // The kernel already parsed and proved the candidate: admission reuses it
    // by identity and runs no second parse.
    expect(result.revision).toBe(candidate)
    expect(engine.traversalCounts()).toEqual(beforeAdmit)
  })

  it('proves the admitted revision matches its transaction bytes', () => {
    const engine = createLanguageEngine()
    const base = openBase(engine, 'proof base\n')
    const wrongCandidate = openBase(engine, 'entirely different\n')
    const authority = createAdmissionAuthority(engine)
    expect(() => authority.admit(
      base,
      Object.freeze([{ start: 0, end: 5, insert: 'PROOF' }]),
      Object.freeze({
        kind: 'proven-candidate' as const,
        revision: wrongCandidate
      })
    )).toThrow(/transaction/i)
  })

  // G8: the kernel's structural survivor proof guards every prepared intent,
  // not just the seven kernel-planned ones. Two-sided per G9: the same edit
  // admits through the real engine and rejects through an engine whose
  // reopen loses an untargeted node.
  it('proves untargeted nodes survive a typed-gesture admission', () => {
    const engine = createLanguageEngine()
    const base = openBase(engine, 'Alpha {++keep++} beta tail.\n')
    const edit = Object.freeze({
      start: base.source.text.length - 1,
      end: base.source.text.length - 1,
      insert: ' more'
    })

    const admitted = createAdmissionAuthority(engine).admit(
      base,
      Object.freeze([edit]),
      TYPED_GESTURE
    )
    expect(admitted.kind).toBe('admitted')

    const hideLastRoot = (
      revision: ReturnType<typeof engine.reopen>
    ): ReturnType<typeof engine.reopen> => {
      if (revision.kind !== 'complete') return revision
      if (revision.criticMarkup.rootCount === 0) return revision
      return Object.freeze({
        ...revision,
        criticMarkup: Object.freeze({
          ...revision.criticMarkup,
          rootCount: revision.criticMarkup.rootCount - 1
        })
      }) as typeof revision
    }
    const lossyEngine = Object.freeze({
      ...engine,
      reopen: (
        ...request: Parameters<typeof engine.reopen>
      ): ReturnType<typeof engine.reopen> =>
        hideLastRoot(engine.reopen(...request))
    })
    const rejected = createAdmissionAuthority(lossyEngine).admit(
      base,
      Object.freeze([edit]),
      TYPED_GESTURE
    )
    expect(rejected).toEqual({
      kind: 'rejected',
      class: 'semantic-postcondition-failed'
    })
  })
})

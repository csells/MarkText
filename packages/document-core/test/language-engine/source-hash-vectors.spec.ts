import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  fileHashV1,
  revisionSemanticHashV1,
  sourceHashV1
} from '@marktext/document-core'
import type { ParseConfiguration } from '@marktext/document-core'

interface SourceVector {
  readonly id: string
  readonly text?: string
  readonly utf16?: readonly number[]
  readonly sha256: string
}

interface FileVector {
  readonly id: string
  readonly bytes: readonly number[]
  readonly sha256: string
}

interface SemanticVector {
  readonly id: string
  readonly text: string
  readonly configuration: ParseConfiguration
  readonly sha256: string
}

interface HashVectors {
  readonly schema: string
  readonly source: readonly SourceVector[]
  readonly file: readonly FileVector[]
  readonly semantic: readonly SemanticVector[]
}

const VECTORS = JSON.parse(readFileSync(resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../specs/migration/hash-vectors.yml'
), 'utf8')) as HashVectors

function sourceText(vector: SourceVector): string {
  if (vector.text !== undefined) {
    return vector.text
  }
  if (vector.utf16 === undefined) {
    throw new Error(`Source hash vector ${vector.id} has no source payload`)
  }
  return String.fromCharCode(...vector.utf16)
}

function uint64BigEndian(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8)
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn)
    value >>= 8n
  }
  return bytes
}

function sourceHashOracle(source: string): string {
  const units = new Uint8Array(source.length * 2)
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index)
    units[index * 2] = unit >>> 8
    units[index * 2 + 1] = unit & 0xff
  }
  return createHash('sha256')
    .update('marktext:SourceHashV1\0', 'ascii')
    .update(uint64BigEndian(BigInt(source.length)))
    .update(units)
    .digest('hex')
}

function fileHashOracle(bytes: Uint8Array): string {
  return createHash('sha256')
    .update('marktext:FileHashV1\0', 'ascii')
    .update(uint64BigEndian(BigInt(bytes.length)))
    .update(bytes)
    .digest('hex')
}

describe('versioned document identity codecs', () => {
  it('round-trips exact source and known-answer identities', () => {
    expect(VECTORS.schema).toBe('marktext-hash-vectors-v1')
    for (const vector of VECTORS.source) {
      expect(sourceHashV1(sourceText(vector)), vector.id).toBe(vector.sha256)
    }
    for (const vector of VECTORS.file) {
      expect(fileHashV1(Uint8Array.from(vector.bytes)), vector.id)
        .toBe(vector.sha256)
    }
    for (const vector of VECTORS.semantic) {
      expect(
        revisionSemanticHashV1(sourceHashV1(vector.text), vector.configuration),
        vector.id
      ).toBe(vector.sha256)
    }
  })

  it('keeps decoded UTF-16 identity distinct from file-byte identity', () => {
    const decoded = '😀'
    const encoded = Uint8Array.from([0xf0, 0x9f, 0x98, 0x80])
    expect(sourceHashV1(decoded)).not.toBe(fileHashV1(encoded))
  })

  it('matches an independent SHA-256 oracle at framing and Unicode boundaries', () => {
    const sourceCases = [
      '\ufeff',
      '\r',
      '\n',
      '\udc00',
      'é',
      'e\u0301',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(63),
      'x'.repeat(64),
      'x'.repeat(65),
      '😀'.repeat(2_048)
    ]
    for (const source of sourceCases) {
      expect(sourceHashV1(source)).toBe(sourceHashOracle(source))
    }
    for (const length of [55, 56, 63, 64, 65, 4_096]) {
      const bytes = Uint8Array.from(
        { length },
        (_, index) => index % 251
      )
      expect(fileHashV1(bytes)).toBe(fileHashOracle(bytes))
    }
  })

  it('binds semantic identity to every configuration field', () => {
    const source = sourceHashV1('same source')
    const base: ParseConfiguration = {
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
    const baseline = revisionSemanticHashV1(source, base)
    const variants: readonly ParseConfiguration[] = [
      { ...base, criticMarkupProfile: 'marktext-profile-2' },
      { ...base, markdownProfile: 'markdown-profile-2' },
      {
        ...base,
        markdownOptions: {
          ...base.markdownOptions,
          gfm: false
        }
      },
      {
        ...base,
        markdownOptions: {
          ...base.markdownOptions,
          frontMatter: false
        }
      },
      {
        ...base,
        markdownOptions: {
          ...base.markdownOptions,
          math: false
        }
      },
      {
        ...base,
        markdownOptions: {
          ...base.markdownOptions,
          gitLabMath: true
        }
      },
      {
        ...base,
        markdownOptions: {
          ...base.markdownOptions,
          footnotes: true
        }
      },
      {
        ...base,
        markdownOptions: {
          ...base.markdownOptions,
          subscriptAndSuperscript: false
        }
      },
      {
        ...base,
        liveHtmlSafetyProfile:
          'live-html-safety-profile-2' as unknown as ParseConfiguration['liveHtmlSafetyProfile']
      },
      {
        ...base,
        executionBudget: {
          ...base.executionBudget,
          limitsProfile: 'test-unbounded'
        }
      },
      {
        ...base,
        executionBudget: {
          ...base.executionBudget,
          accountingSchema: 'syntax-accounting-2'
        }
      }
    ]
    for (const variant of variants) {
      expect(revisionSemanticHashV1(source, variant)).not.toBe(baseline)
    }
  })

  it('publishes the immutable source and semantic identities on a revision', () => {
    const configuration: ParseConfiguration = {
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
        limitsProfile: 'test-unbounded',
        accountingSchema: 'syntax-accounting-1'
      }
    }
    const text = 'before {++new++} after\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(text),
      configuration
    )
    const expectedSourceHash = sourceHashV1(text)

    expect(revision.sourceHash).toBe(expectedSourceHash)
    expect(revision.semanticHash).toBe(
      revisionSemanticHashV1(expectedSourceHash, configuration)
    )
  })
})

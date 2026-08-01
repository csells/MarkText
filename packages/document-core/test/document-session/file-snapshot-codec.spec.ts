import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  decodeFileSnapshot,
  encodeFileSnapshot,
  type FileEncodingV1
} from '../../src/fileSnapshot.js'

interface FileCase {
  readonly id: string
  readonly encoding: FileEncodingV1
  readonly signature: boolean
  readonly decodedSource?: string
  readonly decodedCodeUnitsHex?: readonly string[]
  readonly originalBytesHex: string
  readonly expectedNoopBytesHex: string
}

interface FileCorpus {
  readonly schema: string
  readonly cases: readonly FileCase[]
}

const corpusPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../specs/migration/file-corpus.yml'
)
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as FileCorpus

const bytesOf = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(hex, 'hex'))

const hexOf = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('hex')

const codeUnitsOf = (source: string): readonly string[] =>
  Object.freeze(
    Array.from(
      { length: source.length },
      (_, index) => source.charCodeAt(index).toString(16).padStart(4, '0')
    )
  )

describe('FileSnapshot codec', () => {
  it('decodes and no-op saves every frozen byte-fidelity fixture exactly', () => {
    expect(corpus.schema).toBe('marktext-file-corpus-v1')
    for (const fixture of corpus.cases) {
      const original = bytesOf(fixture.originalBytesHex)
      const snapshot = decodeFileSnapshot(original, fixture.encoding)

      expect(snapshot.encoding, fixture.id).toBe(fixture.encoding)
      expect(snapshot.signature, fixture.id).toBe(fixture.signature)
      if (fixture.decodedSource !== undefined) {
        expect(snapshot.source.text, fixture.id).toBe(fixture.decodedSource)
      } else {
        expect(codeUnitsOf(snapshot.source.text), fixture.id)
          .toEqual(fixture.decodedCodeUnitsHex)
      }
      expect(hexOf(encodeFileSnapshot(snapshot, snapshot.source.text)), fixture.id)
        .toBe(fixture.expectedNoopBytesHex)
    }
  })

  it('encodes an edited BOM-bearing source once and preserves its EOL spelling', () => {
    const fixture = corpus.cases.find((item) => item.id === 'utf8-bom-crlf')
    if (fixture === undefined) {
      throw new Error('Missing utf8-bom-crlf fixture')
    }
    const snapshot = decodeFileSnapshot(
      bytesOf(fixture.originalBytesHex),
      fixture.encoding
    )
    const edited = `${snapshot.source.text}tail\r\n`
    const encoded = encodeFileSnapshot(snapshot, edited)

    expect(hexOf(encoded).match(/efbbbf/g)).toHaveLength(1)
    expect(
      decodeFileSnapshot(encoded, fixture.encoding).source.text
    ).toBe(edited)
  })

  it('rejects edited UTF-8 containing an unpaired surrogate', () => {
    const snapshot = decodeFileSnapshot(
      bytesOf('616263'),
      'utf-8'
    )
    expect(() => encodeFileSnapshot(snapshot, 'abc\uD800')).toThrow(
      /unpaired surrogate/i
    )
    expect(snapshot.source.text).toBe('abc')
  })

  it('rejects malformed byte streams instead of replacing source', () => {
    expect(() => decodeFileSnapshot(bytesOf('ff'), 'utf-8')).toThrow(
      /invalid utf-8/i
    )
    expect(() => decodeFileSnapshot(bytesOf('ff'), 'utf-16le')).toThrow(
      /even byte length/i
    )
  })

  it('decodes the maximum ASCII snapshot without a JavaScript code-unit walk', () => {
    const bytes = new Uint8Array(32_000_000)
    bytes.fill('x'.charCodeAt(0))
    const startedAt = performance.now()

    const snapshot = decodeFileSnapshot(bytes, 'utf-8')
    const elapsedMs = performance.now() - startedAt

    expect(snapshot.source.text.length).toBe(32_000_000)
    expect(snapshot.source.text.charCodeAt(0)).toBe('x'.charCodeAt(0))
    expect(snapshot.source.text.charCodeAt(31_999_999))
      .toBe('x'.charCodeAt(0))
    // Bulk decode versus a per-code-unit walk differ by two orders of
    // magnitude; the bound scales for hosted-runner speed while keeping
    // that discriminating power.
    expect(elapsedMs).toBeLessThanOrEqual(process.env.CI ? 200 : 50)
  })
})

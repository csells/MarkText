import { createSourceSnapshot, type SourceSnapshot } from './sourceSnapshot.js'

export type FileEncodingV1 = 'utf-8' | 'utf-16le' | 'utf-16be'

export interface FileSnapshotV1 {
  readonly encoding: FileEncodingV1
  readonly signature: boolean
  readonly byteLength: number
  readonly source: SourceSnapshot
  /** Returns a defensive copy of the exact bytes obtained at open. */
  readonly readOriginalBytes: () => Uint8Array
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}

function hasSignature(bytes: Uint8Array, encoding: FileEncodingV1): boolean {
  if (encoding === 'utf-8') {
    return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  }
  if (encoding === 'utf-16le') {
    return bytes[0] === 0xff && bytes[1] === 0xfe
  }
  return bytes[0] === 0xfe && bytes[1] === 0xff
}

const NativeTextDecoder = (
  globalThis as typeof globalThis & {
    readonly TextDecoder: new(
      label?: string,
      options?: Readonly<{
        fatal?: boolean
        ignoreBOM?: boolean
      }>
    ) => Readonly<{
      decode: (input?: Uint8Array) => string
    }>
  }
).TextDecoder

const UTF8_DECODER = new NativeTextDecoder('utf-8', {
  fatal: true,
  // FileSnapshot owns BOM as canonical U+FEFF source, so decoding must not
  // consume it as transport metadata.
  ignoreBOM: true
})

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return UTF8_DECODER.decode(bytes)
  } catch (cause) {
    throw new TypeError('Invalid UTF-8 file byte stream', { cause })
  }
}

function decodeUtf16(
  bytes: Uint8Array,
  encoding: 'utf-16le' | 'utf-16be'
): string {
  if (bytes.length % 2 !== 0) {
    throw new TypeError(`${encoding} requires an even byte length`)
  }
  const chunks: string[] = []
  const units = new Uint16Array(Math.min(4096, bytes.length / 2))
  for (let start = 0; start < bytes.length; start += units.length * 2) {
    const count = Math.min(units.length, (bytes.length - start) / 2)
    for (let index = 0; index < count; index += 1) {
      const first = bytes[start + index * 2] ?? 0
      const second = bytes[start + index * 2 + 1] ?? 0
      units[index] = encoding === 'utf-16le'
        ? first | (second << 8)
        : (first << 8) | second
    }
    chunks.push(String.fromCharCode(...units.subarray(0, count)))
  }
  return chunks.join('')
}

function assertNoUnpairedSurrogate(source: string): void {
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = source.charCodeAt(index + 1)
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError(
          `UTF-8 cannot preserve unpaired surrogate at source offset ${String(index)}`
        )
      }
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError(
        `UTF-8 cannot preserve unpaired surrogate at source offset ${String(index)}`
      )
    }
  }
}

function encodeUtf16(
  source: string,
  encoding: 'utf-16le' | 'utf-16be'
): Uint8Array {
  const bytes = new Uint8Array(source.length * 2)
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index)
    if (encoding === 'utf-16le') {
      bytes[index * 2] = unit & 0xff
      bytes[index * 2 + 1] = unit >>> 8
    } else {
      bytes[index * 2] = unit >>> 8
      bytes[index * 2 + 1] = unit & 0xff
    }
  }
  return bytes
}

function encodeUtf8(source: string): Uint8Array {
  const bytes: number[] = []
  for (let index = 0; index < source.length; index += 1) {
    const first = source.charCodeAt(index)
    let codePoint = first
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = source.charCodeAt(index + 1)
      codePoint =
        0x1_0000 +
        ((first - 0xd800) << 10) +
        (second - 0xdc00)
      index += 1
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(
        0xc0 | (codePoint >>> 6),
        0x80 | (codePoint & 0x3f)
      )
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      )
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      )
    }
  }
  return Uint8Array.from(bytes)
}

/**
 * Decode one file without erasing BOM, EOL, invalid-Unicode, or final-EOL
 * distinctions that its declared encoding can represent exactly.
 */
export function decodeFileSnapshot(
  input: Uint8Array,
  encoding: FileEncodingV1
): FileSnapshotV1 {
  if (
    !ArrayBuffer.isView(input) ||
    input.BYTES_PER_ELEMENT !== Uint8Array.BYTES_PER_ELEMENT
  ) {
    throw new TypeError('File bytes must be a Uint8Array')
  }
  if (
    encoding !== 'utf-8' &&
    encoding !== 'utf-16le' &&
    encoding !== 'utf-16be'
  ) {
    throw new RangeError(`Unsupported file encoding: ${String(encoding)}`)
  }
  const bytes = copyBytes(new Uint8Array(
    input.buffer,
    input.byteOffset,
    input.byteLength
  ))
  const text = encoding === 'utf-8'
    ? decodeUtf8(bytes)
    : decodeUtf16(bytes, encoding)
  const readOriginalBytes = Object.freeze((): Uint8Array => copyBytes(bytes))
  return Object.freeze({
    encoding,
    signature: hasSignature(bytes, encoding),
    byteLength: bytes.length,
    source: createSourceSnapshot(text),
    readOriginalBytes
  })
}

/**
 * Encode canonical source for persistence.
 *
 * A no-op returns the original bytes; an edit encodes the actual canonical
 * U+FEFF value exactly once rather than asking an encoder to add a BOM.
 */
export function encodeFileSnapshot(
  snapshot: FileSnapshotV1,
  canonicalSource: string
): Uint8Array {
  if (typeof canonicalSource !== 'string') {
    throw new TypeError('Canonical source must be a string')
  }
  if (canonicalSource === snapshot.source.text) {
    return snapshot.readOriginalBytes()
  }
  if (snapshot.encoding === 'utf-8') {
    assertNoUnpairedSurrogate(canonicalSource)
    return encodeUtf8(canonicalSource)
  }
  return encodeUtf16(canonicalSource, snapshot.encoding)
}

import type { ParseConfiguration } from './revision.js'
import {
  createParseExecutionTracker,
  type ParseExecutionControl,
  type ParseExecutionTracker
} from './parseExecutionControl.js'

declare const sourceHashBrand: unique symbol
declare const fileHashBrand: unique symbol
declare const revisionSemanticHashBrand: unique symbol

export type SourceHashV1 = string & {
  readonly [sourceHashBrand]: 'SourceHashV1'
}

export type FileHashV1 = string & {
  readonly [fileHashBrand]: 'FileHashV1'
}

export type RevisionSemanticHashV1 = string & {
  readonly [revisionSemanticHashBrand]: 'RevisionSemanticHashV1'
}

// SHA-256 is defined modulo 2^32. Signed lanes preserve the same bits while
// keeping every compression operand in the engine's fast int32 representation.
const SHA256_INITIAL = Int32Array.from([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
])

const SHA256_ROUND = Int32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount))
}

/**
 * Dependency-free streaming SHA-256. document-core intentionally has no
 * runtime dependencies and no Node/DOM ambient library, so identity cannot
 * delegate to platform crypto without making the engine environment-specific.
 */
class Sha256 {
  readonly #state = Int32Array.from(SHA256_INITIAL)
  readonly #schedule = new Int32Array(64)
  readonly #buffer = new Uint8Array(64)
  #bufferLength = 0
  #byteLength = 0n
  #finished = false

  constructor(snapshot?: Sha256Snapshot) {
    if (snapshot === undefined) {
      return
    }
    this.#state.set(snapshot.state)
    this.#buffer.set(snapshot.buffer)
    this.#bufferLength = snapshot.bufferLength
    this.#byteLength = snapshot.byteLength
  }

  update(bytes: Uint8Array): void {
    if (this.#finished) {
      throw new Error('SHA-256 input was updated after finalization')
    }
    this.#byteLength += BigInt(bytes.length)
    let offset = 0
    if (this.#bufferLength > 0) {
      const take = Math.min(64 - this.#bufferLength, bytes.length)
      this.#buffer.set(bytes.subarray(0, take), this.#bufferLength)
      this.#bufferLength += take
      offset = take
      if (this.#bufferLength === 64) {
        this.#compress(this.#buffer, 0)
        this.#bufferLength = 0
      }
    }
    while (offset + 64 <= bytes.length) {
      this.#compress(bytes, offset)
      offset += 64
    }
    if (offset < bytes.length) {
      this.#buffer.set(bytes.subarray(offset), 0)
      this.#bufferLength = bytes.length - offset
    }
  }

  updateUtf16(value: string, start: number, length: number): void {
    if (this.#finished) {
      throw new Error('SHA-256 input was updated after finalization')
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(length) ||
      start < 0 ||
      length < 0 ||
      start + length > value.length
    ) {
      throw new RangeError('SHA-256 UTF-16 range is outside the input')
    }
    if (this.#bufferLength % 2 !== 0) {
      throw new Error('SHA-256 UTF-16 input is not code-unit aligned')
    }
    this.#byteLength += BigInt(length) * 2n
    let offset = start
    const end = start + length
    if (this.#bufferLength > 0) {
      const take = Math.min(
        (64 - this.#bufferLength) / 2,
        end - offset
      )
      for (let index = 0; index < take; index += 1) {
        const codeUnit = value.charCodeAt(offset + index)
        const byte = this.#bufferLength + index * 2
        this.#buffer[byte] = codeUnit >>> 8
        this.#buffer[byte + 1] = codeUnit & 0xff
      }
      this.#bufferLength += take * 2
      offset += take
      if (this.#bufferLength === 64) {
        this.#compress(this.#buffer, 0)
        this.#bufferLength = 0
      }
    }
    while (offset + 32 <= end) {
      this.#compressUtf16(value, offset)
      offset += 32
    }
    if (offset < end) {
      const remaining = end - offset
      for (let index = 0; index < remaining; index += 1) {
        const codeUnit = value.charCodeAt(offset + index)
        this.#buffer[index * 2] = codeUnit >>> 8
        this.#buffer[index * 2 + 1] = codeUnit & 0xff
      }
      this.#bufferLength = remaining * 2
    }
  }

  digestHex(): string {
    if (this.#finished) {
      throw new Error('SHA-256 input was finalized more than once')
    }
    this.#finished = true
    const finalBlock = new Uint8Array(128)
    finalBlock.set(this.#buffer.subarray(0, this.#bufferLength))
    finalBlock[this.#bufferLength] = 0x80
    const finalLength = this.#bufferLength < 56 ? 64 : 128
    let bitLength = this.#byteLength * 8n
    for (let index = 0; index < 8; index += 1) {
      finalBlock[finalLength - 1 - index] = Number(bitLength & 0xffn)
      bitLength >>= 8n
    }
    this.#compress(finalBlock, 0)
    if (finalLength === 128) {
      this.#compress(finalBlock, 64)
    }
    return [...this.#state]
      .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
      .join('')
  }

  snapshot(): Sha256Snapshot {
    if (this.#finished) {
      throw new Error('SHA-256 state was captured after finalization')
    }
    return {
      state: Int32Array.from(this.#state),
      buffer: Uint8Array.from(this.#buffer),
      bufferLength: this.#bufferLength,
      byteLength: this.#byteLength
    }
  }

  #compress(bytes: Uint8Array, offset: number): void {
    const words = this.#schedule
    for (let index = 0; index < 16; index += 1) {
      const byte = offset + index * 4
      words[index] = (
        (bytes[byte]! << 24) |
        (bytes[byte + 1]! << 16) |
        (bytes[byte + 2]! << 8) |
        bytes[byte + 3]!
      ) | 0
    }
    this.#compressSchedule()
  }

  #compressUtf16(value: string, offset: number): void {
    // SourceHashV1 frames UTF-16 code units big-endian. Seed the schedule
    // directly so a maximum document is not recopied through a byte buffer.
    const words = this.#schedule
    words[0] = (value.charCodeAt(offset) << 16) | value.charCodeAt(offset + 1)
    words[1] = (value.charCodeAt(offset + 2) << 16) | value.charCodeAt(offset + 3)
    words[2] = (value.charCodeAt(offset + 4) << 16) | value.charCodeAt(offset + 5)
    words[3] = (value.charCodeAt(offset + 6) << 16) | value.charCodeAt(offset + 7)
    words[4] = (value.charCodeAt(offset + 8) << 16) | value.charCodeAt(offset + 9)
    words[5] = (value.charCodeAt(offset + 10) << 16) | value.charCodeAt(offset + 11)
    words[6] = (value.charCodeAt(offset + 12) << 16) | value.charCodeAt(offset + 13)
    words[7] = (value.charCodeAt(offset + 14) << 16) | value.charCodeAt(offset + 15)
    words[8] = (value.charCodeAt(offset + 16) << 16) | value.charCodeAt(offset + 17)
    words[9] = (value.charCodeAt(offset + 18) << 16) | value.charCodeAt(offset + 19)
    words[10] = (value.charCodeAt(offset + 20) << 16) | value.charCodeAt(offset + 21)
    words[11] = (value.charCodeAt(offset + 22) << 16) | value.charCodeAt(offset + 23)
    words[12] = (value.charCodeAt(offset + 24) << 16) | value.charCodeAt(offset + 25)
    words[13] = (value.charCodeAt(offset + 26) << 16) | value.charCodeAt(offset + 27)
    words[14] = (value.charCodeAt(offset + 28) << 16) | value.charCodeAt(offset + 29)
    words[15] = (value.charCodeAt(offset + 30) << 16) | value.charCodeAt(offset + 31)
    this.#compressSchedule()
  }

  #compressSchedule(): void {
    const words = this.#schedule
    // Four-way schedule and eight-way round unrolling remove loop-carried
    // state shuffles without changing the FIPS 180-4 compression function.
    for (let index = 16; index < 64; index += 4) {
      let previous15 = words[index - 15]!
      let previous2 = words[index - 2]!
      let sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3)
      let sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10)
      words[index] = (
        words[index - 16]! +
        sigma0 +
        words[index - 7]! +
        sigma1
      ) >>> 0

      previous15 = words[index - 14]!
      previous2 = words[index - 1]!
      sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3)
      sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10)
      words[index + 1] = (
        words[index - 15]! +
        sigma0 +
        words[index - 6]! +
        sigma1
      ) | 0

      previous15 = words[index - 13]!
      previous2 = words[index]!
      sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3)
      sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10)
      words[index + 2] = (
        words[index - 14]! +
        sigma0 +
        words[index - 5]! +
        sigma1
      ) | 0

      previous15 = words[index - 12]!
      previous2 = words[index + 1]!
      sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3)
      sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10)
      words[index + 3] = (
        words[index - 13]! +
        sigma0 +
        words[index - 4]! +
        sigma1
      ) | 0
    }

    let a = this.#state[0]!
    let b = this.#state[1]!
    let c = this.#state[2]!
    let d = this.#state[3]!
    let e = this.#state[4]!
    let f = this.#state[5]!
    let g = this.#state[6]!
    let h = this.#state[7]!

    for (let index = 0; index < 64; index += 8) {
      let temporary = (
        h +
        (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) +
        (g ^ (e & (f ^ g))) +
        SHA256_ROUND[index]! +
        words[index]!
      ) | 0
      d = (d + temporary) | 0
      h = (
        temporary +
        (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) +
        ((a & b) | (c & (a | b)))
      ) | 0

      temporary = (
        g +
        (rotateRight(d, 6) ^ rotateRight(d, 11) ^ rotateRight(d, 25)) +
        (f ^ (d & (e ^ f))) +
        SHA256_ROUND[index + 1]! +
        words[index + 1]!
      ) | 0
      c = (c + temporary) | 0
      g = (
        temporary +
        (rotateRight(h, 2) ^ rotateRight(h, 13) ^ rotateRight(h, 22)) +
        ((h & a) | (b & (h | a)))
      ) | 0

      temporary = (
        f +
        (rotateRight(c, 6) ^ rotateRight(c, 11) ^ rotateRight(c, 25)) +
        (e ^ (c & (d ^ e))) +
        SHA256_ROUND[index + 2]! +
        words[index + 2]!
      ) | 0
      b = (b + temporary) | 0
      f = (
        temporary +
        (rotateRight(g, 2) ^ rotateRight(g, 13) ^ rotateRight(g, 22)) +
        ((g & h) | (a & (g | h)))
      ) | 0

      temporary = (
        e +
        (rotateRight(b, 6) ^ rotateRight(b, 11) ^ rotateRight(b, 25)) +
        (d ^ (b & (c ^ d))) +
        SHA256_ROUND[index + 3]! +
        words[index + 3]!
      ) | 0
      a = (a + temporary) | 0
      e = (
        temporary +
        (rotateRight(f, 2) ^ rotateRight(f, 13) ^ rotateRight(f, 22)) +
        ((f & g) | (h & (f | g)))
      ) | 0

      temporary = (
        d +
        (rotateRight(a, 6) ^ rotateRight(a, 11) ^ rotateRight(a, 25)) +
        (c ^ (a & (b ^ c))) +
        SHA256_ROUND[index + 4]! +
        words[index + 4]!
      ) | 0
      h = (h + temporary) | 0
      d = (
        temporary +
        (rotateRight(e, 2) ^ rotateRight(e, 13) ^ rotateRight(e, 22)) +
        ((e & f) | (g & (e | f)))
      ) | 0

      temporary = (
        c +
        (rotateRight(h, 6) ^ rotateRight(h, 11) ^ rotateRight(h, 25)) +
        (b ^ (h & (a ^ b))) +
        SHA256_ROUND[index + 5]! +
        words[index + 5]!
      ) | 0
      g = (g + temporary) | 0
      c = (
        temporary +
        (rotateRight(d, 2) ^ rotateRight(d, 13) ^ rotateRight(d, 22)) +
        ((d & e) | (f & (d | e)))
      ) | 0

      temporary = (
        b +
        (rotateRight(g, 6) ^ rotateRight(g, 11) ^ rotateRight(g, 25)) +
        (a ^ (g & (h ^ a))) +
        SHA256_ROUND[index + 6]! +
        words[index + 6]!
      ) | 0
      f = (f + temporary) | 0
      b = (
        temporary +
        (rotateRight(c, 2) ^ rotateRight(c, 13) ^ rotateRight(c, 22)) +
        ((c & d) | (e & (c | d)))
      ) | 0

      temporary = (
        a +
        (rotateRight(f, 6) ^ rotateRight(f, 11) ^ rotateRight(f, 25)) +
        (h ^ (f & (g ^ h))) +
        SHA256_ROUND[index + 7]! +
        words[index + 7]!
      ) | 0
      e = (e + temporary) | 0
      a = (
        temporary +
        (rotateRight(b, 2) ^ rotateRight(b, 13) ^ rotateRight(b, 22)) +
        ((b & c) | (d & (b | c)))
      ) | 0
    }

    this.#state[0] = (this.#state[0]! + a) | 0
    this.#state[1] = (this.#state[1]! + b) | 0
    this.#state[2] = (this.#state[2]! + c) | 0
    this.#state[3] = (this.#state[3]! + d) | 0
    this.#state[4] = (this.#state[4]! + e) | 0
    this.#state[5] = (this.#state[5]! + f) | 0
    this.#state[6] = (this.#state[6]! + g) | 0
    this.#state[7] = (this.#state[7]! + h) | 0
  }
}

interface Sha256Snapshot {
  readonly state: Int32Array
  readonly buffer: Uint8Array
  readonly bufferLength: number
  readonly byteLength: bigint
}

interface SourceHashCheckpointV1 {
  readonly sourceOffset: number
  readonly hash: Sha256Snapshot
}

export interface SourceHashCacheV1 {
  readonly sourceLength: number
  readonly checkpoints: readonly SourceHashCheckpointV1[]
}

export interface SourceHashWithCacheV1 {
  readonly hash: SourceHashV1
  readonly cache: SourceHashCacheV1
}

export interface SourceHashEditV1 {
  readonly start: number
  readonly end: number
  readonly insert: string
}

const SOURCE_HASH_CHECKPOINT_UNITS = 4_096

/**
 * Internal byte-oriented SHA-256 primitive for other versioned codecs.
 *
 * Callers own their framing and domain separation. Keeping the primitive here
 * avoids making document-core depend on a platform crypto implementation.
 */
export function sha256Bytes(...chunks: readonly Uint8Array[]): string {
  const hash = new Sha256()
  for (const chunk of chunks) {
    hash.update(chunk)
  }
  return hash.digestHex()
}

function writeAscii(hash: Sha256, value: string): void {
  const bytes = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit > 0x7f) {
      throw new TypeError('Hash framing identifier is not ASCII')
    }
    bytes[index] = codeUnit
  }
  hash.update(bytes)
}

function writeUint64(hash: Sha256, value: bigint): void {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError('Hash framing length is outside uint64')
  }
  const bytes = new Uint8Array(8)
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn)
    value >>= 8n
  }
  hash.update(bytes)
}

function writeBoolean(hash: Sha256, value: boolean): void {
  if (typeof value !== 'boolean') {
    throw new TypeError('Hash framing boolean is not a boolean')
  }
  hash.update(Uint8Array.of(value ? 1 : 0))
}

function writeUtf16(
  hash: Sha256,
  value: string,
  execution?: ParseExecutionTracker
): void {
  writeUint64(hash, BigInt(value.length))
  for (
    let start = 0;
    start < value.length;
    start += SOURCE_HASH_CHECKPOINT_UNITS
  ) {
    const length = Math.min(
      SOURCE_HASH_CHECKPOINT_UNITS,
      value.length - start
    )
    hash.updateUtf16(value, start, length)
    execution?.examineSource(length)
  }
}

function writeUtf16From(
  hash: Sha256,
  value: string,
  start: number,
  execution: ParseExecutionTracker | undefined,
  checkpoints: SourceHashCheckpointV1[]
): void {
  for (
    let chunkStart = start;
    chunkStart < value.length;
    chunkStart += SOURCE_HASH_CHECKPOINT_UNITS
  ) {
    const length = Math.min(
      SOURCE_HASH_CHECKPOINT_UNITS,
      value.length - chunkStart
    )
    hash.updateUtf16(value, chunkStart, length)
    execution?.examineSource(length)
    checkpoints.push({
      sourceOffset: chunkStart + length,
      hash: hash.snapshot()
    })
  }
}

function createFramedHash(name: string): Sha256 {
  const hash = new Sha256()
  writeAscii(hash, `marktext:${name}\0`)
  return hash
}

/**
 * SHA-256 of `marktext:SourceHashV1\0`, an unsigned 64-bit code-unit count,
 * and the exact decoded UTF-16 units in big-endian order.
 */
export function sourceHashV1(
  source: string,
  executionControl?: ParseExecutionControl
): SourceHashV1 {
  const hash = createFramedHash('SourceHashV1')
  const execution = executionControl === undefined
    ? undefined
    : createParseExecutionTracker(executionControl)
  writeUtf16(hash, source, execution)
  execution?.finish()
  return hash.digestHex() as SourceHashV1
}

export function sourceHashV1WithCache(
  source: string,
  executionControl?: ParseExecutionControl
): SourceHashWithCacheV1 {
  const hash = createFramedHash('SourceHashV1')
  const execution = executionControl === undefined
    ? undefined
    : createParseExecutionTracker(executionControl)
  writeUint64(hash, BigInt(source.length))
  const checkpoints: SourceHashCheckpointV1[] = [{
    sourceOffset: 0,
    hash: hash.snapshot()
  }]
  writeUtf16From(hash, source, 0, execution, checkpoints)
  execution?.finish()
  return Object.freeze({
    hash: hash.digestHex() as SourceHashV1,
    cache: Object.freeze({
      sourceLength: source.length,
      checkpoints: Object.freeze(checkpoints)
    })
  })
}

export function reopenSourceHashV1WithCache(
  previous: SourceHashCacheV1,
  source: string,
  edits: readonly SourceHashEditV1[],
  executionControl?: ParseExecutionControl
): SourceHashWithCacheV1 {
  const preservesLength =
    previous.sourceLength === source.length &&
    edits.every((edit) => edit.end - edit.start === edit.insert.length)
  const firstEdit = edits[0]
  if (!preservesLength || firstEdit === undefined) {
    return sourceHashV1WithCache(source, executionControl)
  }
  const checkpointOffset =
    Math.floor(firstEdit.start / SOURCE_HASH_CHECKPOINT_UNITS) *
    SOURCE_HASH_CHECKPOINT_UNITS
  const checkpointIndex =
    checkpointOffset / SOURCE_HASH_CHECKPOINT_UNITS
  const checkpoint = previous.checkpoints[checkpointIndex]
  if (checkpoint?.sourceOffset !== checkpointOffset) {
    return sourceHashV1WithCache(source, executionControl)
  }
  const execution = executionControl === undefined
    ? undefined
    : createParseExecutionTracker(executionControl)
  const hash = new Sha256(checkpoint.hash)
  const checkpoints = previous.checkpoints.slice(0, checkpointIndex + 1)
  writeUtf16From(
    hash,
    source,
    checkpointOffset,
    execution,
    checkpoints
  )
  execution?.finish()
  return Object.freeze({
    hash: hash.digestHex() as SourceHashV1,
    cache: Object.freeze({
      sourceLength: source.length,
      checkpoints: Object.freeze(checkpoints)
    })
  })
}

/**
 * SHA-256 of `marktext:FileHashV1\0`, an unsigned 64-bit byte count, and the
 * exact bytes. Encoding identity therefore never aliases decoded-source
 * identity.
 */
export function fileHashV1(bytes: Uint8Array): FileHashV1 {
  const hash = createFramedHash('FileHashV1')
  writeUint64(hash, BigInt(bytes.length))
  hash.update(bytes)
  return hash.digestHex() as FileHashV1
}

/**
 * Revision identity binds a SourceHashV1 to every current parser contract
 * identifier. Field names and values are length-framed UTF-16 so later codecs
 * can add fields under a new version without ambiguous concatenation.
 */
export function revisionSemanticHashV1(
  source: SourceHashV1,
  configuration: ParseConfiguration
): RevisionSemanticHashV1 {
  if (!/^[0-9a-f]{64}$/.test(source)) {
    throw new TypeError('RevisionSemanticHashV1 requires a SourceHashV1')
  }
  const hash = createFramedHash('RevisionSemanticHashV1')
  writeAscii(hash, source)
  const profileFields = Object.freeze([
    ['criticMarkupProfile', configuration.criticMarkupProfile],
    ['markdownProfile', configuration.markdownProfile],
    ['markdownOptionsSchema', configuration.markdownOptions.schema]
  ] as const)
  for (const [name, value] of profileFields) {
    writeUtf16(hash, name)
    writeUtf16(hash, value)
  }
  writeBoolean(hash, configuration.markdownOptions.gfm)
  writeBoolean(hash, configuration.markdownOptions.frontMatter)
  writeBoolean(hash, configuration.markdownOptions.math)
  writeBoolean(hash, configuration.markdownOptions.gitLabMath)
  writeBoolean(hash, configuration.markdownOptions.footnotes)
  writeBoolean(hash, configuration.markdownOptions.subscriptAndSuperscript)
  const executionFields = Object.freeze([
    ['liveHtmlSafetyProfile', configuration.liveHtmlSafetyProfile],
    ['limitsProfile', configuration.executionBudget.limitsProfile],
    ['accountingSchema', configuration.executionBudget.accountingSchema]
  ] as const)
  for (const [name, value] of executionFields) {
    writeUtf16(hash, name)
    writeUtf16(hash, value)
  }
  return hash.digestHex() as RevisionSemanticHashV1
}

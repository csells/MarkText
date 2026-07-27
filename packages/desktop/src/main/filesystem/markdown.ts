import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { isDirectory2 } from 'common/filesystem'
import { isMarkdownFile } from 'common/filesystem/paths'
import { normalizeAndResolvePath } from '../filesystem'
import {
  decodeFileSnapshot,
  type FileEncodingV1,
  type FileSnapshotV1
} from '@marktext/document-core'

interface MarkdownDocumentRaw {
  readonly markdown: string
  readonly filename: string
  readonly pathname: string
}

const documentCoreFileSnapshots = new Map<string, FileSnapshotV1>()

/**
 * Return a defensive exact-byte snapshot retained by the most recent file
 * admission. This is main-process state and never crosses into renderer tab
 * payloads.
 */
export const getDocumentCoreFileSnapshot = (
  pathname: string
): FileSnapshotV1 | null => {
  const retained = documentCoreFileSnapshots.get(path.resolve(pathname))
  if (retained === undefined) return null
  return decodeFileSnapshot(
    retained.readOriginalBytes(),
    retained.encoding
  )
}

const startsWith = (
  bytes: Uint8Array,
  signature: readonly number[]
): boolean => signature.every((byte, index) => bytes[index] === byte)

const textPlausibility = (source: string): number => {
  let score = 0
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index)
    if (
      unit === 0x09 ||
      unit === 0x0a ||
      unit === 0x0d ||
      (unit >= 0x20 && unit <= 0x7e)
    ) {
      score += 4
    } else if (unit === 0 || unit < 0x20) {
      score -= 8
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = source.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        score += 2
        index += 1
      } else {
        score -= 1
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      score -= 1
    }
  }
  return score
}

const inferBomlessUtf16 = (
  bytes: Uint8Array
): Readonly<{ snapshot: FileSnapshotV1; score: number }> | null => {
  if (bytes.length % 2 !== 0) return null
  const littleEndian = decodeFileSnapshot(bytes, 'utf-16le')
  const bigEndian = decodeFileSnapshot(bytes, 'utf-16be')
  const littleScore = textPlausibility(littleEndian.source.text)
  const bigScore = textPlausibility(bigEndian.source.text)
  if (littleScore === bigScore) return null
  return Object.freeze({
    snapshot: littleScore > bigScore ? littleEndian : bigEndian,
    score: Math.max(littleScore, bigScore)
  })
}

/**
 * Decode only the exact encodings the document file contract can retain.
 * BOM-bearing files are deterministic. BOM-less UTF-16 is admitted only when
 * one byte order is strictly more text-like; ambiguous byte streams are
 * rejected visibly instead of being normalized through an unrelated codec.
 */
export const decodeDocumentFileSnapshot = (
  bytes: Uint8Array
): FileSnapshotV1 => {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    return decodeFileSnapshot(bytes, 'utf-8')
  }
  if (startsWith(bytes, [0xff, 0xfe])) {
    return decodeFileSnapshot(bytes, 'utf-16le')
  }
  if (startsWith(bytes, [0xfe, 0xff])) {
    return decodeFileSnapshot(bytes, 'utf-16be')
  }

  let utf16Candidate:
    | Readonly<{ snapshot: FileSnapshotV1; score: number }>
    | null = null
  if (bytes.includes(0)) {
    utf16Candidate = inferBomlessUtf16(bytes)
    // Ordinary BOM-less UTF-16 ASCII is also syntactically valid UTF-8 with a
    // NUL after every character. Prefer the clear UTF-16 byte-order signal.
    if (utf16Candidate !== null && utf16Candidate.score > 0) {
      return utf16Candidate.snapshot
    }
  }

  try {
    return decodeFileSnapshot(bytes, 'utf-8')
  } catch {
    // An invalid UTF-8 stream may still be exact BOM-less UTF-16.
  }

  if (bytes.length % 2 !== 0) {
    throw new TypeError(
      'File is not valid UTF-8 or an identifiable UTF-16 byte stream'
    )
  }
  utf16Candidate ??= inferBomlessUtf16(bytes)
  if (utf16Candidate === null) {
    throw new TypeError(
      'BOM-less UTF-16 byte order is ambiguous; file admission was rejected'
    )
  }
  return utf16Candidate.snapshot
}

export const detectDocumentFileEncoding = (
  bytes: Uint8Array
): FileEncodingV1 => decodeDocumentFileSnapshot(bytes).encoding

/**
 * Normalize a directory or Markdown pathname for the window router.
 */
export const normalizeMarkdownPath = (
  pathname: string
): { isDir: boolean; path: string } | null => {
  const isDir = isDirectory2(pathname)
  if (!isDir && !isMarkdownFile(pathname)) return null
  const resolved = normalizeAndResolvePath(pathname)
  if (resolved) return { isDir, path: resolved }
  console.error(`[ERROR] Cannot resolve "${pathname}".`)
  return null
}

/**
 * Read and retain one exact file snapshot for main-owned admission.
 */
export const loadMarkdownFile = async(
  pathname: string
): Promise<MarkdownDocumentRaw> => {
  const resolvedPath = path.resolve(pathname)
  const bytes = await fsPromises.readFile(resolvedPath)
  const snapshot = decodeDocumentFileSnapshot(bytes)
  documentCoreFileSnapshots.set(resolvedPath, snapshot)
  return Object.freeze({
    markdown: snapshot.source.text,
    filename: path.basename(pathname),
    pathname
  })
}

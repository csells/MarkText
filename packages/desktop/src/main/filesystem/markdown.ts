import { createHash } from 'crypto'
import fsPromises from 'fs/promises'
import path from 'path'
import log from 'electron-log'
import iconv from 'iconv-lite'
import { LINE_ENDING_REG, LF_LINE_ENDING_REG, CRLF_LINE_ENDING_REG } from '../config'
import { isDirectory2 } from 'common/filesystem'
import { isMarkdownFile } from 'common/filesystem/paths'
import { normalizeAndResolvePath, writeFile } from '../filesystem'
import { LossyDecodeError, decodesLosslessly, guessEncoding } from './encoding'
import type { Encoding } from 'common/encoding'
import type { LineEnding } from '@shared/types/files'

interface MarkdownDocumentOptions {
  adjustLineEndingOnSave: boolean
  lineEnding: LineEnding
  encoding: Encoding
}

interface MarkdownDocumentRaw {
  markdown: string
  filename: string
  pathname: string
  encoding: Encoding
  lineEnding: LineEnding
  adjustLineEndingOnSave: boolean
  trimTrailingNewline: number
  isMixedLineEndings: boolean
  /** Some bytes were not valid in `encoding`; the text shows U+FFFD in their place. */
  isLossyDecode: boolean
}

/**
 * The file as the last load or save left it, so saving the same text under the
 * same options writes the file's own bytes back instead of re-encoding them.
 * Only digests are kept: the bytes are re-read and verified at save time, so a
 * stale entry can never put old bytes over a file that changed since.
 */
interface DiskBaseline {
  textDigest: string
  /** Null when the load normalized line endings at the user's request, which the save must keep. */
  bytesDigest: string | null
  encoding: string
  isBom: boolean
  lineEnding: LineEnding
  adjustLineEndingOnSave: boolean
  isLossyDecode: boolean
}

const diskBaselines = new Map<string, DiskBaseline>()

const digest = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

// UTF-16 code units, so strings that differ only in lone surrogates never collide.
const digestText = (text: string): string =>
  createHash('sha256').update(text, 'utf16le').digest('hex')

const isSameSave = (
  baseline: DiskBaseline,
  textDigest: string,
  options: MarkdownDocumentOptions
): boolean =>
  baseline.textDigest === textDigest &&
  baseline.encoding === options.encoding.encoding &&
  baseline.isBom === !!options.encoding.isBom &&
  baseline.lineEnding === options.lineEnding &&
  baseline.adjustLineEndingOnSave === options.adjustLineEndingOnSave

const readBytesMatching = async(pathname: string, bytesDigest: string): Promise<Buffer | null> => {
  try {
    const bytes = await fsPromises.readFile(pathname)
    return digest(bytes) === bytesDigest ? bytes : null
  } catch {
    return null
  }
}

const getLineEnding = (lineEnding: LineEnding): string => {
  if (lineEnding === 'lf') {
    return '\n'
  } else if (lineEnding === 'crlf') {
    return '\r\n'
  }

  // This should not happen but use fallback value.
  log.error(`Invalid end of line character: expected "lf" or "crlf" but got "${lineEnding}".`)
  return '\n'
}

const convertLineEndings = (text: string, lineEnding: LineEnding): string => {
  return text.replace(LINE_ENDING_REG, getLineEnding(lineEnding))
}

/**
 * Special function to normalize directory and markdown file paths.
 * Returns the normalized path and a directory hint, or null if it's not a
 * directory or markdown file.
 */
export const normalizeMarkdownPath = (
  pathname: string
): { isDir: boolean; path: string } | null => {
  const isDir = isDirectory2(pathname)
  if (isDir || isMarkdownFile(pathname)) {
    const resolved = normalizeAndResolvePath(pathname)
    if (resolved) {
      return { isDir, path: resolved }
    } else {
      console.error(`[ERROR] Cannot resolve "${pathname}".`)
    }
  }
  return null
}

/**
 * Write the content into a file.
 *
 * Saving the text a load or save produced, under the same options, writes that
 * file's bytes back unchanged. Other text is encoded under `options`; if the
 * file's bytes did not survive decoding, that throws `LossyDecodeError` unless
 * `allowLossyDecode` records the user's consent.
 */
export const writeMarkdownFile = async(
  pathname: string,
  content: string,
  options: MarkdownDocumentOptions,
  { allowLossyDecode = false }: { allowLossyDecode?: boolean } = {}
): Promise<void> => {
  const target = path.extname(pathname) ? pathname : `${pathname}.md`
  const key = path.resolve(target)
  const textDigest = digestText(content)
  const baseline = diskBaselines.get(key)

  if (baseline?.bytesDigest && isSameSave(baseline, textDigest, options)) {
    const original = await readBytesMatching(target, baseline.bytesDigest)
    if (original !== null) {
      return writeFile(target, original, undefined, undefined)
    }
  }
  if (baseline?.isLossyDecode && !allowLossyDecode) {
    throw new LossyDecodeError(target, { encoding: baseline.encoding, isBom: baseline.isBom })
  }

  const { adjustLineEndingOnSave, lineEnding } = options
  const { encoding, isBom } = options.encoding
  const text = adjustLineEndingOnSave ? convertLineEndings(content, lineEnding) : content
  const buffer = iconv.encode(text, encoding, { addBOM: isBom })

  await writeFile(target, buffer, undefined, undefined)
  diskBaselines.set(key, {
    textDigest,
    bytesDigest: digest(buffer),
    encoding,
    isBom: !!isBom,
    lineEnding,
    adjustLineEndingOnSave,
    isLossyDecode: false
  })
}

/**
 * Reads the contents of a markdown file.
 */
export const loadMarkdownFile = async(
  pathname: string,
  preferredEol: LineEnding,
  autoGuessEncoding: boolean = true,
  trimTrailingNewline: number = 2,
  autoNormalizeLineEndings: boolean = false
): Promise<MarkdownDocumentRaw> => {
  // TODO: Use streams to not buffer the file multiple times and only guess
  //       encoding on the first 256/512 bytes.

  const buffer = await fsPromises.readFile(path.resolve(pathname))

  const encoding = guessEncoding(buffer, autoGuessEncoding)
  const supported = iconv.encodingExists(encoding.encoding)
  if (!supported) {
    throw new Error(`"${encoding.encoding}" encoding is not supported.`)
  }

  const decoded = iconv.decode(buffer, encoding.encoding)
  const isLossyDecode = !decodesLosslessly(buffer, decoded, encoding)
  let markdown = decoded

  // Detect line ending
  const isLf = LF_LINE_ENDING_REG.test(markdown)
  const isCrlf = CRLF_LINE_ENDING_REG.test(markdown)
  const isMixedLineEndings = isLf && isCrlf
  const isUnknownEnding = !isLf && !isCrlf
  let lineEnding: LineEnding = preferredEol
  if (isLf && !isCrlf) {
    lineEnding = 'lf'
  } else if (isCrlf && !isLf) {
    lineEnding = 'crlf'
  }

  let adjustLineEndingOnSave = false

  if (isMixedLineEndings || isUnknownEnding || lineEnding !== 'lf') {
    markdown = convertLineEndings(markdown, 'lf')
    // MarkText always uses LF internally. If the user did not request LF line
    // endings, we need to adjust on save.
    adjustLineEndingOnSave = !autoNormalizeLineEndings && lineEnding !== 'lf'
  }

  // Detect final newline
  if (trimTrailingNewline === 2) {
    if (!markdown) {
      trimTrailingNewline = 3
    } else {
      const lastIndex = markdown.length - 1
      if (lastIndex >= 1 && markdown[lastIndex] === '\n' && markdown[lastIndex - 1] === '\n') {
        trimTrailingNewline = 2
      } else if (markdown[lastIndex] === '\n') {
        trimTrailingNewline = 1
      } else {
        trimTrailingNewline = 0
      }
    }
  }

  diskBaselines.set(path.resolve(pathname), {
    textDigest: digestText(markdown),
    bytesDigest: autoNormalizeLineEndings && markdown !== decoded ? null : digest(buffer),
    encoding: encoding.encoding,
    isBom: !!encoding.isBom,
    lineEnding,
    adjustLineEndingOnSave,
    isLossyDecode
  })

  const filename = path.basename(pathname)

  return {
    markdown,
    filename,
    pathname,
    encoding,
    lineEnding,
    adjustLineEndingOnSave,
    trimTrailingNewline,
    isMixedLineEndings,
    isLossyDecode
  }
}

import { isUtf8 } from 'buffer'
import ced from 'ced'
import iconv from 'iconv-lite'
import type { Encoding } from 'common/encoding'

/**
 * Refuses an edited save of a file whose bytes did not survive decoding: the
 * save would replace them with what the editor shows, U+FFFD for bytes that
 * were not valid in `encoding`.
 */
export class LossyDecodeError extends Error {
  constructor(
    readonly pathname: string,
    readonly encoding: Encoding
  ) {
    super(`"${pathname}" contains bytes that are not valid ${encoding.encoding}.`)
    this.name = 'LossyDecodeError'
  }
}

/** Whether encoding `text` under `encoding` gives back exactly the `buffer` it was decoded from. */
export const decodesLosslessly = (buffer: Buffer, text: string, encoding: Encoding): boolean => {
  if (encoding.encoding === 'utf8') return isUtf8(buffer)
  return iconv.encode(text, encoding.encoding, { addBOM: encoding.isBom }).equals(buffer)
}

const CED_ICONV_ENCODINGS: Record<string, string> = {
  'BIG5-CP950': 'big5',
  KSC: 'euckr',
  'ISO-2022-KR': 'euckr',
  GB: 'gb2312',
  ISO_2022_CN: 'gb2312',

  Unicode: 'utf8',

  // ISO-2022-JP is 7-bit, so decoding it as UTF-8 at least keeps the bytes
  // intact on save; iconv-lite has no ISO-2022-JP codec.
  JIS: 'utf8',

  // ced is only consulted once the buffer failed UTF-8 validation, so these
  // must never map back to utf8: decoding would replace the non-UTF-8 bytes
  // with U+FFFD and the next save would lose them. ced reports Latin-1 and
  // Windows-1252 text as ASCII; cp1252 is a superset of both.
  SJS: 'shiftjis',
  shiftjis: 'shiftjis',
  'ASCII-7-bit': 'cp1252',
  ASCII: 'cp1252',
  MACINTOSH: 'macintosh'
}

// Byte Order Marks to detect endianness and encoding.
const BOM_ENCODINGS: Record<string, number[]> = {
  utf8: [0xef, 0xbb, 0xbf],
  utf16be: [0xfe, 0xff],
  utf16le: [0xff, 0xfe]
}

const checkSequence = (buffer: Buffer, sequence: number[]): boolean => {
  if (buffer.length < sequence.length) {
    return false
  }
  return sequence.every((v, i) => v === buffer[i])
}

// `ced` occasionally misdetects a valid UTF-8 file as a legacy double-byte
// encoding (notably GBK), mojibaking multi-byte text — e.g. Greek µ/κ/α become
// CJK 碌/魏/伪 (#3151). A NUL byte signals binary / BOM-less UTF-16, not a UTF-8
// text file.
const isLikelyUtf8 = (buffer: Buffer): boolean => {
  if (buffer.includes(0)) {
    return false
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

/**
 * Guess the encoding from the buffer.
 */
export const guessEncoding = (buffer: Buffer, autoGuessEncoding: boolean): Encoding => {
  const isBom = false
  let encoding = 'utf8'

  // Detect UTF8- and UTF16-BOM encodings.
  for (const [key, value] of Object.entries(BOM_ENCODINGS)) {
    if (checkSequence(buffer, value)) {
      return { encoding: key, isBom: true }
    }
  }

  // Auto guess encoding, otherwise use UTF-8.
  if (autoGuessEncoding) {
    // A file that is already valid UTF-8 must be decoded as UTF-8, regardless
    // of what `ced` heuristically guesses (#3151).
    if (isLikelyUtf8(buffer)) {
      return { encoding: 'utf8', isBom }
    }
    encoding = ced(buffer)
    if (CED_ICONV_ENCODINGS[encoding]) {
      encoding = CED_ICONV_ENCODINGS[encoding]
    } else {
      encoding = encoding.toLowerCase().replace(/[-_]/g, '')
    }
  }
  return { encoding, isBom }
}

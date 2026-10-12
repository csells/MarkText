// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import iconv from 'iconv-lite'
import { afterEach, describe, expect, it } from 'vitest'
import { LossyDecodeError } from 'main_renderer/filesystem/encoding'
import { loadMarkdownFile, writeMarkdownFile } from 'main_renderer/filesystem/markdown'
import type { LineEnding } from '@shared/types/files'

// Opening and saving without an edit is byte-exact (ADR 0007),
// an edited save keeps the file's encoding, BOM and EOL policy, and bytes that
// did not survive decoding are never replaced without consent. These drive the
// production load and save functions against real files.

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fileWith = (bytes: Buffer, name = 'doc.md'): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mt-bytes-'))
  dirs.push(dir)
  const pathname = path.join(dir, name)
  writeFileSync(pathname, bytes)
  return pathname
}

interface LoadOptions {
  preferredEol?: LineEnding
  autoGuessEncoding?: boolean
  autoNormalizeLineEndings?: boolean
}

const load = (pathname: string, opts: LoadOptions = {}) =>
  loadMarkdownFile(
    pathname,
    opts.preferredEol ?? 'lf',
    opts.autoGuessEncoding ?? true,
    2,
    opts.autoNormalizeLineEndings ?? false
  )

type Loaded = Awaited<ReturnType<typeof load>>

// What the renderer sends back: the file state the load produced.
const saveOptions = (doc: Loaded) => ({
  encoding: doc.encoding,
  lineEnding: doc.lineEnding,
  adjustLineEndingOnSave: doc.adjustLineEndingOnSave
})

const bom = (encoding: string): Buffer =>
  ({
    utf8: Buffer.from([0xef, 0xbb, 0xbf]),
    utf16le: Buffer.from([0xff, 0xfe]),
    utf16be: Buffer.from([0xfe, 0xff])
  })[encoding] ?? Buffer.alloc(0)

const withBom = (text: string, encoding: string): Buffer =>
  Buffer.concat([bom(encoding), iconv.encode(text, encoding)])

const CASES: Array<{
  name: string
  bytes: Buffer
  encoding: string
  isBom: boolean
  lineEnding?: LineEnding
  opts?: LoadOptions
}> = [
  {
    name: 'UTF-8',
    bytes: Buffer.from('# Title\n\nCafé ☕ 日本\n'),
    encoding: 'utf8',
    isBom: false
  },
  {
    name: 'UTF-8 with BOM',
    bytes: withBom('# Title\n\nCafé ☕\n', 'utf8'),
    encoding: 'utf8',
    isBom: true
  },
  {
    name: 'UTF-16 LE with BOM and CRLF',
    bytes: withBom('# Title\r\n\r\nhé ☕ 𝄞\r\n', 'utf16le'),
    encoding: 'utf16le',
    isBom: true,
    lineEnding: 'crlf'
  },
  {
    name: 'UTF-16 BE with BOM',
    bytes: withBom('# Title\n\nhé ☕ 𝄞\n', 'utf16be'),
    encoding: 'utf16be',
    isBom: true
  },
  {
    name: 'guessed Shift_JIS',
    bytes: iconv.encode(
      '# 日本語\n\n日本語のテキストです。これはシフトJISのファイルです。\n',
      'shiftjis'
    ),
    encoding: 'shiftjis',
    isBom: false
  },
  {
    name: 'guessed GB2312',
    bytes: iconv.encode('# 中文\n\n中文文本测试，这是一个编码的文件。\n', 'gb2312'),
    encoding: 'gb2312',
    isBom: false
  },
  {
    name: 'guessed Windows-1252',
    bytes: iconv.encode(
      '# Résumé\n\nCafé crème brûlée à la façon de Noël, déjà vu. Ça coûte 5 € — naïve façade.\n',
      'windows1252'
    ),
    encoding: 'cp1252',
    isBom: false
  },
  {
    name: 'guessed ISO-8859-1',
    bytes: iconv.encode(
      '# Résumé\n\nCafé crème brûlée à la façon de Noël, déjà vu. Ça coûte cher, naïve façade.\n',
      'latin1'
    ),
    encoding: 'latin1',
    isBom: false
  },
  {
    name: 'CRLF',
    bytes: Buffer.from('# A\r\n\r\nb\r\n'),
    encoding: 'utf8',
    isBom: false,
    lineEnding: 'crlf'
  },
  {
    name: 'CRLF under a CRLF preference',
    bytes: Buffer.from('# A\r\n\r\nb\r\n'),
    encoding: 'utf8',
    isBom: false,
    lineEnding: 'crlf',
    opts: { preferredEol: 'crlf' }
  },
  { name: 'bare CR', bytes: Buffer.from('# A\r\rb\r'), encoding: 'utf8', isBom: false },
  { name: 'mixed endings', bytes: Buffer.from('# A\r\nb\nc\r\n'), encoding: 'utf8', isBom: false },
  {
    name: 'mixed endings under a CRLF preference',
    bytes: Buffer.from('# A\r\nb\nc\r\n'),
    encoding: 'utf8',
    isBom: false,
    lineEnding: 'crlf',
    opts: { preferredEol: 'crlf' }
  },
  { name: 'a leading LF', bytes: Buffer.from('\n# A\nb\n'), encoding: 'utf8', isBom: false },
  {
    name: 'no final newline',
    bytes: Buffer.from('# A\n\nb'),
    encoding: 'utf8',
    isBom: false
  },
  {
    name: 'invalid UTF-8 bytes',
    bytes: Buffer.from([0x6f, 0x6b, 0x20, 0xc3, 0x28, 0x20, 0xff, 0x0a]),
    encoding: 'utf8',
    isBom: false,
    opts: { autoGuessEncoding: false }
  },
  {
    name: 'a truncated UTF-16 LE code unit',
    bytes: Buffer.concat([withBom('ok\n', 'utf16le'), Buffer.from([0x41])]),
    encoding: 'utf16le',
    isBom: true
  }
]

describe('saving without an edit writes the bytes that were opened', () => {
  it.each(CASES)('$name', async({ bytes, encoding, isBom, lineEnding, opts }) => {
    const pathname = fileWith(bytes)
    const doc = await load(pathname, opts)
    expect(doc.encoding).toEqual({ encoding, isBom })
    if (lineEnding) expect(doc.lineEnding).toBe(lineEnding)

    await writeMarkdownFile(pathname, doc.markdown, saveOptions(doc))

    expect(readFileSync(pathname).equals(bytes)).toBe(true)
  })

  it('keeps writing them after a save of the unchanged text', async() => {
    const bytes = Buffer.from('# A\r\nb\nc\r\n')
    const pathname = fileWith(bytes)
    const doc = await load(pathname)
    await writeMarkdownFile(pathname, doc.markdown, saveOptions(doc))
    await writeMarkdownFile(pathname, doc.markdown, saveOptions(doc))
    expect(readFileSync(pathname).equals(bytes)).toBe(true)
  })

  it('writes the bytes of the last edited save once that text is reloaded', async() => {
    const bytes = Buffer.from('# A\r\nb\nc\r\n')
    const pathname = fileWith(bytes)
    const doc = await load(pathname)
    await writeMarkdownFile(pathname, `${doc.markdown}d\n`, saveOptions(doc))
    const reloaded = await load(pathname)
    await writeMarkdownFile(pathname, reloaded.markdown, saveOptions(reloaded))
    expect(readFileSync(pathname).toString()).toBe('# A\nb\nc\nd\n')
  })
})

describe('the line-ending detector', () => {
  it('counts an LF at offset 0, so a leading LF before CRLF lines is mixed', async() => {
    const doc = await load(fileWith(Buffer.from('\n# A\r\nb\r\n')))
    expect(doc.isMixedLineEndings).toBe(true)
  })

  it('reads a lone leading LF as LF rather than the platform preference', async() => {
    const doc = await load(fileWith(Buffer.from('\n# A')), { preferredEol: 'crlf' })
    expect(doc.lineEnding).toBe('lf')
    expect(doc.adjustLineEndingOnSave).toBe(false)
  })
})

describe('an edited save keeps the file encoding, BOM and line endings', () => {
  it.each([
    { name: 'UTF-8 with BOM', text: '# T\n\nx\n', encoding: 'utf8', eol: '\n' },
    { name: 'UTF-16 LE with BOM', text: '# T\r\n\r\nhé\r\n', encoding: 'utf16le', eol: '\r\n' },
    { name: 'UTF-16 BE with BOM', text: '# T\n\nhé\n', encoding: 'utf16be', eol: '\n' }
  ])('$name', async({ text, encoding, eol }) => {
    const pathname = fileWith(withBom(text, encoding))
    const doc = await load(pathname)
    await writeMarkdownFile(pathname, `${doc.markdown}ü ☕\n`, saveOptions(doc))
    expect(readFileSync(pathname).equals(withBom(`${text}ü ☕${eol}`, encoding))).toBe(true)
  })

  it('Shift_JIS', async() => {
    const text = '# 日本語\n\n日本語のテキストです。これはシフトJISのファイルです。\n'
    const pathname = fileWith(iconv.encode(text, 'shiftjis'))
    const doc = await load(pathname)
    await writeMarkdownFile(pathname, `${doc.markdown}追加\n`, saveOptions(doc))
    expect(readFileSync(pathname).equals(iconv.encode(`${text}追加\n`, 'shiftjis'))).toBe(true)
  })

  it('CRLF', async() => {
    const pathname = fileWith(Buffer.from('# A\r\n\r\nb\r\n'))
    const doc = await load(pathname)
    await writeMarkdownFile(pathname, `${doc.markdown}c\n`, saveOptions(doc))
    expect(readFileSync(pathname).toString()).toBe('# A\r\n\r\nb\r\nc\r\n')
  })

  it('mixed endings take the announced line ending', async() => {
    const pathname = fileWith(Buffer.from('# A\r\nb\nc\r\n'))
    const doc = await load(pathname, { preferredEol: 'crlf' })
    await writeMarkdownFile(pathname, `${doc.markdown}d\n`, saveOptions(doc))
    expect(readFileSync(pathname).toString()).toBe('# A\r\nb\r\nc\r\nd\r\n')
  })

  it('an explicit line-ending change re-encodes unchanged text', async() => {
    const pathname = fileWith(Buffer.from('# A\n\nb\n'))
    const doc = await load(pathname)
    await writeMarkdownFile(pathname, doc.markdown, {
      ...saveOptions(doc),
      lineEnding: 'crlf',
      adjustLineEndingOnSave: true
    })
    expect(readFileSync(pathname).toString()).toBe('# A\r\n\r\nb\r\n')
  })

  it('opting into normalized line endings on open saves them normalized', async() => {
    const pathname = fileWith(Buffer.from('# A\r\n\r\nb\r\n'))
    const doc = await load(pathname, { autoNormalizeLineEndings: true })
    await writeMarkdownFile(pathname, doc.markdown, saveOptions(doc))
    expect(readFileSync(pathname).toString()).toBe('# A\n\nb\n')
  })
})

describe('the disk is re-checked before writing opened bytes back', () => {
  it('a file changed on disk since the load gets the saved text, not its old bytes', async() => {
    const pathname = fileWith(Buffer.from('# A\r\nb\nc\r\n'))
    const doc = await load(pathname)
    writeFileSync(pathname, 'changed elsewhere\n')
    await writeMarkdownFile(pathname, doc.markdown, saveOptions(doc))
    expect(readFileSync(pathname).toString()).toBe('# A\nb\nc\n')
  })

  it('a deleted file is recreated from the saved text', async() => {
    const pathname = fileWith(Buffer.from('# A\r\n\r\nb\r\n'))
    const doc = await load(pathname)
    rmSync(pathname)
    await writeMarkdownFile(pathname, doc.markdown, saveOptions(doc))
    expect(readFileSync(pathname).toString()).toBe('# A\r\n\r\nb\r\n')
  })
})

describe('bytes that did not survive decoding', () => {
  const invalid = Buffer.from([0x6f, 0x6b, 0x20, 0xc3, 0x28, 0x20, 0xff, 0x0a])

  it('are reported by the load', async() => {
    const lossy = await load(fileWith(invalid), { autoGuessEncoding: false })
    expect(lossy.isLossyDecode).toBe(true)
    expect(lossy.markdown).toContain('�')
    const clean = await load(fileWith(Buffer.from('# ok\n')))
    expect(clean.isLossyDecode).toBe(false)
  })

  it('are not replaced by an edited save without consent', async() => {
    const pathname = fileWith(invalid)
    const doc = await load(pathname, { autoGuessEncoding: false })
    await expect(
      writeMarkdownFile(pathname, `${doc.markdown}more\n`, saveOptions(doc))
    ).rejects.toBeInstanceOf(LossyDecodeError)
    expect(readFileSync(pathname).equals(invalid)).toBe(true)
  })

  it('are replaced once the user consents, and later edits need no consent', async() => {
    const pathname = fileWith(invalid)
    const doc = await load(pathname, { autoGuessEncoding: false })
    const edited = `${doc.markdown}more\n`
    await writeMarkdownFile(pathname, edited, saveOptions(doc), { allowLossyDecode: true })
    expect(readFileSync(pathname).toString()).toBe(edited)
    await writeMarkdownFile(pathname, `${edited}again\n`, saveOptions(doc))
    expect(readFileSync(pathname).toString()).toBe(`${edited}again\n`)
  })

  it('need consent when an unchanged save can no longer find them on disk', async() => {
    const pathname = fileWith(invalid)
    const doc = await load(pathname, { autoGuessEncoding: false })
    writeFileSync(pathname, 'changed elsewhere\n')
    await expect(
      writeMarkdownFile(pathname, doc.markdown, saveOptions(doc))
    ).rejects.toBeInstanceOf(LossyDecodeError)
    expect(readFileSync(pathname).toString()).toBe('changed elsewhere\n')
  })

  it('are decoded as their guessed legacy encoding instead of UTF-8', async() => {
    const doc = await load(fileWith(invalid))
    expect(doc.encoding.encoding).not.toBe('utf8')
    expect(doc.isLossyDecode).toBe(false)
  })
})

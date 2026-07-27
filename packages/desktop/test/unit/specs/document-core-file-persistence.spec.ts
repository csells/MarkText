import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectDocumentFileEncoding,
  getDocumentCoreFileSnapshot,
  loadMarkdownFile
} from 'main_renderer/filesystem/markdown'

const directories: string[] = []

afterEach(async() => {
  await Promise.all(directories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe.sequential('document-core file persistence', () => {
  it('admits BOM mixed EOL and missing-final-EOL bytes without normalization', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-core-file-'))
    directories.push(directory)
    const pathname = join(directory, 'mixed.md')
    const original = Buffer.from([
      0xef, 0xbb, 0xbf,
      0x61, 0x0d, 0x0a,
      0x62, 0x0a,
      0x63, 0x0d
    ])
    await writeFile(pathname, original)

    const loaded = await loadMarkdownFile(pathname)
    expect(loaded.markdown).toBe('\uFEFFa\r\nb\nc\r')
    const retained = getDocumentCoreFileSnapshot(pathname)
    expect(retained?.source.text).toBe(loaded.markdown)
    expect(Array.from(retained?.readOriginalBytes() ?? []))
      .toEqual(Array.from(original))
  })

  it('admits signed UTF-16 as one exact retained snapshot', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-core-file-'))
    directories.push(directory)
    const pathname = join(directory, 'utf16.md')
    const original = Buffer.from([
      0xff, 0xfe,
      0x61, 0x00,
      0x0d, 0x00
    ])
    await writeFile(pathname, original)

    const loaded = await loadMarkdownFile(pathname)
    expect(loaded.markdown).toBe('\uFEFFa\r')
    expect(getDocumentCoreFileSnapshot(pathname)?.encoding).toBe('utf-16le')
  })

  it('identifies the frozen BOM-less UTF-16LE code-unit fixture', () => {
    const bytes = Buffer.from([
      0x3d, 0xd8,
      0x00, 0xde,
      0x61, 0x00,
      0x00, 0xd8
    ])

    expect(detectDocumentFileEncoding(bytes)).toBe('utf-16le')
  })

  it('identifies ordinary BOM-less UTF-16 text before NUL-bearing UTF-8', () => {
    const littleEndian = Buffer.from('hello\n', 'utf16le')
    const bigEndian = Buffer.from([
      0x00, 0x68,
      0x00, 0x65,
      0x00, 0x6c,
      0x00, 0x6c,
      0x00, 0x6f,
      0x00, 0x0a
    ])

    expect(detectDocumentFileEncoding(littleEndian)).toBe('utf-16le')
    expect(detectDocumentFileEncoding(bigEndian)).toBe('utf-16be')
  })

  it('rejects a non-UTF byte stream instead of normalizing it', () => {
    expect(() => detectDocumentFileEncoding(
      Buffer.from([0x68, 0x69, 0xc2, 0x20, 0x6f, 0x6b])
    )).toThrow(/ambiguous|not valid/i)
  })
})

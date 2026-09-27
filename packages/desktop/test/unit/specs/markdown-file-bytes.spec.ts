// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMarkdownFile } from 'main_renderer/filesystem/markdown'
import type { LineEnding } from '@shared/types/files'

// Plan 0012 G41: these drive the production load function against real files.

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

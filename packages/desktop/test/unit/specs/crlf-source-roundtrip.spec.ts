import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeMarkdownFile } from 'main_renderer/filesystem/markdown'

// A CRLF file edited in source mode holds LF internally (CodeMirror normalizes
// line endings), so byte preservation depends on the save layer restoring CRLF
// via adjustLineEndingOnSave. These pin that the round-trip does not lose the
// document's line-ending style.
describe('writeMarkdownFile — line-ending preservation across a source edit', () => {
  const dirs: string[] = []
  const tempDir = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mt-crlf-'))
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('restores CRLF for an LF-normalized source-mode edit', async() => {
    const target = path.join(tempDir(), 'note.md')

    await writeMarkdownFile(target, 'line 1\nline 2\n', {
      encoding: { encoding: 'utf8', isBom: false },
      lineEnding: 'crlf',
      adjustLineEndingOnSave: true
    } as unknown as Parameters<typeof writeMarkdownFile>[2])

    const bytes = readFileSync(target, 'utf8')
    expect(bytes).toBe('line 1\r\nline 2\r\n')
    expect(/(?<!\r)\n/.test(bytes)).toBe(false)
  })

  it('keeps LF for an LF document', async() => {
    const target = path.join(tempDir(), 'note.md')

    await writeMarkdownFile(target, 'a\nb\n', {
      encoding: { encoding: 'utf8', isBom: false },
      lineEnding: 'lf',
      adjustLineEndingOnSave: false
    } as unknown as Parameters<typeof writeMarkdownFile>[2])

    expect(readFileSync(target, 'utf8')).toBe('a\nb\n')
  })
})

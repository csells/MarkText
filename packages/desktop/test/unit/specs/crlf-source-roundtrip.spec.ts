import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMarkdownFile, writeMarkdownFile } from 'main_renderer/filesystem/markdown'
import { analyzeMarkdownComments, updateCommentMetadataInMarkdown } from '@muyajs/core'

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

  it('preserves UTF-16LE BOM and portable comment syntax across a metadata edit', async() => {
    const target = path.join(tempDir(), 'commented.md')
    // A legacy v1 line: read-compat is part of what this pins.
    const metadata = `data:application/json;base64,${Buffer.from(
      JSON.stringify({ version: 1, status: 'open', replies: [] })
    ).toString('base64')}`
    const markdown = [
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\n')
    const originalBytes = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(markdown, 'utf16le')
    ])
    await writeMarkdownFile(target, markdown, {
      encoding: { encoding: 'utf16le', isBom: true },
      lineEnding: 'lf',
      adjustLineEndingOnSave: false
    } as unknown as Parameters<typeof writeMarkdownFile>[2])
    expect(readFileSync(target)).toEqual(originalBytes)

    const loaded = await loadMarkdownFile(target, 'lf', true)
    const updated = updateCommentMetadataInMarkdown(loaded.markdown, 'a', thread => ({
      ...thread,
      status: 'resolved',
      updatedAt: '2026-06-30T15:00:00.000Z'
    }))
    expect(updated).toBeTruthy()
    if (!updated) {
      throw new Error('Expected comment metadata to be updated.')
    }

    await writeMarkdownFile(target, updated, {
      encoding: loaded.encoding,
      lineEnding: loaded.lineEnding,
      adjustLineEndingOnSave: loaded.adjustLineEndingOnSave
    })

    const bytes = readFileSync(target)
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe])

    const decoded = bytes.subarray(2).toString('utf16le')
    expect(decoded).toContain('A <!--MC:a-->reviewed<!--MC:~a--> line.')
    expect(analyzeMarkdownComments(decoded).comments.threads[0]).toMatchObject({
      id: 'a',
      status: 'resolved',
      updatedAt: '2026-06-30T15:00:00.000Z'
    })
  })
})

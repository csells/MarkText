import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeCommentMetadata } from '../src/metadata'
import { readMarkdownComments } from '../src/parse'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '../../..')
const cliPath = 'skills/markdown-comments/src/cli.ts'
const tsxPath = path.join(repoRoot, 'node_modules/.bin/tsx')
const tempDirs: string[] = []

function writeMarkdown(markdown: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-comments-cli-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'doc.md')
  fs.writeFileSync(file, markdown, 'utf8')
  return file
}

function writeMarkdownBuffer(buffer: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-comments-cli-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'doc.md')
  fs.writeFileSync(file, buffer)
  return file
}

function runCli(...args: string[]): string {
  return execFileSync(tsxPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('markdown-comments CLI', () => {
  it('lists deterministic JSON and validate exits non-zero for malformed files', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      replies: []
    })
    const file = writeMarkdown([
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\n'))

    expect(JSON.parse(runCli('list', file))).toMatchObject({
      threads: [{ id: 'a', status: 'open' }],
      ranges: [{ id: 'a' }],
      diagnostics: []
    })

    fs.writeFileSync(file, 'A <!--MC:a-->dangling.\n', 'utf8')
    const result = spawnSync(tsxPath, [cliPath, 'validate', file], {
      cwd: repoRoot,
      encoding: 'utf8'
    })

    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual([
      expect.objectContaining({
        code: 'unclosed-open-marker',
        id: 'a'
      })
    ])
  })

  it('reports invalid duplicate metadata during validation', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      replies: []
    })
    const file = writeMarkdown([
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      '[MC:a]: data:application/json;base64,not-base64-json',
      ''
    ].join('\n'))

    const result = spawnSync(tsxPath, [cliPath, 'validate', file], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
    const diagnostics = JSON.parse(result.stdout) as Array<{ code: string }>

    expect(result.status).toBe(1)
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'duplicate-metadata',
      'invalid-metadata'
    ])
  })

  it('reports empty metadata data URIs during validation', () => {
    const file = writeMarkdown([
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      '[MC:a]: data:application/json;base64,',
      ''
    ].join('\n'))

    const result = spawnSync(tsxPath, [cliPath, 'validate', file], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
    const diagnostics = JSON.parse(result.stdout) as Array<{ code: string }>

    expect(result.status).toBe(1)
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'invalid-metadata',
      'missing-metadata'
    ])
  })

  it('preserves optional display metadata when resolving through the CLI', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      display: {
        color: 'amber',
        label: 'Design review'
      },
      replies: []
    })
    const file = writeMarkdown([
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\n'))

    runCli('resolve', file, 'a', '--updated-at', '2026-06-30T15:00:00.000Z')

    expect(readMarkdownComments(fs.readFileSync(file, 'utf8')).threads[0]).toMatchObject({
      id: 'a',
      status: 'resolved',
      display: {
        color: 'amber',
        label: 'Design review'
      }
    })
  })

  it('appends a reply through the CLI without moving markers', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      authors: ['Ada'],
      replies: []
    })
    const file = writeMarkdown([
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\n'))

    runCli(
      'reply',
      file,
      'a',
      '--author',
      'Grace',
      '--body',
      'Looks good.',
      '--created-at',
      '2026-06-30T14:00:00.000Z'
    )

    const updated = fs.readFileSync(file, 'utf8')
    expect(updated).toContain('A <!--MC:a-->reviewed<!--MC:~a--> line.')
    expect(readMarkdownComments(updated).threads[0]).toMatchObject({
      authors: ['Ada', 'Grace'],
      updatedAt: '2026-06-30T14:00:00.000Z',
      replies: [
        {
          author: 'Grace',
          body: 'Looks good.',
          createdAt: '2026-06-30T14:00:00.000Z'
        }
      ]
    })
  })

  it('reopens a resolved comment through the CLI', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'resolved',
      replies: []
    })
    const file = writeMarkdown([
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\n'))

    runCli('reopen', file, 'a', '--updated-at', '2026-06-30T16:00:00.000Z')

    expect(readMarkdownComments(fs.readFileSync(file, 'utf8')).threads[0]).toMatchObject({
      id: 'a',
      status: 'open',
      updatedAt: '2026-06-30T16:00:00.000Z'
    })
  })

  it('patches thread metadata through CLI edit without replacing markers', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      authors: ['Ada'],
      replies: []
    })
    const file = writeMarkdown([
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\n'))

    runCli(
      'edit',
      file,
      'a',
      '--status',
      'resolved',
      '--authors',
      'Ada,Grace',
      '--updated-at',
      '2026-06-30T17:00:00.000Z'
    )

    const updated = fs.readFileSync(file, 'utf8')
    expect(updated).toContain('A <!--MC:a-->reviewed<!--MC:~a--> line.')
    expect(readMarkdownComments(updated).threads[0]).toMatchObject({
      status: 'resolved',
      authors: ['Ada', 'Grace'],
      updatedAt: '2026-06-30T17:00:00.000Z'
    })
  })

  it('preserves UTF-8 BOM and CRLF line endings when writing metadata edits', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      replies: []
    })
    const markdown = [
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\r\n')
    const file = writeMarkdownBuffer(Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(markdown, 'utf8')
    ]))

    runCli('resolve', file, 'a', '--updated-at', '2026-06-30T15:00:00.000Z')

    const bytes = fs.readFileSync(file)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const updated = bytes.subarray(3).toString('utf8')
    expect(updated).toContain('\r\n')
    expect(updated).not.toContain('\n\n')
    expect(readMarkdownComments(updated).threads[0]).toMatchObject({
      id: 'a',
      status: 'resolved'
    })
  })

  it('preserves unrelated bytes, mixed line endings, trailing metadata whitespace, and missing final newline', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      replies: []
    })
    const prefix = 'Title\rA <!--MC:a-->reviewed<!--MC:~a--> line.\n\n'
    const file = writeMarkdownBuffer(Buffer.from(`${prefix}[MC:a]: ${metadata}  `, 'utf8'))

    runCli('resolve', file, 'a', '--updated-at', '2026-06-30T15:00:00.000Z')

    const updated = fs.readFileSync(file, 'utf8')
    expect(updated.startsWith(prefix)).toBe(true)
    expect(updated.endsWith('  ')).toBe(true)
    expect(updated.endsWith('\n')).toBe(false)
    expect(readMarkdownComments(updated).threads[0]).toMatchObject({
      id: 'a',
      status: 'resolved'
    })
  })

  it('edits an existing reply through the CLI', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      authors: ['Ada', 'Grace'],
      replies: [
        {
          author: 'Ada',
          createdAt: '2026-06-30T12:00:00.000Z',
          body: 'First note.'
        },
        {
          author: 'Grace',
          createdAt: '2026-06-30T12:05:00.000Z',
          body: 'Second note.'
        }
      ]
    })
    const file = writeMarkdown([
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\n'))

    runCli(
      'edit',
      file,
      'a',
      '--reply-index',
      '1',
      '--body',
      'Updated second note.',
      '--updated-at',
      '2026-06-30T15:00:00.000Z'
    )

    expect(readMarkdownComments(fs.readFileSync(file, 'utf8')).threads[0]).toMatchObject({
      updatedAt: '2026-06-30T15:00:00.000Z',
      replies: [
        { author: 'Ada', body: 'First note.' },
        { author: 'Grace', body: 'Updated second note.' }
      ]
    })
  })

  it('does not resolve metadata-looking definitions inside fenced code', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      replies: []
    })
    const markdown = [
      '```md',
      `[MC:a]: ${metadata}`,
      '```',
      '',
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      ''
    ].join('\n')
    const file = writeMarkdown(markdown)

    const result = spawnSync(tsxPath, [cliPath, 'resolve', file, 'a'], {
      cwd: repoRoot,
      encoding: 'utf8'
    })

    expect(result.status).toBe(1)
    expect(fs.readFileSync(file, 'utf8')).toBe(markdown)
    expect(readMarkdownComments(markdown).diagnostics).toEqual([
      expect.objectContaining({
        code: 'missing-metadata',
        id: 'a'
      })
    ])
  })

  it('preserves reply display fields when editing another reply', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      authors: ['Ada', 'Grace'],
      replies: [
        {
          author: 'Ada',
          createdAt: '2026-06-30T12:00:00.000Z',
          body: 'First note.',
          display: {
            color: 'amber'
          }
        },
        {
          author: 'Grace',
          createdAt: '2026-06-30T12:05:00.000Z',
          body: 'Second note.'
        }
      ]
    })
    const file = writeMarkdown([
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\n'))

    runCli(
      'edit',
      file,
      'a',
      '--reply-index',
      '1',
      '--body',
      'Updated second note.',
      '--updated-at',
      '2026-06-30T15:00:00.000Z'
    )

    expect(readMarkdownComments(fs.readFileSync(file, 'utf8')).threads[0].replies).toEqual([
      expect.objectContaining({
        author: 'Ada',
        body: 'First note.',
        display: {
          color: 'amber'
        }
      }),
      expect.objectContaining({
        author: 'Grace',
        body: 'Updated second note.'
      })
    ])
  })

  it('rejects unsupported non-UTF-8 files without writing them', () => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      replies: []
    })
    const utf16Markdown = [
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\n')
    const file = writeMarkdownBuffer(Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(utf16Markdown, 'utf16le')
    ]))
    const before = fs.readFileSync(file)

    const listResult = spawnSync(tsxPath, [cliPath, 'list', file], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
    const resolveResult = spawnSync(tsxPath, [cliPath, 'resolve', file, 'a'], {
      cwd: repoRoot,
      encoding: 'utf8'
    })

    expect(listResult.status).toBe(1)
    expect(listResult.stderr).toContain('Unsupported file encoding')
    expect(resolveResult.status).toBe(1)
    expect(resolveResult.stderr).toContain('Unsupported file encoding')
    expect(fs.readFileSync(file)).toEqual(before)
  })

  it('documents deterministic reply edits in the shipped skill', () => {
    const skill = fs.readFileSync(path.join(repoRoot, 'skills/markdown-comments/SKILL.md'), 'utf8')

    expect(skill).toContain('--reply-index')
  })
})

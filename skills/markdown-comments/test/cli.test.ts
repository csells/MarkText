import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import iconv from 'iconv-lite'
import { encodeCommentMetadata } from '@muyajs/core/comments'
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

  it.each([
    ['UTF-16LE', [0xff, 0xfe], (markdown: string) => Buffer.from(markdown, 'utf16le'), 'utf16le'],
    ['UTF-16BE', [0xfe, 0xff], (markdown: string) => iconv.encode(markdown, 'utf16be'), 'utf16be']
  ])('lists and updates %s BOM files without rewriting them as UTF-8', (_name, bom, encode, encoding) => {
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
      Buffer.from(bom),
      encode(utf16Markdown)
    ]))

    const listResult = spawnSync(tsxPath, [cliPath, 'list', file], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
    const resolveResult = spawnSync(tsxPath, [cliPath, 'resolve', file, 'a'], {
      cwd: repoRoot,
      encoding: 'utf8'
    })

    expect(listResult.status).toBe(0)
    expect(JSON.parse(listResult.stdout)).toMatchObject({
      threads: [{ id: 'a', status: 'open' }],
      diagnostics: []
    })
    expect(resolveResult.status).toBe(0)

    const bytes = fs.readFileSync(file)
    expect([...bytes.subarray(0, 2)]).toEqual(bom)
    const updated = iconv.decode(bytes.subarray(2), encoding)
    expect(updated).toContain('A <!--MC:a-->reviewed<!--MC:~a--> line.')
    expect(readMarkdownComments(updated).threads[0]).toMatchObject({
      id: 'a',
      status: 'resolved'
    })
  })

  it.each([
    ['CP1252', 'cp1252', 'Café <!--MC:a-->résumé<!--MC:~a--> line.'],
    ['Shift_JIS', 'shiftjis', 'メモ <!--MC:a-->レビュー<!--MC:~a--> line.']
  ])('lists and updates %s files with an explicit encoding override', (_name, encoding, firstLine) => {
    const metadata = encodeCommentMetadata({
      version: 1,
      status: 'open',
      replies: []
    })
    const markdown = [
      firstLine,
      '',
      `[MC:a]: ${metadata}`,
      ''
    ].join('\n')
    const file = writeMarkdownBuffer(iconv.encode(markdown, encoding))

    const listResult = spawnSync(tsxPath, [cliPath, 'list', file, '--encoding', encoding], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
    const resolveResult = spawnSync(
      tsxPath,
      [cliPath, 'resolve', file, 'a', '--encoding', encoding, '--updated-at', '2026-06-30T15:00:00.000Z'],
      {
        cwd: repoRoot,
        encoding: 'utf8'
      }
    )

    expect(listResult.status).toBe(0)
    expect(JSON.parse(listResult.stdout)).toMatchObject({
      threads: [{ id: 'a', status: 'open' }],
      diagnostics: []
    })
    expect(resolveResult.status).toBe(0)

    const bytes = fs.readFileSync(file)
    const firstLineBytes = iconv.encode(firstLine, encoding)
    expect(bytes.subarray(0, firstLineBytes.length)).toEqual(firstLineBytes)

    const updated = iconv.decode(bytes, encoding)
    expect(readMarkdownComments(updated).threads[0]).toMatchObject({
      id: 'a',
      status: 'resolved',
      updatedAt: '2026-06-30T15:00:00.000Z'
    })
  })

  it('documents deterministic reply edits in the shipped skill', () => {
    const skill = fs.readFileSync(path.join(repoRoot, 'skills/markdown-comments/SKILL.md'), 'utf8')

    expect(skill).toContain('--reply-index')
    expect(skill).toContain('--encoding')
    expect(skill).toContain('BOM-marked UTF-16')
    expect(skill).not.toContain('UTF-8 Markdown files only')
  })
})

describe('markdown-comments CLI — argument honesty', () => {
  const openMeta = () =>
    encodeCommentMetadata({ version: 1, status: 'open', authors: ['Ada'], replies: [] })

  const docWithComment = () =>
    writeMarkdown(`Text <!--MC:a-->reviewed<!--MC:~a--> end\n\n[MC:a]: ${openMeta()}\n`)

  function runCliFailure(...args: string[]): { status: number | null; stderr: string } {
    const result = spawnSync(tsxPath, [cliPath, ...args], { cwd: repoRoot, encoding: 'utf8' })
    return { status: result.status, stderr: result.stderr }
  }

  it('accepts option values that begin with dashes', () => {
    const file = docWithComment()

    runCli('reply', file, 'a', '--author', 'Grace', '--body', '--fixed the flag parsing')

    const parsed = readMarkdownComments(fs.readFileSync(file, 'utf8'))
    expect(parsed.threads[0].replies.at(-1)?.body).toBe('--fixed the flag parsing')
  })

  it('rejects an option that is missing its value', () => {
    const file = docWithComment()
    const { status, stderr } = runCliFailure('reply', file, 'a', '--author', 'Grace', '--body')

    expect(status).toBe(1)
    expect(stderr).toContain('--body')
    // The document is untouched.
    expect(readMarkdownComments(fs.readFileSync(file, 'utf8')).threads[0].replies).toHaveLength(0)
  })

  it('rejects unknown options instead of silently ignoring them', () => {
    const file = docWithComment()
    const { status, stderr } = runCliFailure('resolve', file, 'a', '--bogus', 'x')

    expect(status).toBe(1)
    expect(stderr).toContain('--bogus')
  })

  it('rejects thread options combined with a reply edit instead of dropping them', () => {
    const file = docWithComment()
    runCli('reply', file, 'a', '--author', 'Grace', '--body', 'first')

    const { status, stderr } = runCliFailure(
      'edit', file, 'a', '--reply-index', '0', '--body', 'x', '--status', 'resolved'
    )

    expect(status).toBe(1)
    expect(stderr).toContain('--status')
  })

  it('reports corrupt metadata as corruption, not as a missing definition', () => {
    const file = writeMarkdown(
      'Text <!--MC:a-->reviewed<!--MC:~a--> end\n\n[MC:a]: data:application/json;base64,%%%not-base64%%%\n'
    )
    const { status, stderr } = runCliFailure('resolve', file, 'a')

    expect(status).toBe(1)
    expect(stderr.toLowerCase()).toMatch(/corrupt|invalid|decode/)
    expect(stderr).not.toContain('No metadata definition found')
  })
})

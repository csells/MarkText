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
})

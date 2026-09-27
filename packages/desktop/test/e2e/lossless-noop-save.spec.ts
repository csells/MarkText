import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { launchWithDoc, sendIpcToRenderer } from './helpers'

// Plan 0012 G41 / ADR 0007: opening a file and saving it without an edit
// writes the file's own bytes back, through the real editor and save path
// (Cmd+S's `mt::editor-ask-file-save` → store → main writeMarkdownFile).

const utf16le = (text: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])

const CASES: ReadonlyArray<readonly [string, Buffer]> = [
  ['UTF-8 with BOM and CRLF', Buffer.from('﻿# Title\r\n\r\nBody *text*.\r\n', 'utf8')],
  ['mixed line endings', Buffer.from('# Title\r\n\r\none\ntwo\r\nthree\n', 'utf8')],
  ['a leading LF', Buffer.from('\n# Title\n\nBody.\n', 'utf8')],
  ['UTF-16 LE with BOM and CRLF', utf16le('# Title\r\n\r\nCafé → ok.\r\n')],
  [
    'CriticMarkup under CRLF without a final newline',
    Buffer.from('Keep {++added++} {~~old~>new~~}\r\n\r\n{==a==}{>>n<<}', 'utf8')
  ]
]

test.describe('a save without edits writes the original bytes (G41)', () => {
  test.describe.configure({ timeout: 60_000 })

  for (const [label, bytes] of CASES) {
    test(label, async() => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-noop-save-'))
      const filePath = path.join(dir, 'note.md')
      fs.writeFileSync(filePath, bytes)
      // An old mtime, so the save shows up even though the bytes do not change.
      const past = new Date('2001-01-01T00:00:00Z')
      fs.utimesSync(filePath, past, past)
      const { app } = await launchWithDoc(filePath)
      try {
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect
          .poll(() => fs.statSync(filePath).mtimeMs, { timeout: 15_000 })
          .toBeGreaterThan(past.getTime() + 1000)
        expect(fs.readFileSync(filePath).equals(bytes)).toBe(true)
      } finally {
        await app.close()
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})

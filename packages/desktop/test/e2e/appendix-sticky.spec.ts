import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  getMarkdownContent,
  launchWithMarkdown,
  placeCaretInEditor,
  sendIpcToRenderer,
  waitForMenuReady
} from './helpers'

// The trailing metadata appendix is plumbing, not content: an agent
// appending prose to the END of the file (below the [MC:] definitions) must
// see its prose land ABOVE the appendix once the editor picks up the change
// — and saving writes the canonical layout back with the appendix at EOF.

const isDirty = (page: Page): Promise<boolean> =>
  page.evaluate(() => !!document.querySelector('.editor-tabs li.unsaved'))

test('agent-appended prose lands above the appendix; save restores it to EOF', async() => {
  const before = [
    'Hello <!--MC:a-->reviewed<!--MC:~a--> world.',
    '',
    '[MC:a]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z"}',
    ''
  ].join('\n')
  const floated = [
    'Hello <!--MC:a-->reviewed<!--MC:~a--> world.',
    '',
    'agent appended prose',
    '',
    '[MC:a]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z"}',
    ''
  ].join('\n')
  const { app, page, filePath } = await launchWithMarkdown(before)
  await waitForMenuReady(app)

  // The agent appends BELOW the metadata appendix (a plain file write).
  fs.appendFileSync(filePath, '\nagent appended prose\n', 'utf-8')

  // The editor picks up the change and the appendix re-sticks to EOF.
  await expect.poll(() => getMarkdownContent(page), { timeout: 12000 }).toBe(floated)
  // The buffer's layout now differs from disk — the tab must say so.
  await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

  // Saving writes the canonical layout: appendix back at EOF.
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)
  expect(fs.readFileSync(filePath, 'utf-8')).toBe(floated)

  await app.close()
})

// The dirty-tab variant rides the MERGE pipeline. The agent's remote
// subsumes the local buffer byte-for-byte and appends below the appendix,
// so the merge output equals the remote (the reducer's markClean case) —
// but the float makes the buffer's serialization differ from disk, so the
// tab must still read dirty.
test('a markClean merge whose appendix floats leaves the tab dirty', async() => {
  const before = [
    'Hello <!--MC:a-->reviewed<!--MC:~a--> world.',
    '',
    '[MC:a]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z"}',
    ''
  ].join('\n')
  const { app, page, filePath } = await launchWithMarkdown(before)
  await waitForMenuReady(app)

  // Dirty the buffer with a trailing keystroke the remote will contain
  // (placeCaretInEditor commits a collapsed caret at the paragraph's end).
  await placeCaretInEditor(page)
  await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)
  await page.keyboard.type('!')
  await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
  const local = await getMarkdownContent(page)
  // Where the keystroke landed is irrelevant — the remote is built FROM the
  // live buffer so the merge output equals it byte-for-byte.
  expect(local).toContain('!')

  // The agent writes the local content PLUS appended prose below the
  // appendix — the merge output equals this remote byte-for-byte.
  const remote = `${local}\nagent appended prose\n`
  fs.writeFileSync(filePath, remote, 'utf-8')

  await expect
    .poll(() => getMarkdownContent(page), { timeout: 12000 })
    .toContain('agent appended prose')
  const buffer = await getMarkdownContent(page)
  // The appendix floated past the appended prose…
  expect(buffer.trimEnd().endsWith('"createdAt":"2026-07-07T09:00:00.000Z"}')).toBe(true)
  // …so the buffer differs from disk and the tab stays dirty.
  expect(buffer).not.toBe(remote)
  await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

  await app.close()
})

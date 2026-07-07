import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  focusEditor,
  getMarkdownContent,
  launchElectron,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady
} from './helpers'

// external-merge.md §Background tabs and undo: auto-merging a BACKGROUND tab
// replaces content the engine never saw, so the tab keeps a pre-merge
// journal; activating the tab seeds a rebuild-undo boundary from it, and the
// first Cmd+Z after switching back restores the pre-merge buffer. Stale
// engine history is never replayed onto the merged tree.

const isDirty = (page: Parameters<typeof focusEditor>[0]): Promise<boolean> =>
  page.evaluate(() => !!document.querySelector('.tabs-container > li.unsaved'))

const undo = async(app: Parameters<typeof sendIpcToRenderer>[0]): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
}

const reportExternalChange = async(
  app: Parameters<typeof sendIpcToRenderer>[0],
  pathname: string,
  markdown: string,
  filename: string
): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::update-file', {
    type: 'change',
    change: {
      pathname,
      mtimeMs: 1,
      data: {
        markdown,
        filename,
        isUtf8BomEncoded: false,
        lineEnding: 'lf',
        adjustLineEndingOnSave: false,
        isMixedLineEndings: false,
        encoding: { encoding: 'utf8', isBom: false }
      }
    }
  })
}

test('background auto-merge journals the pre-merge buffer; activation seeds its undo boundary', async() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-bg-journal-'))
  const fileA = path.join(dir, 'alpha.md')
  const fileB = path.join(dir, 'beta.md')
  const BASE_B = 'beta start\n\nbeta middle\n\nbeta end\n'
  fs.writeFileSync(fileA, 'alpha content\n', 'utf-8')
  fs.writeFileSync(fileB, BASE_B, 'utf-8')

  const { app, page } = await launchElectron([fileA, fileB])
  try {
    await waitForEditor(page)
    await waitForMenuReady(app)

    // Activate beta and dirty it with a local edit in the FIRST paragraph.
    await page.locator('.tabs-container > li', { hasText: 'beta.md' }).click()
    await expect.poll(() => getMarkdownContent(page), { timeout: 5000 }).toContain('beta start')
    await focusEditor(page)
    await page.locator('.mu-paragraph', { hasText: 'beta start' }).first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' (edited)', { delay: 0 })
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    // Switch back to alpha so beta is a BACKGROUND tab, then land a disjoint
    // agent edit in beta's LAST paragraph on disk.
    await page.locator('.tabs-container > li', { hasText: 'alpha.md' }).click()
    await expect.poll(() => getMarkdownContent(page), { timeout: 5000 }).toContain('alpha content')
    const AGENT_B = 'beta start\n\nbeta middle\n\nbeta end (agent)\n'
    fs.writeFileSync(fileB, AGENT_B, 'utf-8')
    await reportExternalChange(app, fileB, AGENT_B, 'beta.md')

    // Activate beta: the auto-merged buffer holds BOTH edits…
    await page.locator('.tabs-container > li', { hasText: 'beta.md' }).click()
    await expect.poll(() => getMarkdownContent(page), { timeout: 8000 }).toContain('beta start (edited)')
    expect(await getMarkdownContent(page)).toContain('beta end (agent)')

    // …and the FIRST undo restores the pre-merge buffer from the journal.
    await undo(app)
    await expect.poll(() => getMarkdownContent(page), { timeout: 8000 }).not.toContain('beta end (agent)')
    expect(await getMarkdownContent(page)).toContain('beta start (edited)')
    expect(await getMarkdownContent(page)).toContain('beta end')
  } finally {
    await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

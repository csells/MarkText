import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'fs'
import {
  closeElectron,
  launchWithMarkdown,
  typeIntoEditor,
  waitForMenuReady
} from './helpers'

// #1861 — rewriting the open file on disk with byte-identical content (e.g. a
// git checkout that left it unchanged) fires a watcher 'change', but must NOT
// mark the tab unsaved or show the "file changed on disk" banner.
//
// The document-core contract for a genuine change depends on whether the tab
// holds local work: a CLEAN tab reloads silently to the new bytes (nothing to
// lose, and dirtiness is content-addressed, so the reloaded head is clean),
// while a DIRTY tab keeps its edit and raises the conflict banner. Both halves
// are asserted; the silent-reload half also catches the reload never reaching
// the renderer at all.
//
// This drives the REAL watcher: it writes the actual file and lets the
// main-process chokidar watcher -> loadMarkdownFile -> renderer handler run,
// rather than hand-crafting the IPC payload (which would tautologically match).

const isDirty = (page: Page) =>
  page.evaluate(() => !!document.querySelector('.editor-tabs li.unsaved'))

// macOS uses polling + awaitWriteFinish (stabilityThreshold 1000ms), so a disk
// write surfaces ~1–2s later.
const WATCH_SETTLE = 2500

test.describe('Issue #1861 — content-identical file change', () => {
  test('an identical on-disk rewrite stays clean; a real change warns', async() => {
    const { app, page, filePath } = await launchWithMarkdown('hello\nworld\n')
    await waitForMenuReady(app)
    await page.waitForTimeout(500)
    expect(await isDirty(page)).toBe(false)

    // Identical bytes — the watcher fires, but the tab must stay clean.
    fs.writeFileSync(filePath, 'hello\nworld\n', 'utf-8')
    await page.waitForTimeout(WATCH_SETTLE)
    expect(await isDirty(page)).toBe(false)

    // A genuine change on a CLEAN tab reloads silently to the new bytes.
    fs.writeFileSync(filePath, 'hello\nworld\nchanged\n', 'utf-8')
    // The file already holds the new bytes by construction; the claim is
    // that the SESSION reloaded onto them, observed through the mounted
    // view of this marker-free document.
    await expect(page.locator('.editor-component'))
      .toContainText('changed', { timeout: 8000 })
    expect(await isDirty(page)).toBe(false)
    expect(await page.locator('.editor-notifications').count()).toBe(0)

    // With local work in the tab, the same kind of change must warn instead of
    // silently discarding the edit.
    await typeIntoEditor(page, ' local')
    await expect.poll(() => isDirty(page), { timeout: 8000 }).toBe(true)
    fs.writeFileSync(filePath, 'hello\nworld\nconflict\n', 'utf-8')
    await expect(page.locator('.editor-notifications'))
      .toContainText('has been changed on disk', { timeout: 8000 })
    expect(await isDirty(page)).toBe(true)

    await closeElectron(app)
  })
})

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  launchWithMarkdown,
  getMarkdownContent,
  typeIntoEditor,
  placeCaretInEditor,
  enterSourceMode,
  exitSourceMode
} from './helpers'

/**
 * The engine seam, exercised in the real application.
 *
 * Every document flow — the canonical-Markdown reads, document load,
 * replace-with-selection, and the change subscription — now goes through
 * `documentEngineHost` rather than calling Muya directly. On the legacy engine
 * the host delegates straight back to Muya, so the whole point is that a user
 * cannot tell: reading, editing, saving, dirty-tracking and the source-mode
 * round trip must behave exactly as before.
 *
 * Unit tests prove the host routes correctly with a stub. Only the running app
 * proves the routing did not break the editor it was threaded through, which is
 * what has to hold before the flag is ever flipped.
 */

test.describe('document engine seam', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Seam\n\nOriginal paragraph.\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('reports which engine owns the document', async() => {
    // The flag is off by default, so a shipped build must still run legacy.
    // Without this mark, a flag that silently failed to plumb through would be
    // indistinguishable from a flag that is off.
    const engine = await page.evaluate(() => {
      const editor = document.querySelector('[data-document-engine]')
      return editor?.getAttribute('data-document-engine') ?? null
    })
    expect(engine).toBe('legacy')
  })

  test('reads canonical Markdown through the seam', async() => {
    // getMarkdownContent goes through the E2E bridge, which now reads via the
    // host rather than calling Muya directly.
    const markdown = await getMarkdownContent(page, app)
    expect(markdown).toContain('# Seam')
    expect(markdown).toContain('Original paragraph.')
  })

  test('an edit still reaches the document', async() => {
    await placeCaretInEditor(page, 'Original paragraph.')
    await typeIntoEditor(page, 'Edited ')
    const markdown = await getMarkdownContent(page, app)
    expect(markdown).toContain('Edited ')
  })

  test('the source-mode round trip still restores the document', async() => {
    // This is the replaceContent-with-selection path — the one flow whose
    // selection type had to travel through the seam rather than be flattened.
    const before = await getMarkdownContent(page, app)
    await enterSourceMode(page, app)
    await exitSourceMode(page, app)
    const after = await getMarkdownContent(page, app)
    expect(after).toBe(before)
  })

})

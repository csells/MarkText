import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { closeElectron, focusEditor, launchWithMarkdown } from './helpers'

// Regression: selecting a word and opening the find bar (Cmd+F) must prefill
// the find input with the selection and run the search. The target view can
// emit a collapsed `selection-change` when the find bar steals editor focus;
// that empty selection must not erase the query or its match list.
test.describe('Find bar prefill from selection', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(
      '# Find test\n\nThe quick brown fox jumps over the lazy dog.\n'
    )
    app = launched.app
    page = launched.page
    await focusEditor(page)
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test('double-click word prefills the find input and counts matches', async() => {
    const point = await page.evaluate(() => {
      const paras = Array.from(document.querySelectorAll('.document-view-paragraph'))
      for (const para of paras) {
        const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          const t = walker.currentNode as Text
          if (t.textContent && t.textContent.includes('fox')) {
            const idx = t.textContent.indexOf('fox')
            const range = document.createRange()
            range.setStart(t, idx)
            range.setEnd(t, idx + 3)
            const rect = range.getBoundingClientRect()
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
          }
        }
      }
      return null
    })
    if (!point) throw new Error('could not locate the word "fox" in the editor')

    await page.mouse.dblclick(point.x, point.y)
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('fox')

    // The DOM selection is set synchronously by the double-click, while the
    // target view publishes the parser-authenticated selection on the next
    // animation frame. A real user opens Find after that handoff; only an
    // instantaneous select→find (as here) can race it.
    //
    // Wait on the *frame*, not wall-clock time. The DOM-selection poll proves
    // the gesture fired, and a double rAF runs after the deferred selection
    // publication even when background frame cadence is irregular.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )

    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+F' : 'Control+F'
    )
    const searchBar = page.locator('.search-bar')
    await expect(searchBar).toBeVisible({ timeout: 5000 })

    const input = page.locator('.search-bar input').first()
    await expect(input).toHaveValue('fox')

    // The selection seeds a real search: the result counter reports the match.
    const result = page.locator('.search-bar .search-result')
    await expect(result).toContainText('1 /')
    await expect(result).not.toContainText('/ 0')
  })
})

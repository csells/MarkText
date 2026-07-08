import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { focusEditor, launchWithMarkdown, readSettled } from './helpers'

// #3329 — moving the caret DOWN auto-scrolls the view (the #628 handler), but
// moving it UP did not, so the caret slid above the viewport. The fix adds the
// symmetric upward scroll.
test.describe('Arrow-up scrolls the document (#3329)', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const md = `${Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1}`).join('\n\n')}\n`
    const launched = await launchWithMarkdown(md)
    app = launched.app
    page = launched.page
    await focusEditor(page)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  const scrollTop = () =>
    page.evaluate(() => (document.querySelector('.editor-component') as HTMLElement)?.scrollTop ?? -1)

  const pressMany = async(key: string, times: number) => {
    // The 6ms pacing provokes distinct keydown events; the scroll they
    // trigger is awaited by the callers' polls, not by a trailing sleep.
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(key)
      await page.waitForTimeout(6)
    }
  }

  test('moving the caret up brings the view back up', async() => {
    // Caret to the bottom — the #628 handler scrolls the view down.
    await pressMany('ArrowDown', 80)
    await expect.poll(scrollTop).toBeGreaterThan(200)
    // The second assertion measures against this baseline, so it must be
    // the SETTLED bottom position, not a mid-scroll sample.
    const bottom = await readSettled(scrollTop, { requiredStreak: 4, interval: 80 })
    expect(bottom).toBeGreaterThan(200)

    // Caret back up — the view must follow it upward.
    await pressMany('ArrowUp', 80)
    await expect.poll(scrollTop).toBeLessThan(bottom - 200)
  })
})

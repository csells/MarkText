import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { closeElectron, launchWithMarkdown, clickMenuById, enterSourceMode } from './helpers'

// #2372 — in source-code mode the dark themes (railscasts) rendered the
// selection at #272935, almost identical to the #2b2b2b editor background, so a
// selection was effectively invisible. The selection should use the same
// visible colour as the WYSIWYG editor (--selection-color). Drives the real
// built app: switch to the "dark" theme, enter source mode, select all, and
// read the rendered selection background.

test.describe('#2372 source-mode selection colour', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Selection\n\nalpha bravo charlie\n\ndelta echo foxtrot\n')
    app = launched.app
    page = launched.page
    await clickMenuById(app, 'dark') // a railscasts dark theme
    await page.waitForFunction(() => document.body.classList.contains('dark'), null, { timeout: 5000 })
    await enterSourceMode(page, app)
    await page.waitForSelector('.source-code-input', {
      state: 'visible',
      timeout: 5000
    })
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test('selection background is the visible editor selection colour, not near-background', async() => {
    await page.evaluate(() => {
      const input = document.querySelector(
        '.source-code-input'
      ) as HTMLTextAreaElement
      input.focus()
      input.select()
    })

    const { selBg, selectionColor } = await page.evaluate(() => {
      const input = document.querySelector(
        '.source-code-input'
      ) as HTMLTextAreaElement
      // Resolve --selection-color (what the WYSIWYG editor uses) to its computed
      // rgb form so we can compare against the rendered selection background.
      const probe = document.createElement('div')
      probe.style.background = 'var(--selection-color)'
      document.body.appendChild(probe)
      const selectionColor = getComputedStyle(probe).backgroundColor
      probe.remove()
      const selBg = getComputedStyle(input, '::selection').backgroundColor
      return { selBg, selectionColor }
    })

    // Source-mode selection now matches the editor's --selection-color
    // (consistent with WYSIWYG mode), and is no longer the near-invisible
    // railscasts colour rgb(39, 41, 53) (#272935).
    expect(selBg).toBe(selectionColor)
    expect(selBg).not.toBe('rgb(39, 41, 53)')
  })
})

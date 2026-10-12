import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import {
  enterSourceMode,
  exitSourceMode,
  expectNoRendererErrors,
  launchWithReviewMarkdown,
  sendIpcToRenderer
} from './helpers'
import { expectSaved, hiddenCoreEnv as env, textPoint } from './reviewGestures'

// Track Changes is the document's authoring mode, as suggesting mode is in
// Google Docs: it stays on until the user turns it off. Source mode edits raw
// text, so a trip through it must not turn tracking off for the WYSIWYG view
// the user returns to: the sidebar toggle, the title-bar indicator, the
// Review menu and the next edit all still say tracked.

const SOURCE = 'Alpha beta gamma.\n'

const reviewMenuChecked = (app: ElectronApplication): Promise<boolean | undefined> =>
  app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('critic-track-changes')?.checked)

const typeAtEndOf = async(page: Page, text: string, typed: string): Promise<void> => {
  const point = await textPoint(page, text, 'end')
  await page.mouse.click(point.x, point.y)
  await page.keyboard.type(typed)
}

const expectTracking = async(app: ElectronApplication, page: Page, on: boolean): Promise<void> => {
  await expect(page.getByTestId('critic-review-track-changes')).toHaveAttribute('aria-pressed', String(on))
  await expect(page.getByTestId('title-bar-tracking')).toHaveCount(on ? 1 : 0)
  await expect.poll(() => reviewMenuChecked(app)).toBe(on)
}

test('Track Changes stays on through Source mode until the user turns it off', async() => {
  const { app, page, filePath } = await launchWithReviewMarkdown(SOURCE, { suppressErrorDialog: true, env })
  try {
    await page.getByTestId('critic-review-track-changes').click()
    await expectTracking(app, page, true)

    await enterSourceMode(page, app)
    await exitSourceMode(page, app)
    await expectTracking(app, page, true)
    await typeAtEndOf(page, 'gamma.', ' Delta.')
    await expectSaved(app, filePath, 'Alpha beta gamma.{++ Delta.++}\n')

    // A second trip keeps it on too, and turning it off sticks the same way.
    await enterSourceMode(page, app)
    await exitSourceMode(page, app)
    await expectTracking(app, page, true)
    await page.getByTestId('critic-review-track-changes').click()
    await expectTracking(app, page, false)
    await enterSourceMode(page, app)
    await exitSourceMode(page, app)
    await expectTracking(app, page, false)
    await typeAtEndOf(page, 'beta', ',')
    await expectSaved(app, filePath, 'Alpha beta, gamma.{++ Delta.++}\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Track Changes belongs to its document\'s tab', async() => {
  const { app, page } = await launchWithReviewMarkdown(SOURCE, { suppressErrorDialog: true, env })
  const activeTabId = (): Promise<string | null> =>
    page.evaluate(() => document.querySelector('.tabs-container > li.active')?.getAttribute('data-id') ?? null)
  try {
    const tracked = await activeTabId()
    await page.getByTestId('critic-review-track-changes').click()
    await expectTracking(app, page, true)

    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'Second document.\n')
    await expect.poll(activeTabId).not.toBe(tracked)
    await expectTracking(app, page, false)

    await page.locator(`.tabs-container > li[data-id="${tracked}"]`).click()
    await expect.poll(activeTabId).toBe(tracked)
    await expectTracking(app, page, true)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

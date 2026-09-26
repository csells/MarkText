import { expect, test, type Page } from '@playwright/test'
import {
  clickMenuById,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown
} from './helpers'

// Vision and ADR 0004: passive caret placement selects the matching Review
// entry but never opens, switches or scrolls the sidebar. Opening is a
// deliberate act (the sidebar tab, a card, Edit Comment, a new comment, or
// keyboard activation of the comment marker).
const source = 'Plain {++added phrase++} text.\n\nA note{>>Standalone note<<} here.\n'
const env = { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }

const sidebar = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.side-bar')
    const active = document.querySelector<HTMLElement>('.side-bar .left-column .active')
    return {
      visible: bar !== null && getComputedStyle(bar).display !== 'none',
      tab: active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? null
    }
  })

test('clicking into an addition or a comment marker leaves a hidden sidebar hidden', async() => {
  const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    expect((await sidebar(page)).visible).toBe(false)
    await page.locator('[data-critic-kind="addition"]').click()
    await page.waitForTimeout(500)
    expect((await sidebar(page)).visible).toBe(false)
    await page.locator('.mu-critic-comment-marker').click()
    await page.waitForTimeout(500)
    expect((await sidebar(page)).visible).toBe(false)
    await expectEditorWindowHidden(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('clicking into an annotation does not switch the sidebar away from Files', async() => {
  const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await clickMenuById(app, 'sideBarMenuItem')
    await page.locator('.side-bar .left-column li').first().click()
    const before = await sidebar(page)
    expect(before.visible).toBe(true)
    await page.locator('[data-critic-kind="addition"]').click()
    await page.waitForTimeout(500)
    expect(await sidebar(page)).toEqual(before)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('keyboard activation of the comment marker opens its Review entry', async() => {
  const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await page.locator('.mu-critic-comment-marker').focus()
    await page.keyboard.press('Enter')
    await expect.poll(async() => (await sidebar(page)).visible).toBe(true)
    await expect(page.locator('#core-review-panel')).toBeVisible()
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

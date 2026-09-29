import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import {
  clickMenuById,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  showReviewSidebar
} from './helpers'

// Google Docs shows the card of the suggestion or comment the author moves
// to. The sidebar brings the selected card into view whether the author moves
// there with Next and Previous, the caret or a click, even in a list long
// enough that only the cards near its view are mounted, and leaves the view
// where the author scrolled it while they type in the selected entry.

const options = {
  suppressErrorDialog: true,
  env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
}
const paragraphs = 150
const source = ['Opening paragraph.', ...Array.from({ length: paragraphs }, (_, index) =>
  `Paragraph ${index} {++added ${index}++} and {==mark ${index}==}{>>note ${index}<<}.`)].join('\n\n') + '\n'

/** The selected card's text and whether all of it shows in the sidebar's scroll box. */
const selectedCard = (page: Page) => page.evaluate(() => {
  const scroll = document.querySelector<HTMLElement>('#core-review-panel .core-review-scroll')
  const card = document.querySelector<HTMLElement>('#core-review-panel .core-review-entry.active')
  if (scroll === null || card === null) return { text: undefined, inView: false, scrollTop: scroll?.scrollTop }
  const view = scroll.getBoundingClientRect()
  const rect = card.getBoundingClientRect()
  return {
    text: card.textContent ?? '',
    inView: rect.top >= view.top - 0.5 && rect.bottom <= view.bottom + 0.5,
    scrollTop: scroll.scrollTop
  }
})
const focusInSidebar = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('#core-review-panel') !== null)

const scrollSidebar = async(page: Page, deltaY: number): Promise<void> => {
  const box = await page.locator('#core-review-panel .core-review-scroll').boundingBox()
  if (box === null) throw new Error('The sidebar has no scroll box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, deltaY)
  await expect.poll(async() => (await selectedCard(page)).inView).toBe(false)
}

test('Next, Previous, a click and the caret bring the selected card into view in a long list', async() => {
  const { app, page } = await launchWithMarkdown(source, options)
  try {
    await showReviewSidebar(app)
    const list = page.getByTestId('critic-review-list')
    await expect(list.getByTestId('critic-review-entry').first()).toBeVisible()
    // Only the cards near the view are mounted.
    expect(await list.getByTestId('critic-review-entry').count()).toBeLessThan(2 * paragraphs)

    // A click on an annotation whose card is far below the view.
    await page.locator('.mu-paragraph-content').filter({ hasText: /^Paragraph 140 / })
      .locator('[data-critic-kind="addition"]').click()
    await expect.poll(async() => (await selectedCard(page)).text).toContain('added 140')
    await expect.poll(async() => (await selectedCard(page)).inView).toBe(true)
    expect(await focusInSidebar(page)).toBe(false)

    // Next, from the sidebar, after the author scrolled the card away.
    await scrollSidebar(page, -6000)
    const before = (await selectedCard(page)).text
    await page.getByTestId('critic-review-next').click()
    await expect.poll(async() => (await selectedCard(page)).text).not.toBe(before)
    await expect.poll(async() => (await selectedCard(page)).inView).toBe(true)

    // Previous, from the menu, after scrolling the other way.
    await scrollSidebar(page, 6000)
    const afterNext = (await selectedCard(page)).text
    await clickMenuById(app, 'critic-previous')
    await expect.poll(async() => (await selectedCard(page)).text).not.toBe(afterNext)
    await expect.poll(async() => (await selectedCard(page)).inView).toBe(true)

    // Previous returned to the entry clicked first. Clicking its annotation
    // again, after the author scrolled its card away, shows the card again
    // though the selection does not change.
    expect((await selectedCard(page)).text).toContain('added 140')
    const annotation = page.locator('.mu-paragraph-content').filter({ hasText: /^Paragraph 140 / })
      .locator('[data-critic-kind="addition"]')
    for (const deltaY of [6000, -6000]) {
      await scrollSidebar(page, deltaY)
      await annotation.click()
      await expect.poll(async() => (await selectedCard(page)).inView).toBe(true)
      expect((await selectedCard(page)).text).toContain('added 140')
      expect(await focusInSidebar(page)).toBe(false)
    }

    // A card already in view is left where it is.
    const settled = await selectedCard(page)
    await page.locator('.mu-paragraph-content').filter({ hasText: /^Paragraph 138 / })
      .locator('[data-critic-kind="addition"]').click()
    await expect.poll(async() => (await selectedCard(page)).text).toContain('added 138')
    const nearby = await selectedCard(page)
    expect(nearby.inView).toBe(true)
    if (Math.abs(nearby.scrollTop! - settled.scrollTop!) > 1) {
      // Only the least scroll that shows the card is allowed.
      expect(Math.abs(nearby.scrollTop! - settled.scrollTop!)).toBeLessThan(400)
    }

    // The caret moving into an annotation, far above the view.
    const lead = page.locator('.mu-paragraph-content').filter({ hasText: /^Paragraph 3 / })
    await lead.click({ position: { x: 2, y: 4 } })
    await page.keyboard.press('Home')
    for (let index = 0; index < 'Paragraph 3 '.length + 2; index += 1) await page.keyboard.press('ArrowRight')
    await expect.poll(async() => (await selectedCard(page)).text).toContain('added 3')
    await expect.poll(async() => (await selectedCard(page)).inView).toBe(true)
    expect(await focusInSidebar(page)).toBe(false)

    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
  } finally {
    await app.close()
  }
})

test('typing in the selected entry leaves the sidebar where the author scrolled it', async() => {
  const { app, page } = await launchWithMarkdown(source, options)
  try {
    await showReviewSidebar(app)
    const lead = page.locator('.mu-paragraph-content').filter({ hasText: /^Paragraph 120 / })
    await lead.click({ position: { x: 2, y: 4 } })
    await page.keyboard.press('Home')
    for (let index = 0; index < 'Paragraph 120 '.length + 2; index += 1) await page.keyboard.press('ArrowRight')
    await expect.poll(async() => (await selectedCard(page)).text).toContain('added 120')
    await expect.poll(async() => (await selectedCard(page)).inView).toBe(true)
    await scrollSidebar(page, -4000)
    const scrolled = (await selectedCard(page)).scrollTop!
    await page.keyboard.type('zz')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    // Past the passive refresh after typing pauses.
    await page.waitForTimeout(800)
    const after = await selectedCard(page)
    expect(after.text).toMatch(/a\w*zz\w*ded 120/)
    expect(after.inView).toBe(false)
    expect(Math.abs(after.scrollTop! - scrolled)).toBeLessThan(1)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

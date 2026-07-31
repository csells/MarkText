import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeElectron,
  expectNoRendererErrors,
  launchWithMarkdown
} from './helpers'
import {
  expectCanonicalOnDisk
} from './documentCoreReviewE2e'

const LINK_WRAPPER = '.editor-component a[href="#my-section"]'

// Many filler paragraphs so the document overflows the viewport and the target
// heading starts well below the fold. The link sits at the very top, so a
// successful jump scrolls DOWN (scrollTop 0 -> large positive).
const filler = Array.from({ length: 60 }, (_, i) => `Filler paragraph number ${i + 1}.`).join(
  '\n\n'
)

const DOC = `[go](#my-section)\n\n${filler}\n\n## My Section\n\nThe destination paragraph under My Section.\n`

// Read the public document-view root's live scroll position.
const scrollTop = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector('.editor-component') as HTMLElement | null
    return el ? el.scrollTop : -1
  })

test.describe('In-document anchor link click scrolls the editor (item 236)', () => {
  let app: ElectronApplication
  let page: Page
  let documentPath = ''

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(DOC)
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
    // Wait for the target view's public link element before interacting.
    await page.waitForSelector(LINK_WRAPPER, { state: 'attached', timeout: 15000 })
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test('the rendered link resolves its href to the in-doc anchor and the heading is present', async() => {
    const wiring = await page.evaluate((selector) => {
      const link = document.querySelector(selector) as HTMLAnchorElement | null
      const heading = document.querySelector('.document-view-container > h2')
      return {
        hrefAttr: link ? link.getAttribute('href') : null,
        tagName: link?.tagName ?? null,
        headingText: heading ? heading.textContent : null
      }
    }, LINK_WRAPPER)

    expect(wiring.hrefAttr).toBe('#my-section')
    expect(wiring.tagName).toBe('A')
    expect(wiring.headingText).toContain('My Section')
    await expectCanonicalOnDisk(page, app, documentPath, DOC)
  })

  test('Cmd/Ctrl-clicking the link scrolls the editor down to the heading', async() => {
    // Start at the top of the document.
    await page.evaluate(() => {
      const el = document.querySelector('.editor-component') as HTMLElement | null
      if (el) el.scrollTop = 0
    })
    await expect.poll(() => scrollTop(page)).toBe(0)

    await page.locator(LINK_WRAPPER).click({
      modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control']
    })

    // animatedScrollTo runs over ~300ms; poll until the container has scrolled a
    // meaningful distance toward the off-screen heading.
    await expect.poll(() => scrollTop(page), { timeout: 8000 }).toBeGreaterThan(100)

    // Settle to the final position, then assert the heading is parked near the
    // top of the viewport (STANDAR_Y = 320 offset), proving the jump landed on
    // the right element and not at some arbitrary scroll offset.
    await page.waitForTimeout(500)
    const headingTop = await page.evaluate(() => {
      const heading = document.querySelector('.document-view-container > h2')
      return heading ? heading.getBoundingClientRect().top : null
    })
    expect(headingTop).not.toBeNull()
    expect(headingTop as number).toBeLessThan(500)
    expect(headingTop as number).toBeGreaterThan(-200)

    await expectCanonicalOnDisk(page, app, documentPath, DOC)
    await expectNoRendererErrors(app)
  })

  test('a plain (no-modifier) click on the link does NOT scroll', async() => {
    // Reset to the top.
    await page.evaluate(() => {
      const el = document.querySelector('.editor-component') as HTMLElement | null
      if (el) el.scrollTop = 0
    })
    await expect.poll(() => scrollTop(page)).toBe(0)

    await page.locator(LINK_WRAPPER).click()

    // Give any (incorrect) scroll animation time to start; it must not.
    await page.waitForTimeout(600)
    expect(await scrollTop(page)).toBe(0)

    await expectCanonicalOnDisk(page, app, documentPath, DOC)
    await expectNoRendererErrors(app)
  })
})

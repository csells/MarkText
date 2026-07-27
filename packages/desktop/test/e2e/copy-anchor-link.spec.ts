import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, expectNoRendererErrors } from './helpers'

// ---------------------------------------------------------------------------
// Coverage backfill (checklist item 241). The hover-to-copy heading affordance
// round-trip is missing at the e2e layer:
//   - The engine-owned heading anchor materialization is covered below through
//     the renderer-to-main clipboard boundary.
// This covers the live hover -> click -> OS clipboard round-trip in a real
// window.
//
// The parser-derived heading owns an accessible copy-link button. Desktop
// receives its typed interaction and writes the generated GitHub slug.
//
// We read the clipboard back from the MAIN process (Electron's `clipboard`
// module, exposed to app.evaluate's first arg) because that is where the IPC
// handler writes — it is the authoritative end of the round-trip and avoids the
// async preload `invoke` for read-text.
// ---------------------------------------------------------------------------

const HEADING = '.document-view-container > h2.document-view-heading'
const COPY_LINK = `${HEADING} > button[data-document-command="copy-heading-link"]`

const DOC = '## My Section\n\nA paragraph under the heading.\n'

// Read the OS clipboard as seen by the main process, which owns the complete
// heading-link materialization and clipboard write transaction.
const readClipboard = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ clipboard }) => clipboard.readText())

const writeClipboard = (app: ElectronApplication, text: string): Promise<void> =>
  app.evaluate(({ clipboard }, value) => {
    clipboard.writeText(value)
  }, text)

test.describe('Heading hover-to-copy anchor affordance (item 241)', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(DOC)
    app = launched.app
    page = launched.page
    // The heading + its copy affordance render once the document parses.
    await page.waitForSelector(COPY_LINK, { state: 'attached', timeout: 15000 })
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('the heading renders an accessible copy-anchor affordance', async() => {
    const info = await page.evaluate((selector) => {
      const el = document.querySelector(selector) as HTMLElement | null
      if (!el) return null
      return {
        tagName: el.tagName,
        tabIndex: el.tabIndex,
        ariaLabel: el.getAttribute('aria-label'),
        text: el.textContent
      }
    }, COPY_LINK)

    expect(info).not.toBeNull()
    expect(info?.tagName).toBe('BUTTON')
    expect(info?.tabIndex).toBe(0)
    expect(info?.ariaLabel).toBeTruthy()
    expect(info?.text).toBe('')
  })

  test('hovering the heading then clicking the affordance copies its anchor', async() => {
    // Clear the clipboard to a known sentinel so we can prove the write came
    // from this interaction and not a stale value.
    await writeClipboard(app, 'sentinel-before-copy')
    await expect.poll(() => readClipboard(app)).toBe('sentinel-before-copy')

    // Hover the heading first to mirror the real reveal-on-hover affordance,
    // then click the now-visible copy icon.
    await page.hover(HEADING)
    await page.click(COPY_LINK)

    // The write flows renderer -> IPC -> main clipboard, so poll the main-side
    // clipboard until the anchor lands.
    await expect.poll(() => readClipboard(app), { timeout: 8000 }).toBe('#my-section')

    await expectNoRendererErrors(app)
  })

  test('the copied anchor starts with "#" and matches the heading anchor', async() => {
    await writeClipboard(app, '')
    await expect.poll(() => readClipboard(app)).toBe('')

    await page.hover(HEADING)
    await page.click(COPY_LINK)

    await expect.poll(() => readClipboard(app), { timeout: 8000 }).not.toBe('')
    const copied = await readClipboard(app)
    expect(copied.startsWith('#')).toBe(true)

    // The slug must derive from the heading text ("My Section" -> "my-section"),
    // proving the engine key resolved to the matching listToc entry rather than
    // some unrelated heading.
    expect(copied).toBe('#my-section')

    await expectNoRendererErrors(app)
  })

  test('activating the affordance via keyboard (Enter) also copies the anchor', async() => {
    await writeClipboard(app, 'keyboard-sentinel')
    await expect.poll(() => readClipboard(app)).toBe('keyboard-sentinel')

    // A native button activates through Enter as well as pointer input.
    await page.focus(COPY_LINK)
    await page.keyboard.press('Enter')

    await expect.poll(() => readClipboard(app), { timeout: 8000 }).toBe('#my-section')

    await expectNoRendererErrors(app)
  })
})

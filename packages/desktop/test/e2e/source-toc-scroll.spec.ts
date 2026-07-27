import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { closeElectron, launchWithMarkdown, waitForEditor, enterSourceMode, clickMenuById } from './helpers'

// marktext #3580: clicking a TOC entry in SOURCE CODE mode must scroll the
// editor to that heading and place it near the top of the textarea viewport.
const HEADING_COUNT = 20
const buildLongDoc = (): string => {
  const parts: string[] = []
  for (let i = 1; i <= HEADING_COUNT; i++) {
    parts.push(`# Heading Number ${i}`)
    for (let p = 0; p < 6; p++) parts.push(`Filler paragraph ${p} under heading ${i}. Lorem ipsum dolor.`)
  }
  return parts.join('\n\n') + '\n'
}

const srcScrollTop = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector(
      '.source-code-input'
    ) as HTMLTextAreaElement | null
    return el ? Math.round(el.scrollTop) : -1
  })

const selectedHeading = (page: Page, text: string): Promise<boolean> =>
  page.evaluate((needle) => {
    const input = document.querySelector(
      '.source-code-input'
    ) as HTMLTextAreaElement | null
    return input?.value.slice(input.selectionStart).startsWith(needle) ?? false
  }, `# ${text}`)

test.describe('Source Code mode: TOC click scrolls to the heading at the top', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(buildLongDoc())
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await enterSourceMode(page, app)
    const sbVisible = await page.evaluate(() => {
      const el = document.querySelector('.side-bar') as HTMLElement | null
      return !!(el && el.offsetParent !== null)
    })
    if (!sbVisible) await clickMenuById(app, 'sideBarMenuItem')
    await clickMenuById(app, 'tocMenuItem')
    await page.waitForSelector('.side-bar-toc .el-tree', { state: 'visible', timeout: 10000 })
    await page.waitForFunction(
      (c) => document.querySelectorAll('.side-bar-toc .el-tree-node__label').length >= c,
      HEADING_COUNT,
      { timeout: 10000 }
    )
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test('clicking a deep heading scrolls down and lands it near the top', async() => {
    await page.evaluate(() => {
      const el = document.querySelector(
        '.source-code-input'
      ) as HTMLTextAreaElement | null
      if (el) el.scrollTop = 0
    })
    await expect.poll(() => srcScrollTop(page)).toBe(0)

    await page.locator('.side-bar-toc').getByText('Heading Number 18', { exact: true }).click()

    await expect.poll(() => srcScrollTop(page), { timeout: 8000 }).toBeGreaterThan(0)
    await expect.poll(
      () => selectedHeading(page, 'Heading Number 18'),
      { timeout: 8000 }
    ).toBe(true)
  })

  test('clicking an earlier heading scrolls back up to it at the top', async() => {
    const fromTop = await srcScrollTop(page)
    expect(fromTop).toBeGreaterThan(0)
    await page.locator('.side-bar-toc').getByText('Heading Number 3', { exact: true }).click()
    await expect.poll(() => srcScrollTop(page), { timeout: 8000 }).toBeLessThan(fromTop)
    await expect.poll(
      () => selectedHeading(page, 'Heading Number 3'),
      { timeout: 8000 }
    ).toBe(true)
  })
})

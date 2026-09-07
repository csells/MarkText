import { expect, test, type Locator } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { clickMenuById, expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

async function visibleBounds(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('Expected a visible layout element')
  return bounds
}

const source = Array.from({ length: 24 }, (_, index) =>
  `# Section ${index + 1}\n\nReview {++addition ${index + 1}++} and {==passage ${index + 1}==}{>>Comment ${index + 1}.<<}.\n`
).join('\n')

test('Original and Revised retain the full editor scroll surface with a centered reading column', async() => {
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    for (const theme of ['light', 'dracula']) {
      await clickMenuById(app, theme)
      for (const width of [1000, 1400]) {
        await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
        for (const mode of ['original', 'revised'] as const) {
          await page.getByTestId(`critic-review-${mode}`).click()
          const projection = page.locator(`.editor-wrapper > [data-projection="${mode}"]`)
          await expect(projection).toBeVisible()
          const bounds = await visibleBounds(projection)
          const editor = await visibleBounds(page.locator('.editor-wrapper'))
          expect.soft(bounds.x, `${theme}/${width}/${mode}: scroll surface left edge`).toBeCloseTo(editor.x, 0)
          expect.soft(bounds.x + bounds.width, `${theme}/${width}/${mode}: scrollbar at editor right edge`).toBeCloseTo(editor.x + editor.width, 0)
          const content = await visibleBounds(projection.locator('.core-projection-content'))
          expect.soft(content.width).toBeLessThanOrEqual(800)
          expect.soft(content.x).toBeGreaterThanOrEqual(bounds.x)
          expect.soft(await projection.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
          await projection.hover()
          await page.mouse.wheel(0, 800)
          await expect.poll(() => projection.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
          await expect(page.locator('.editor-surface')).toBeHidden()
          await page.screenshot({ path: test.info().outputPath(`${theme}-${width}-${mode}.png`) })
        }
      }
    }
    await page.getByTestId('critic-review-markup').click()
    await expect(page.locator('.editor-surface')).toBeVisible()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('Comments and Suggestions follows native sidebar title, scrolling, divider and focus conventions', async() => {
  const { app, page } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    const sidebar = page.locator('.side-bar')
    for (const theme of ['light', 'dracula']) {
      await clickMenuById(app, theme)
      await sidebar.getByRole('tab', { name: 'Table of Contents', exact: true }).click()
      const nativeTitle = await sidebar.locator('.side-bar-toc .title').evaluate(node => {
        const style = getComputedStyle(node)
        return { fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color }
      })
      await sidebar.getByRole('tab', { name: 'Comments and Suggestions', exact: true }).click()
      const title = sidebar.getByRole('heading', { name: 'Comments and Suggestions', exact: true })
      const titleBefore = await visibleBounds(title)
      for (const [property, value] of Object.entries(nativeTitle)) {
        expect.soft(await title.evaluate((node, property) => getComputedStyle(node)[property as keyof CSSStyleDeclaration], property)).toBe(value)
      }
      const lastEntry = sidebar.getByTestId('critic-review-entry').last().locator(':scope > button')
      const scrollStyle = await lastEntry.evaluate(node => {
        let scroll = node.parentElement
        while (scroll && !(scroll.scrollHeight > scroll.clientHeight && /auto|scroll/.test(getComputedStyle(scroll).overflowY))) scroll = scroll.parentElement
        if (!scroll) throw new Error('Review list has no scroll container')
        return { width: scroll.offsetWidth - scroll.clientWidth, top: scroll.getBoundingClientRect().top }
      })
      expect.soft(scrollStyle.width).toBe(8)
      expect.soft(scrollStyle.top).toBeGreaterThan(titleBefore.y + titleBefore.height)
      await lastEntry.click()
      await expect.soft(title).toBeInViewport({ ratio: 1 })
      expect.soft((await visibleBounds(title)).y).toBeCloseTo(titleBefore.y, 0)
      await lastEntry.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await expect(lastEntry).toBeFocused()
      const focused = await lastEntry.evaluate(node => ({
        color: getComputedStyle(node).backgroundColor,
        expected: getComputedStyle(document.documentElement).getPropertyValue('--sideBarItemHoverBgColor').trim()
      }))
      expect.soft(focused.color).toBe(focused.expected)
      await page.mouse.move(800, 50)
      const divider = sidebar.locator('.drag-bar')
      await expect(divider).toHaveCSS('border-right-width', '0px')
      await divider.hover()
      await expect(divider).toHaveCSS('border-right-width', '2px')
      await page.screenshot({ path: test.info().outputPath(`${theme}-review-sidebar.png`) })
    }
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

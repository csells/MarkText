import { expect, test } from '@playwright/test'
import { clickMenuById, expectEditorWindowHidden, expectNoRendererErrors, launchWithMarkdown } from './helpers'

const options = { suppressErrorDialog: true, env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined } }

test('Review uses the existing dark theme and keeps all view buttons inside the sidebar', async() => {
  const { app, page } = await launchWithMarkdown('# Review\n\n{==Passage==}{>>A **formatted** comment.<<}\n', options)
  try {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    await clickMenuById(app, 'dracula')
    await expect(page.locator('body')).toHaveClass(/(^|\s)dark(\s|$)/)
    await expect(page.getByTestId('critic-margin-comment')).toContainText('A formatted comment.')
    const panel = page.locator('#core-review-panel')
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('review-dark.png') })
    await expectEditorWindowHidden(app)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('margin comments follow their document anchors when scrolling', async() => {
  const source = '{==First passage==}{>>First note.<<}\n\n' +
    Array.from({ length: 35 }, (_, index) => `Paragraph ${index}.\n\n`).join('') +
    '{==Last passage==}{>>Last note.<<}\n'
  const { app, page } = await launchWithMarkdown(source, options)
  try {
    const last = page.locator('.mu-paragraph-content').filter({ hasText: 'Last passage' })
    await last.scrollIntoViewIfNeeded()
    const card = page.getByTestId('critic-margin-comment').filter({ hasText: 'Last note.' })
    await expect(card).toBeInViewport()
    await expect.poll(async() => {
      const target = await last.boundingBox()
      const margin = await card.boundingBox()
      return target && margin ? Math.abs(target.y - margin.y) : Infinity
    }).toBeLessThan(4)
    await page.screenshot({ path: test.info().outputPath('review-scrolled-margin.png') })
    await expectEditorWindowHidden(app)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('navigation still identifies the exact suggestion after an earlier paragraph shifts its source position', async() => {
  const { app, page } = await launchWithMarkdown('Prefix\n\n{++first++} and {++second++}\n', options)
  try {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    await page.locator('.mu-paragraph-content').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' expanded')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await page.getByTestId('critic-review-next').click()
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'addition')
    await expect(page.locator('.core-review-current-block')).toHaveText('second')
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

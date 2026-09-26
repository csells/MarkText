import { expect, test } from '@playwright/test'
import { clickMenuById, expectEditorWindowHidden, expectNoRendererErrors, launchWithMarkdown, showReviewSidebar } from './helpers'

const options = { suppressErrorDialog: true, env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined } }

test('Review uses the existing dark theme and keeps all view buttons inside the sidebar', async() => {
  const { app, page } = await launchWithMarkdown('# Review\n\n{==Passage==}{>>A **formatted** comment.<<}\n', options)
  try {
    await showReviewSidebar(app)
    await clickMenuById(app, 'dracula')
    await expect(page.locator('body')).toHaveClass(/(^|\s)dark(\s|$)/)
    await expect(page.getByTestId('critic-review-entry')).toContainText('A formatted comment.')
    const panel = page.locator('#core-review-panel')
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('review-dark.png') })
    await expectEditorWindowHidden(app)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('sidebar comments reveal distant document anchors without creating another margin', async() => {
  const source = '{==First passage==}{>>First note.<<}\n\n' +
    Array.from({ length: 35 }, (_, index) => `Paragraph ${index}.\n\n`).join('') +
    '{==Last passage==}{>>Last note.<<}\n'
  const { app, page } = await launchWithMarkdown(source, options)
  try {
    await showReviewSidebar(app)
    const last = page.locator('.mu-paragraph-content').filter({ hasText: 'Last passage' })
    const card = page.getByTestId('critic-review-entry').filter({ hasText: 'Last note.' })
    await card.locator(':scope > button').click()
    await expect(last).toBeInViewport()
    await expect(page.locator('.core-review-current-block')).toHaveText('Last passage')
    await expect(card.locator(':scope > button')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.core-review-margin')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('review-distant-sidebar-target.png') })
    await expectEditorWindowHidden(app)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('navigation still identifies the exact suggestion after an earlier paragraph shifts its source position', async() => {
  const { app, page } = await launchWithMarkdown('Prefix\n\n{++first++} and {++second++}\n', options)
  try {
    await showReviewSidebar(app)
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

test('review cards follow every built-in theme', async() => {
  const { app, page } = await launchWithMarkdown('{++First++} and {--second--}.\n', options)
  try {
    await showReviewSidebar(app)
    // The Theme menu groups its radio items in light and dark submenus.
    const themes = await app.evaluate(({ Menu }) => {
      const ids: string[] = []
      const visit = (items: Electron.MenuItem[]): void => {
        for (const item of items) {
          if (item.type === 'radio' && item.id) ids.push(item.id)
          if (item.submenu) visit(item.submenu.items)
        }
      }
      visit(Menu.getApplicationMenu()?.getMenuItemById('themeMenu')?.submenu?.items ?? [])
      return ids
    })
    expect(themes.length).toBeGreaterThan(1)
    for (const theme of themes) {
      await clickMenuById(app, theme)
      await page.waitForTimeout(200)
      const cards = await page.getByTestId('critic-review-entry').locator(':scope > button').evaluateAll(buttons => {
        const bar = getComputedStyle(document.documentElement).getPropertyValue('--sideBarColor').trim()
        return buttons.map(button => {
          const style = getComputedStyle(button)
          const probe = document.createElement('span')
          probe.style.color = bar
          document.body.append(probe)
          const expected = getComputedStyle(probe).color
          probe.remove()
          const active = button.getAttribute('aria-pressed') === 'true'
          return { active, background: style.backgroundColor, color: style.color, expected }
        })
      })
      for (const card of cards.filter(card => !card.active)) {
        expect(card.background, `${theme} card background`).toBe('rgba(0, 0, 0, 0)')
        expect(card.color, `${theme} card text`).toBe(card.expected)
      }
    }
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

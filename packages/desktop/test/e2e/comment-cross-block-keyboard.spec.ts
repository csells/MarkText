// Reproduce: a KEYBOARD (Shift+arrow) cross-block selection leaves the
// Add Comment menu item disabled, because muya emits no selection-change for
// shift-selections — so the menu's canAddComment stays stale from the prior
// collapsed caret. (Mouse selection works; keyboard does not.)
import { expect, test, type ElectronApplication } from '@playwright/test'
import { focusEditor, launchWithMarkdown } from './helpers'

const menuEnabled = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('review.add-comment')
    return item ? item.enabled : null
  })

test('keyboard Shift+arrow cross-block selection enables Add Comment', async() => {
  const md = 'hello world\n\nsecond line\n'
  const { app, page } = await launchWithMarkdown(md, { suppressErrorDialog: true })
  try {
    await focusEditor(page)
    const readSel = () => page.evaluate(() => {
      const s = document.getSelection()
      const para = (n: Node | null | undefined) => {
        const el = n && n.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element | null)
        return el?.closest?.('.mu-paragraph')?.textContent?.slice(0, 12) ?? null
      }
      return { isCollapsed: s?.isCollapsed ?? true, anchor: para(s?.anchorNode), focus: para(s?.focusNode) }
    })
    // Caret in the MIDDLE of "hello world".
    await page.locator('.mu-paragraph', { hasText: 'hello' }).first().click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(120)
    expect(await menuEnabled(app), 'menu disabled for a collapsed caret').toBe(false)

    // Keyboard-select DOWN into the second paragraph (cross-block).
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.up('Shift')
    await page.waitForTimeout(150)

    const sel = await readSel()
    const menu = await menuEnabled(app)
    // eslint-disable-next-line no-console
    console.log('after Shift+Down:', JSON.stringify(sel), 'menu enabled:', menu)
    expect(sel.isCollapsed, 'DOM selection should span both paragraphs').toBe(false)
    expect(sel.anchor !== sel.focus, `selection should be cross-block (anchor=${sel.anchor} focus=${sel.focus})`).toBe(true)
    // The bug: menu stays disabled for a valid cross-block keyboard selection.
    expect(menu, 'Add Comment should be enabled for a cross-block keyboard selection').toBe(true)
  } finally {
    await app.close()
  }
})

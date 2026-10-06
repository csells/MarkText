import { expect, test, type Page } from '@playwright/test'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'
import { expectSaved, hiddenCoreEnv as env, textPoint } from './reviewGestures'

// Upstream MarkText (#5597) shows a task item's marker as a checkbox in an
// ordered list as in a bullet one, and an ordered item emptied of its text
// stays an empty task with its checkbox. An upstream c054632f build shows the
// same render after each step. The saved bytes keep the blank line between
// the two lists, which upstream drops when it writes the whole document
// afresh; edits here change only the bytes they touch (ADR 0007).

const checkboxes = (page: Page) => page.locator('.editor-component input[type=checkbox]')
const orderedItem = (page: Page, index: number) => page.locator('.editor-component ol > li').nth(index)
const bulletItem = (page: Page, index: number) => page.locator('.editor-component ul > li').nth(index)

test('an emptied ordered task item keeps its checkbox, as a bullet one does', async() => {
  const source = '1. [ ] x\n\n- [ ] y\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await expect(checkboxes(page)).toHaveCount(2)
    await expect(page.locator('.editor-component ol.mu-task-list')).toHaveCount(1)
    await expect(orderedItem(page, 0)).toHaveText('x')

    const x = await textPoint(page, 'x', 'end')
    await page.mouse.click(x.x, x.y)
    await page.keyboard.press('Backspace')
    await expect(orderedItem(page, 0)).toHaveText('')
    await expect(checkboxes(page)).toHaveCount(2)
    await expectSaved(app, filePath, '1. [ ] \n\n- [ ] y\n')

    const y = await textPoint(page, 'y', 'end')
    await page.mouse.click(y.x, y.y)
    await page.keyboard.press('Backspace')
    await expect(bulletItem(page, 0)).toHaveText('')
    await expect(checkboxes(page)).toHaveCount(2)
    await expectSaved(app, filePath, '1. [ ] \n\n- [ ] \n')

    // Undo restores both items' text and keeps both checkboxes.
    for (let step = 0; step < 2 && (await page.locator('.editor-component ol > li').innerText()) !== 'x'; step += 1) {
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await page.waitForTimeout(300)
    }
    await expectSaved(app, filePath, source)
    await expect(checkboxes(page)).toHaveCount(2)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

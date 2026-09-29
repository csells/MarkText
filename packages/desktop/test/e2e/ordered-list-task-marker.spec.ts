import { expect, test, type Page } from '@playwright/test'
import { expectNoRendererErrors, launchWithMarkdown } from './helpers'
import { expectSaved, hiddenCoreEnv as env, textPoint } from './reviewGestures'

// Upstream MarkText 0c33241b has no ordered task item (Profile 1 D14). Its
// import reads an ordered item's `[ ]` with nothing after it as the item's
// text, and shows a marker with text after it as neither text nor checkbox.
// A bullet item's marker is a task's checkbox.

const checkboxes = (page: Page) => page.locator('.editor-component input[type=checkbox]')
const orderedItem = (page: Page, index: number) => page.locator('.editor-component ol > li').nth(index)

test('an emptied ordered task item shows its `[ ]` as text, while a bullet one keeps its checkbox', async() => {
  const source = '1. [ ] x\n\n- [ ] y\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await expect(checkboxes(page)).toHaveCount(1)
    await expect(orderedItem(page, 0)).toHaveText('x')

    const x = await textPoint(page, 'x', 'end')
    await page.mouse.click(x.x, x.y)
    await page.keyboard.press('Backspace')
    await expect(orderedItem(page, 0)).toHaveText('[ ]')
    await expect(checkboxes(page)).toHaveCount(1)

    const y = await textPoint(page, 'y', 'end')
    await page.mouse.click(y.x, y.y)
    await page.keyboard.press('Backspace')
    await expect(checkboxes(page)).toHaveCount(1)

    await expectSaved(app, filePath, '1. [ ] \n\n- [ ] \n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

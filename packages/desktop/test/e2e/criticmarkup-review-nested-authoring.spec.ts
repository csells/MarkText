import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { expectNoRendererErrors, launchWithMarkdown } from './helpers'
import {
  authoringForms,
  captureContextMenu,
  clickContextMenu,
  clickReviewMenu,
  contextMenuItems,
  drag,
  expectSaved,
  focusInDocument,
  hiddenCoreEnv as env,
  menuStates,
  nativeKey,
  resetContextMenu,
  textPoint,
  toolbarState
} from './reviewGestures'

// Plan 0012 G15: as in Google Docs, text that is itself a suggestion or is
// highlighted or commented can be highlighted, suggested on or commented on
// again. Every form nests inside any arm (Profile 1 N1). A form that would
// cross an annotation's delimiters stays unavailable, and its shortcut beeps
// as macOS answers an unavailable key command.

const composer = (page: Page, prefix: string) =>
  page.locator(
    `[data-testid="critic-review-entry"] [data-testid="${prefix}-input"], [data-testid="critic-review-draft-entry"] [data-testid="${prefix}-input"]`
  )

const submit = async(page: Page, prefix: string, text: string) => {
  const input = composer(page, prefix)
  await expect(input).toBeFocused()
  await page.keyboard.type(text)
  await page.keyboard.press('Meta+Enter')
  await expect(input).toHaveCount(0)
}

const selectWord = async(page: Page, word: string) => {
  await drag(page, await textPoint(page, word, 'start'), await textPoint(page, word, 'end'))
}

const cases = [
  {
    entry: 'toolbar',
    container: 'an Addition',
    source: 'Lead {++alpha beta gamma++} tail.\n',
    form: 'mark-highlight',
    expected: 'Lead {++alpha {==beta==} gamma++} tail.\n'
  },
  {
    entry: 'Review menu',
    container: 'a Deletion',
    source: 'Lead {--alpha beta gamma--} tail.\n',
    form: 'mark-addition',
    expected: 'Lead {--alpha {++beta++} gamma--} tail.\n'
  },
  {
    entry: 'context menu',
    container: "a Substitution's new arm",
    source: 'Lead {~~other~>alpha beta gamma~~} tail.\n',
    form: 'suggest-replacement',
    expected: 'Lead {~~other~>alpha {~~beta~>new~~} gamma~~} tail.\n'
  },
  {
    entry: 'shortcut',
    container: 'an Addition',
    source: 'Lead {++alpha beta gamma++} tail.\n',
    form: 'add-comment',
    expected: 'Lead {++alpha {==beta==}{>>note<<} gamma++} tail.\n'
  },
  {
    entry: 'toolbar',
    container: 'commented text',
    source: 'Lead {==alpha beta gamma==}{>>first<<} tail.\n',
    form: 'suggest-replacement',
    expected: 'Lead {==alpha {~~beta~>new~~} gamma==}{>>first<<} tail.\n'
  }
] as const

for (const { entry, container, source, form, expected } of cases) {
  test(`${form} from the ${entry} on a word inside ${container} nests in it`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
    try {
      await captureContextMenu(app)
      await selectWord(page, 'beta')
      // Every form is available for text inside another annotation.
      await expect.poll(() => menuStates(app, authoringForms)).toEqual(
        Object.fromEntries(authoringForms.map(id => [id, true])))
      switch (entry) {
        case 'toolbar':
          await expect.poll(async() => (await toolbarState(page)).review).toContain(`${form}:on`)
          await page.locator(`.mu-format-picker [data-action="${form}"]`).click()
          break
        case 'Review menu':
          await clickReviewMenu(app, form)
          break
        case 'context menu': {
          const point = await textPoint(page, 'beta', 2)
          await resetContextMenu(app)
          await page.mouse.click(point.x, point.y, { button: 'right' })
          await expect.poll(async() => (await contextMenuItems(app))?.[`critic-${form}`]).toBe(true)
          await clickContextMenu(app, `critic-${form}`)
          break
        }
        case 'shortcut':
          await nativeKey(app, 'M', ['meta', 'alt', 'shift'])
          break
      }
      if (form === 'suggest-replacement') await submit(page, 'critic-review-replacement', 'new')
      if (form === 'add-comment') await submit(page, 'critic-review-comment', 'note')
      await expectSaved(app, filePath, expected)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

const beeps = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { __reviewBeeps?: number }).__reviewBeeps ?? 0)

test('a selection crossing a suggestion leaves the forms that would cut it unavailable, and their shortcut beeps', async() => {
  const source = 'Lead {++alpha beta gamma++} tail.\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await app.evaluate(({ shell }) => {
      shell.beep = () => {
        const counter = globalThis as { __reviewBeeps?: number }
        counter.__reviewBeeps = (counter.__reviewBeeps ?? 0) + 1
      }
    })
    await drag(page, await textPoint(page, 'Lead', 1), await textPoint(page, 'beta', 'end'))
    await expect.poll(() => menuStates(app, authoringForms)).toEqual(
      Object.fromEntries(authoringForms.map(id => [id, false])))
    await nativeKey(app, 'M', ['meta', 'alt', 'shift'])
    await expect.poll(() => beeps(app)).toBe(1)
    expect(await focusInDocument(page)).toBe(true)
    await expect(composer(page, 'critic-review-comment')).toHaveCount(0)
    // The same key with the command available opens the composer, silently.
    await selectWord(page, 'beta')
    await expect.poll(() => menuStates(app, ['add-comment'])).toEqual({ 'add-comment': true })
    await nativeKey(app, 'M', ['meta', 'alt', 'shift'])
    await submit(page, 'critic-review-comment', 'note')
    expect(await beeps(app)).toBe(1)
    await expectSaved(app, filePath, 'Lead {++alpha {==beta==}{>>note<<} gamma++} tail.\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

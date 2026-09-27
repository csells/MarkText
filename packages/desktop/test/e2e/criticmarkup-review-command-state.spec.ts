import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { expectEditorWindowHidden, expectNoRendererErrors, launchWithMarkdown } from './helpers'
import {
  authoringForms,
  clickReviewMenu,
  clickText,
  drag,
  expectSaved,
  focusInDocument,
  hiddenCoreEnv as env,
  menuStates,
  nativeKey,
  openPaletteAt,
  paletteLabels,
  textPoint,
  toolbarState
} from './reviewGestures'

// Review command state must follow the document and selection it applies to,
// and Review commands behave as Google Docs' do: the comments panel opens only
// on request, Next/Previous move the caret, and Accept/Reject leave it alone.

const allOn = authoringForms.map(form => `${form}:on`)
const authoringMenu = async(app: ElectronApplication) =>
  Object.values(await menuStates(app, authoringForms)).every(Boolean)

const tripleClick = async(page: Page, text: string) => {
  const point = await textPoint(page, text, 3)
  await page.mouse.click(point.x, point.y, { clickCount: 3 })
}

const doubleClick = async(page: Page, text: string, at: number) => {
  const point = await textPoint(page, text, at)
  await page.mouse.dblclick(point.x, point.y)
}

const expectAuthoringEverywhere = async(app: ElectronApplication, page: Page) => {
  await expect.poll(() => authoringMenu(app)).toBe(true)
  await expect.poll(async() => (await toolbarState(page)).review).toEqual(allOn)
}

test('after Add Comment and ⌘Z the same selection can be commented again from the toolbar and menu', async() => {
  const source = 'First paragraph with words.\n\nSecond paragraph here.\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    for (let round = 0; round < 3; round++) {
      await tripleClick(page, 'paragraph with')
      await expectAuthoringEverywhere(app, page)
      await page.locator('.mu-format-picker [data-action="add-comment"]').click()
      await page.getByTestId('critic-review-comment-input').fill(`note ${round}`)
      await page.getByTestId('critic-review-comment-submit').click()
      await expectSaved(app, filePath, `{==First paragraph with words.==}{>>note ${round}<<}\n\nSecond paragraph here.\n`)
      await nativeKey(app, 'Z', ['meta'])
      await expectSaved(app, filePath, source)
      // The undone selection is authorable again, and the toolbar agrees with the menu.
      await expectAuthoringEverywhere(app, page)
    }
    await expectEditorWindowHidden(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('after Highlight from the Review menu and ⌘Z the toolbar is redrawn to match the menu', async() => {
  const source = 'First paragraph with words.\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    for (let round = 0; round < 2; round++) {
      await tripleClick(page, 'paragraph with')
      await expectAuthoringEverywhere(app, page)
      await clickReviewMenu(app, 'mark-highlight')
      await expectSaved(app, filePath, '{==First paragraph with words.==}\n')
      await nativeKey(app, 'Z', ['meta'])
      await expectSaved(app, filePath, source)
      await expectAuthoringEverywhere(app, page)
    }
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('a click that collapses a selection hides the review toolbar as the menu disables authoring', async() => {
  const source = 'First paragraph with words.\n\nSecond paragraph here.\n'
  const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await drag(page, await textPoint(page, 'paragraph with', 'start'), await textPoint(page, 'paragraph here', 4))
    await expectAuthoringEverywhere(app, page)
    // A drag that ends where it began collapses the selection.
    const point = await textPoint(page, 'Second', 2)
    await drag(page, point, point)
    await expect.poll(() => authoringMenu(app)).toBe(false)
    await expect.poll(async() => {
      const state = await toolbarState(page)
      return !state.visible || state.review.every(item => item.endsWith(':off'))
    }).toBe(true)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('the command palette does not run a disabled review command and returns focus after one it runs', async() => {
  const source = 'Plain text only.\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await clickText(page, 'text only', 2)
    await openPaletteAt(app, page, paletteLabels['add-comment'])
    const row = page.locator('.command-palette li').first()
    await expect(row).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('critic-review-comment-input')).toHaveCount(0)
    await expect(page.locator('.command-palette input.search')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.command-palette input.search')).toBeHidden()

    await doubleClick(page, 'text only', 1)
    await expect.poll(() => authoringMenu(app)).toBe(true)
    await openPaletteAt(app, page, paletteLabels['mark-addition'])
    await expect(page.locator('.command-palette li').first()).not.toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Enter')
    await expectSaved(app, filePath, 'Plain {++text++} only.\n')
    await expect.poll(() => focusInDocument(page)).toBe(true)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.type('!')
    await expect.poll(() => page.locator('.editor-component').innerText()).toContain('!')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

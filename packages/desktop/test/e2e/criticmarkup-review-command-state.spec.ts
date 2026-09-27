import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { clickMenuById, expectEditorWindowHidden, expectNoRendererErrors, launchWithMarkdown } from './helpers'
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
  sidebarState,
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

test('Review commands open the sidebar only to show comments or compose one', async() => {
  const source = 'Plain {++added++} text and {--gone--} more.\n\nSecond para here.\n'
  const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await clickText(page, 'Second para', 3)
    expect((await sidebarState(page)).shown).toBe(false)
    await nativeKey(app, 'E', ['meta', 'shift'])
    await expect.poll(() => app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('critic-track-changes')?.checked)).toBe(true)
    await nativeKey(app, 'E', ['meta', 'shift'])
    await nativeKey(app, ']', ['meta', 'alt'])
    await expect.poll(() => menuStates(app, ['accept'])).toEqual({ accept: true })
    await clickReviewMenu(app, 'original')
    await clickReviewMenu(app, 'markup')
    expect((await sidebarState(page)).shown).toBe(false)

    await clickReviewMenu(app, 'show')
    await expect.poll(() => sidebarState(page)).toEqual({ shown: true, active: 'Comments and Suggestions' })
    await clickMenuById(app, 'sideBarMenuItem')
    await expect.poll(async() => (await sidebarState(page)).shown).toBe(false)

    await doubleClick(page, 'para here', 1)
    await expect.poll(() => authoringMenu(app)).toBe(true)
    await clickReviewMenu(app, 'add-comment')
    await expect(page.getByTestId('critic-review-comment-input')).toBeFocused()
    expect(await sidebarState(page)).toEqual({ shown: true, active: 'Comments and Suggestions' })
    await page.getByTestId('critic-review-comment-cancel').click()
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Next and Previous put the caret at the start of the change with focus in the document', async() => {
  const source = 'Plain {++added++} text and {--gone--} more.\n\nSecond para here.\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await clickText(page, 'Second para', 3)
    await nativeKey(app, ']', ['meta', 'alt'])
    await expect.poll(() => menuStates(app, ['accept'])).toEqual({ accept: true })
    await expect.poll(() => focusInDocument(page)).toBe(true)
    await page.keyboard.type('Q')
    await expectSaved(app, filePath, 'Plain Q{++added++} text and {--gone--} more.\n\nSecond para here.\n')
    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, filePath, source)

    await clickText(page, 'Second para', 3)
    await nativeKey(app, '[', ['meta', 'alt'])
    await expect.poll(() => menuStates(app, ['accept'])).toEqual({ accept: true })
    await page.keyboard.type('R')
    await expectSaved(app, filePath, 'Plain {++added++} text and R{--gone--} more.\n\nSecond para here.\n')
    expect((await sidebarState(page)).shown).toBe(false)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('in Focus mode Next makes the change\'s block the focused block', async() => {
  const source = 'Para one here.\n\nPara two {--del--} end.\n'
  const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await clickText(page, 'one here', 2)
    await clickMenuById(app, 'focusModeMenuItem')
    const second = page.locator('.mu-container > *').nth(1)
    await expect(second).not.toHaveClass(/mu-active/)
    await nativeKey(app, ']', ['meta', 'alt'])
    await expect(second).toHaveClass(/mu-active/)
    await expect.poll(() => second.evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Accept leaves the caret where it was; Reject of the change around it places it where the change was', async() => {
  const source = 'Plain {++added++} text.\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await clickText(page, 'added', 2)
    await expect.poll(() => menuStates(app, ['accept'])).toEqual({ accept: true })
    await clickReviewMenu(app, 'accept')
    await expectSaved(app, filePath, 'Plain added text.\n')
    await expect.poll(() => focusInDocument(page)).toBe(true)
    await page.keyboard.type('Q')
    await expectSaved(app, filePath, 'Plain adQded text.\n')
    await nativeKey(app, 'Z', ['meta'])
    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, filePath, source)

    await clickText(page, 'added', 2)
    await expect.poll(() => menuStates(app, ['reject'])).toEqual({ reject: true })
    await clickReviewMenu(app, 'reject')
    await expectSaved(app, filePath, 'Plain  text.\n')
    await page.keyboard.type('Q')
    await expectSaved(app, filePath, 'Plain Q text.\n')
    expect((await sidebarState(page)).shown).toBe(false)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

const lineEnd = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'
const lineStart = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'

for (const [name, source, anchor, key, typed, expected] of [
  ['line end after a trailing addition', 'Alpha {++beta++}\n', 'Alpha', lineEnd, 'Z', 'Alpha {++beta++}Z\n'],
  ['line end after a trailing highlight', 'Alpha {==beta==}\n', 'Alpha', lineEnd, 'Z', 'Alpha {==beta==}Z\n'],
  ['line end after a trailing comment', 'Alpha {==beta==}{>>c<<}\n', 'Alpha', lineEnd, 'Z', 'Alpha {==beta==}{>>c<<}Z\n'],
  ['line start before a leading addition', '{++lead++} rest\n', 'rest', lineStart, 'Y', 'Y{++lead++} rest\n']
] as const) {
  test(`untracked typing at the ${name} stays outside it`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
    try {
      await clickText(page, anchor, 1)
      await page.keyboard.press(key)
      await page.keyboard.type(typed)
      await expectSaved(app, filePath, expected)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

test('tracked typing at the line end after a trailing addition extends that addition', async() => {
  const source = 'Alpha {++beta++}\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await clickText(page, 'Alpha', 1)
    await nativeKey(app, 'E', ['meta', 'shift'])
    await expect.poll(() => app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('critic-track-changes')?.checked)).toBe(true)
    await page.keyboard.press(lineEnd)
    await page.keyboard.type('Z')
    await expectSaved(app, filePath, 'Alpha {++betaZ++}\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

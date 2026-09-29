import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import {
  expectNoRendererErrors,
  launchWithMarkdown,
  launchWithReviewMarkdown
} from './helpers'
import {
  captureContextMenu,
  clickContextMenu,
  clickReviewMenu,
  clickText,
  contextMenuItems,
  drag,
  expectSaved,
  hiddenCoreEnv as env,
  nativeKey,
  nextFrame,
  openPaletteAt,
  paletteLabels,
  resetContextMenu,
  textPoint,
  toolbarState
} from './reviewGestures'

// Review interaction follows Google Docs (owner rule, 27 Sep): a comment can
// be added to highlighted or already commented text, its composer opens on its
// card in the Comments and Suggestions list, and text typed at the edge of
// commented text stays outside the comment (plan 0012 G16, G31, G39).

const composerInCard = (page: Page, prefix = 'critic-review-comment') =>
  page.locator(
    `[data-testid="critic-review-entry"] [data-testid="${prefix}-input"], [data-testid="critic-review-draft-entry"] [data-testid="${prefix}-input"]`
  )

const saveComment = async(page: Page, text: string, prefix = 'critic-review-comment') => {
  const input = composerInCard(page, prefix)
  await expect(input).toBeFocused()
  await page.keyboard.type(text)
  await page.keyboard.press('Meta+Enter')
  await expect(input).toHaveCount(0)
}

const rightClickText = async(app: ElectronApplication, page: Page, text: string, where: 'start' | 'end' | number) => {
  const point = await textPoint(page, text, where)
  await resetContextMenu(app)
  await page.mouse.click(point.x, point.y, { button: 'right' })
}

const caretEntries = ['Review menu', 'palette', 'shortcut', 'context menu', 'card'] as const

for (const entry of caretEntries) {
  test(`Add Comment from the ${entry} with the caret in a standalone highlight comments on it`, async() => {
    const { app, page, filePath } = await launchWithMarkdown('Alpha {==beta==} gamma\n', { suppressErrorDialog: true, env })
    try {
      await captureContextMenu(app)
      await clickText(page, 'beta', 2)
      switch (entry) {
        case 'Review menu':
          await clickReviewMenu(app, 'add-comment')
          break
        case 'palette':
          await openPaletteAt(app, page, paletteLabels['add-comment'])
          await page.keyboard.press('Enter')
          break
        case 'shortcut':
          await expect.poll(() => app.evaluate(({ Menu }) =>
            Menu.getApplicationMenu()?.getMenuItemById('critic-add-comment')?.enabled)).toBe(true)
          await nativeKey(app, 'M', ['meta', 'alt', 'shift'])
          break
        case 'context menu':
          await rightClickText(app, page, 'beta', 2)
          await expect.poll(async() => (await contextMenuItems(app))?.['critic-add-comment']).toBe(true)
          await clickContextMenu(app, 'critic-add-comment')
          break
        case 'card':
          await clickReviewMenu(app, 'show')
          await page.getByTestId('critic-review-add-comment').click()
          break
      }
      await saveComment(page, 'note')
      await expectSaved(app, filePath, 'Alpha {==beta==}{>>note<<} gamma\n')
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

test('Add Comment from the toolbar on a selection inside a standalone highlight comments on the highlight', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Alpha {==beta==} gamma\n', { suppressErrorDialog: true, env })
  try {
    await drag(page, await textPoint(page, 'beta', 1), await textPoint(page, 'beta', 3))
    await expect.poll(async() => {
      const state = await toolbarState(page)
      return state.visible && state.review.includes('add-comment:on')
    }).toBe(true)
    // Text inside a highlight takes every form (plan 0012 G15).
    await expect.poll(async() => (await toolbarState(page)).review).toContain('mark-addition:on')
    await page.locator('.mu-format-picker [data-action="add-comment"]').click()
    await saveComment(page, 'note')
    await expectSaved(app, filePath, 'Alpha {==beta==}{>>note<<} gamma\n')
  } finally {
    await app.close()
  }
})

test('a caret in a standalone highlight offers only Add Comment among the authoring commands', async() => {
  const { app, page } = await launchWithMarkdown('Alpha {==beta==} gamma\n', { suppressErrorDialog: true, env })
  try {
    await clickText(page, 'beta', 2)
    await expect.poll(() => app.evaluate(({ Menu }) => ['add-comment', 'mark-highlight', 'mark-addition', 'suggest-replacement']
      .map(id => Menu.getApplicationMenu()?.getMenuItemById(`critic-${id}`)?.enabled))).toEqual([true, false, false, false])
    await clickText(page, 'gamma', 2)
    await expect.poll(() => app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('critic-add-comment')?.enabled)).toBe(false)
  } finally {
    await app.close()
  }
})

test('a comment on part of commented text nests, and one overlapping it encloses the passage', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Alpha {==beta==}{>>n<<} gamma\n', { suppressErrorDialog: true, env })
  try {
    await drag(page, await textPoint(page, 'beta', 1), await textPoint(page, 'beta', 3))
    await clickReviewMenu(app, 'add-comment')
    await saveComment(page, 'm')
    await expectSaved(app, filePath, 'Alpha {==b{==et==}{>>m<<}a==}{>>n<<} gamma\n')

    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, filePath, 'Alpha {==beta==}{>>n<<} gamma\n')
    await drag(page, await textPoint(page, 'Alpha', 2), await textPoint(page, 'beta', 2))
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('pha be')
    await nextFrame(page)
    await clickReviewMenu(app, 'add-comment')
    await saveComment(page, 'm')
    await expectSaved(app, filePath, 'Al{==pha {==beta==}{>>n<<}==}{>>m<<} gamma\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('the context menu names the removal for the annotation under the pointer', async() => {
  const { app, page } = await launchWithMarkdown('Alpha {==beta==} and {==gamma==}{>>c<<} end\n', { suppressErrorDialog: true, env })
  try {
    await captureContextMenu(app)
    const labels = () => app.evaluate(() => (globalThis as unknown as { reviewContextLabels?: Record<string, string> }).reviewContextLabels)
    await app.evaluate(({ Menu }) => {
      const popup = Menu.prototype.popup
      Menu.prototype.popup = function(options) {
        (globalThis as unknown as { reviewContextLabels?: Record<string, string> }).reviewContextLabels = Object.fromEntries(
          this.items.filter(item => item.id?.startsWith('critic-')).map(item => [item.id, item.label])
        )
        popup.call(this, options)
      }
    })
    await rightClickText(app, page, 'beta', 2)
    await expect.poll(labels).toMatchObject({ 'critic-remove': 'Remove Highlight', 'critic-add-comment': 'Add Comment' })
    await rightClickText(app, page, 'gamma', 2)
    await expect.poll(labels).toMatchObject({ 'critic-remove': 'Remove Comment', 'critic-edit-comment': 'Edit Comment' })
  } finally {
    await app.close()
  }
})

test('Edit Comment opens the composer on its card; the other cards stay readable; Esc cancels and ⌘Enter saves', async() => {
  const { app, page, filePath } = await launchWithReviewMarkdown('{==one==}{>>first<<} and {==two==}{>>second<<}\n', { suppressErrorDialog: true, env })
  try {
    await clickText(page, 'two', 1)
    await expect(page.getByTestId('critic-review-edit-comment')).toBeEnabled()
    await page.getByTestId('critic-review-edit-comment').click()
    await expect(composerInCard(page)).toBeVisible()
    const card = page.getByTestId('critic-review-entry').filter({ has: page.getByTestId('critic-review-comment-input') })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('two')
    const other = page.getByTestId('critic-review-entry').filter({ hasText: 'first' })
    await expect(other.locator('button').first()).toBeEnabled()
    await expect(other).toBeVisible()
    await expect(other).toHaveCSS('opacity', '1')
    await expect(composerInCard(page)).toBeFocused()
    await page.keyboard.type(' more')
    await page.keyboard.press('Escape')
    await expect(composerInCard(page)).toHaveCount(0)
    await expectSaved(app, filePath, '{==one==}{>>first<<} and {==two==}{>>second<<}\n')

    await expect(page.getByTestId('critic-review-edit-comment')).toBeEnabled()
    await page.getByTestId('critic-review-edit-comment').click()
    await expect(composerInCard(page)).toBeFocused()
    await page.keyboard.press('Meta+A')
    await saveComment(page, 'changed')
    await expectSaved(app, filePath, '{==one==}{>>first<<} and {==two==}{>>changed<<}\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

for (const [form, prefix, typed, expected] of [
  ['add-comment', 'critic-review-comment', 'note', 'Alpha {++one++} {==middle==}{>>note<<} {++two++} end\n'],
  ['suggest-replacement', 'critic-review-replacement', 'center', 'Alpha {++one++} {~~middle~>center~~} {++two++} end\n']
] as const) {
  test(`${form} on a new selection opens a draft card in document order`, async() => {
    const source = 'Alpha {++one++} middle {++two++} end\n'
    const { app, page, filePath } = await launchWithReviewMarkdown(source, { suppressErrorDialog: true, env })
    try {
      await drag(page, await textPoint(page, 'middle', 'start'), await textPoint(page, 'middle', 'end'))
      await clickReviewMenu(app, form)
      const draft = page.getByTestId('critic-review-draft-entry')
      await expect(draft.getByTestId(`${prefix}-input`)).toBeFocused()
      const order = await page.locator('.core-review-list > li').evaluateAll(items =>
        items.map(item => item.getAttribute('data-testid') === 'critic-review-draft-entry' ? 'draft' : item.textContent?.includes('one') ? 'one' : 'two'))
      expect(order).toEqual(['one', 'draft', 'two'])
      await page.keyboard.press('Escape')
      await expect(draft).toHaveCount(0)
      await expectSaved(app, filePath, source)

      await drag(page, await textPoint(page, 'middle', 'start'), await textPoint(page, 'middle', 'end'))
      await clickReviewMenu(app, form)
      await saveComment(page, typed, prefix)
      await expectSaved(app, filePath, expected)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

for (const [where, typed, expected] of [
  ['end', 'Z', 'Alpha {==beta==}{>>n<<}Z gamma\n'],
  [2, 'Z', 'Alpha {==beZta==}{>>n<<} gamma\n']
] as const) {
  test(`typing at ${where} of commented text follows Google Docs`, async() => {
    const { app, page, filePath } = await launchWithMarkdown('Alpha {==beta==}{>>n<<} gamma\n', { suppressErrorDialog: true, env })
    try {
      await clickText(page, 'beta', where)
      await page.keyboard.type(typed)
      await expectSaved(app, filePath, expected)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

test('tracked typing at the end of commented text becomes an addition after the comment', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Alpha {==beta==}{>>n<<} gamma\n', { suppressErrorDialog: true, env })
  try {
    await clickText(page, 'beta', 'end')
    await nativeKey(app, 'E', ['meta', 'shift'])
    await expect.poll(() => app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('critic-track-changes')?.checked)).toBe(true)
    await page.keyboard.type('Z')
    await expectSaved(app, filePath, 'Alpha {==beta==}{>>n<<}{++Z++} gamma\n')
  } finally {
    await app.close()
  }
})

test('rejecting the only text of commented text leaves a standalone comment', async() => {
  const { app, page, filePath } = await launchWithMarkdown('x {=={++new++}==}{>>n<<} y\n', { suppressErrorDialog: true, env })
  try {
    await captureContextMenu(app)
    await rightClickText(app, page, 'new', 1)
    await expect.poll(async() => (await contextMenuItems(app))?.['critic-reject']).toBe(true)
    await clickContextMenu(app, 'critic-reject')
    await expectSaved(app, filePath, 'x {>>n<<} y\n')
    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, filePath, 'x {=={++new++}==}{>>n<<} y\n')
  } finally {
    await app.close()
  }
})

test('authoring that needs MarkText-only escaping says so for every form', async() => {
  const { app, page, filePath } = await launchWithMarkdown('x ==} y\n\nseed\n', { suppressErrorDialog: true, env })
  try {
    const notice = page.locator('.mt-notification').filter({ hasText: 'MarkText escaped CriticMarkup-like text with backslashes' })
    await clickText(page, 'x ==}', 1)
    await page.keyboard.press('Meta+ArrowLeft')
    await page.keyboard.press('Shift+Meta+ArrowRight')
    await clickReviewMenu(app, 'mark-highlight')
    await expectSaved(app, filePath, '{==x \\==} y==}\n\nseed\n')
    await expect(notice).toHaveCount(1)

    await drag(page, await textPoint(page, 'seed', 'start'), await textPoint(page, 'seed', 'end'))
    await clickReviewMenu(app, 'suggest-replacement')
    await saveComment(page, 'a ~~} b', 'critic-review-replacement')
    await expectSaved(app, filePath, '{==x \\==} y==}\n\n{~~seed~>a \\~~} b~~}\n')
    await expect(notice).toHaveCount(2)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

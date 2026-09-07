import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { clickMenuById, expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

const source = '# Review\n\nAn {++addition++}, a {--deletion--}, and {~~before~>after~~}.\n\n{==Highlighted text.==}{>>A margin comment.<<}\n\nA standalone comment.{>>Another margin comment.<<}\n\n{==Uncommented highlight==}\n'

test('Comments and Suggestions shares the existing sidebar with Files, Search and TOC', async() => {
  const { app, page } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    const sidebar = page.locator('.side-bar')
    if (!await sidebar.isVisible()) await clickMenuById(app, 'sideBarMenuItem')
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByRole('tab', { name: 'Comments and Suggestions', exact: true })).toBeVisible()
    await sidebar.getByRole('tab', { name: 'Comments and Suggestions', exact: true }).click()
    const list = sidebar.getByTestId('critic-review-list')
    await expect(list.getByTestId('critic-review-entry')).toHaveCount(6)
    for (const text of ['addition', 'deletion', 'before', 'after', 'Uncommented highlight', 'A margin comment.', 'Another margin comment.']) {
      await expect(list).toContainText(text)
    }
    await expect(page.locator('.core-review-margin')).toHaveCount(0)
    const panel = page.locator('#core-review-panel')
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    const panelBounds = await panel.boundingBox()
    const editorBounds = await page.locator('.editor-surface').boundingBox()
    expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(editorBounds!.x)
    await sidebar.getByRole('tab', { name: 'Table of Contents', exact: true }).click()
    await expect(panel).toBeHidden()
    await sidebar.getByRole('tab', { name: 'Comments and Suggestions', exact: true }).click()
    await expect(list).toBeVisible()
    await list.getByTestId('critic-review-entry').filter({ hasText: 'Uncommented highlight' }).locator(':scope > button').click()
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'highlight')
    await expect(page.locator('.core-review-current-block')).toHaveText('Uncommented highlight')
    await page.screenshot({ path: test.info().outputPath('comments-suggestions-sidebar.png') })
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('Original and Revised replace the visible editor and preserve the editable document', async() => {
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    for (const mode of ['original', 'revised'] as const) {
      await page.getByTestId(`critic-review-${mode}`).click()
      const projection = page.locator(`[data-projection="${mode}"]`)
      await expect(projection).toBeVisible()
      await page.screenshot({ path: test.info().outputPath(`${mode}.png`) })
      await expect(page.locator('.editor-component')).toBeHidden()
      await expect(projection).toContainText(mode === 'original' ? 'before' : 'after')
      await expect(projection).not.toContainText('margin comment')
    }
    await page.getByTestId('critic-review-markup').click()
    await expect(page.locator('.editor-component')).toBeVisible()
    await expect(page.locator('.core-document-projection[data-projection="original"], .core-document-projection[data-projection="revised"]')).toHaveCount(0)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('Suggest Replacement uses a real composer without freezing the document into recovery', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Replace this wording.\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    const paragraph = page.locator('.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    // Use the actual installed platform behavior; never replace window.prompt.
    await page.getByTestId('critic-review-track-replacement').click()
    const input = page.getByTestId('critic-review-replacement-input')
    await expect(input).toBeVisible()
    await input.fill('Better wording.')
    await page.getByTestId('critic-review-replacement-submit').click()
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('{~~Replace this wording.~>Better wording.~~}\n')
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('sidebar comments open their own editor and Review navigation reveals the current suggestion', async() => {
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true, env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    const card = page.getByTestId('critic-review-entry').filter({ hasText: 'Another margin comment.' })
    await card.locator(':scope > button').click()
    await page.getByTestId('critic-review-edit-comment').click()
    const input = page.getByTestId('critic-review-comment-input')
    await expect(input).toHaveValue('Another margin comment.')
    await input.fill('Edited **margin** note.')
    await page.getByTestId('critic-review-comment-submit').click()
    await expect(page.getByTestId('critic-review-entry').filter({ hasText: 'Edited margin note.' })).toBeVisible()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source.replace('Another margin comment.', 'Edited **margin** note.'))
    await page.getByTestId('critic-review-next').click()
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'highlight')
    await page.getByTestId('critic-review-next').click()
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'addition')
    await expect(page.locator('.core-review-current-block')).toHaveText('addition')
    await expect(page.locator('.core-review-current-block')).toHaveCSS('outline-style', 'solid')
    await page.getByTestId('critic-review-accept').click()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source.replace('Another margin comment.', 'Edited **margin** note.').replace('{++addition++}', 'addition'))
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source.replace('Another margin comment.', 'Edited **margin** note.'))
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('the native Format menu adds a comment through the same selection and history as the sidebar', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Selected passage.\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.locator('.mu-paragraph-content').first().click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    const commentEnabled = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('critic-add-comment')?.enabled)
    await expect.poll(commentEnabled).toBe(true)
    await clickMenuById(app, 'dracula')
    await expect(page.locator('body')).toHaveClass(/(^|\s)dark(\s|$)/)
    await expect.poll(commentEnabled).toBe(true)
    await clickMenuById(app, 'critic-add-comment')
    await expect(page.locator('.side-bar')).toBeVisible()
    await expect(page.getByTestId('critic-review-comment-input')).toBeVisible()
    await page.getByTestId('critic-review-comment-input').fill('Native comment.')
    await page.getByTestId('critic-review-comment-submit').click()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('{==Selected passage.==}{>>Native comment.<<}\n')
    await expect(page.getByTestId('critic-review-list')).toContainText('Native comment.')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('Selected passage.\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('{==Selected passage.==}{>>Native comment.<<}\n')
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

const source = '# Review\n\nAn {++addition++}, a {--deletion--}, and {~~before~>after~~}.\n\n{==Highlighted text.==}{>>A margin comment.<<}\n\nA standalone comment.{>>Another margin comment.<<}\n'

test('Review opens in the existing left sidebar while comments remain visible beside their text', async() => {
  const { app, page } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    const sidebar = page.locator('.side-bar')
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByTestId('critic-review-track-changes')).toBeVisible()
    await expect(sidebar.getByTestId('critic-review-next')).toBeVisible()
    const panel = page.locator('#core-review-panel')
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await expect(page.getByText('A margin comment.', { exact: true })).toBeVisible()
    await expect(page.getByText('Another margin comment.', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('review-sidebar-and-comments.png') })
  } finally { await app.close() }
})

test('opening an annotated document exposes both standalone and highlighted comment bodies', async() => {
  const { app, page } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await expect(page.getByText('A margin comment.', { exact: true })).toBeVisible()
    await expect(page.getByText('Another margin comment.', { exact: true })).toBeVisible()
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

test('margin comments open their own editor and Review navigation reveals the current suggestion', async() => {
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true, env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    const card = page.getByTestId('critic-margin-comment').filter({ hasText: 'Another margin comment.' })
    await card.getByRole('button', { name: 'Edit comment' }).click()
    const input = page.getByTestId('critic-review-comment-input')
    await expect(input).toHaveValue('Another margin comment.')
    await input.fill('Edited **margin** note.')
    await page.getByTestId('critic-review-comment-submit').click()
    await expect(page.getByTestId('critic-margin-comment').filter({ hasText: 'Edited margin note.' })).toBeVisible()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source.replace('Another margin comment.', 'Edited **margin** note.'))
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

import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

const source = 'An {++addition++} and a {--deletion--}.\n'

test('reader projections retain review decisions consistently and navigation reveals the next editable target', async() => {
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    for (const mode of ['original', 'revised']) {
      await page.getByTestId(`critic-review-${mode}`).click()
      await expect(page.getByTestId('critic-review-accept')).toBeEnabled()
      await expect.poll(() => app.evaluate(({ Menu }, selected) => {
        const menu = Menu.getApplicationMenu()
        return { selected: menu?.getMenuItemById(`critic-${selected}`)?.checked, accept: menu?.getMenuItemById('critic-accept')?.enabled }
      }, mode)).toEqual({ selected: true, accept: true })
      await expect(page.getByTestId('critic-review-reject')).toBeEnabled()
      await expect(page.getByTestId('critic-review-accept-all')).toBeEnabled()
      await page.getByTestId('critic-review-next').click()
      await expect(page.getByTestId('critic-review-markup')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.core-review-current-block')).toBeVisible()
      await expect(page.getByTestId('critic-review-accept')).toBeEnabled()
    }
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('clicking a document annotation selects its sidebar entry without moving the caret', async() => {
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.locator('[data-critic-kind="deletion"]').click()
    await expect(page.getByTestId('critic-review-entry').filter({ hasText: 'deletion' }).locator(':scope > button')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'deletion')
    const caret = await page.evaluate(() => {
      const selection = window.getSelection()
      return { text: selection?.anchorNode?.textContent, offset: selection?.anchorOffset }
    })
    expect(caret.text).toBe('deletion')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('standalone comment marker opens its entry and preserves editing and save', async() => {
  const original = 'Keep this.{>>A hidden note.<<}\n'
  const { app, page, filePath } = await launchWithMarkdown(original, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    const paragraph = page.locator('.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('Home')
    const marker = paragraph.getByRole('button', { name: 'Comment', exact: true })
    await expect(marker).toBeVisible()
    await marker.click()
    await expect(page.getByTestId('critic-review-entry').filter({ hasText: 'A hidden note.' })).toHaveClass(/active/)
    await expect(paragraph).toHaveText('Keep this.')
    await page.keyboard.type('Safe ')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('Safe Keep this.{>>A hidden note.<<}\n')
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('sidebar presents each comment once with actions beside the selected entry', async() => {
  const { app, page } = await launchWithMarkdown('Text.{>>One readable note.<<}\n\n{++Suggested wording++}\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    const panel = page.locator('#core-review-panel')
    await expect(panel.getByText('One readable note.', { exact: true })).toHaveCount(1)
    const entry = page.getByTestId('critic-review-entry').filter({ hasText: 'One readable note.' })
    await expect(entry.getByTestId('critic-review-edit-comment')).toBeVisible()
    await page.getByTestId('critic-review-next').click()
    await expect(page.getByTestId('critic-review-entry').filter({ hasText: 'Suggested wording' }).getByTestId('critic-review-accept')).toBeVisible()
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('native-sidebar.png') })
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('comment marker supports keyboard activation without inserting a paragraph', async() => {
  const original = 'Text.{>>Keyboard note.<<} More.\n'
  const { app, page, filePath } = await launchWithMarkdown(original, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    const marker = page.locator('.mu-critic-comment-marker')
    await page.locator('.mu-paragraph-content').first().click()
    await page.keyboard.press('Home')
    await marker.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('critic-review-entry').filter({ hasText: 'Keyboard note.' })).toHaveClass(/active/)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(original)
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('view controls preserve an open comment draft and match native command availability', async() => {
  const { app, page } = await launchWithMarkdown('Text.{>>Note.<<}\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    await page.getByTestId('critic-review-edit-comment').click()
    await page.getByTestId('critic-review-comment-input').fill('Unsubmitted draft.')
    await expect(page.getByTestId('critic-review-original')).toBeDisabled()
    await expect(page.getByTestId('critic-review-revised')).toBeDisabled()
    await expect(page.getByTestId('critic-review-comment-input')).toHaveValue('Unsubmitted draft.')
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

test('keyboard caret navigation updates the review target before accepting a suggestion', async() => {
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.locator('[data-critic-kind="addition"]').click()
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'addition')
    await page.keyboard.press('Home')
    for (let index = 0; index < 20; index++) await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'deletion')
    await page.getByTestId('critic-review-accept').click()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('An {++addition++} and a .\n')
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

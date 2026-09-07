import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown as launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

test('keeps the same paragraph editable while writing a tracked sentence', async() => {
  const { app, page, filePath } = await launchWithMarkdown('seed\n', {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    const paragraph = page.locator('span.mu-paragraph-content').first()
    await expect(paragraph).toHaveAttribute('contenteditable', 'true')
    await page.getByTestId('critic-review-track-changes').click()
    await paragraph.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' A')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await expect(paragraph).toHaveAttribute('contenteditable', 'true')
    await page.keyboard.type(' complete sentence.')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await expect(paragraph).toHaveText('seed A complete sentence.')
    await expect(paragraph.locator('[data-critic-kind="addition"]')).toHaveText(
      ' A complete sentence.'
    )
    await page.keyboard.press('Backspace')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await expect(paragraph).toHaveText('seed A complete sentence')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(
      'seed{++ A complete sentence++}\n'
    )
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('continues native editing after splitting a paragraph', async() => {
  const { app, page, filePath } = await launchWithMarkdown('seed\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await page.locator('span.mu-paragraph-content').first().click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('next')
    await expect(page.locator('span.mu-paragraph-content').last()).toHaveText('next')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('seed\n\nnext\n')
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('authors and edits a multiline comment without a blocking prompt', async() => {
  const { app, page, filePath } = await launchWithMarkdown('seed\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    const paragraph = page.locator('span.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await page.getByTestId('critic-review-add-comment').click()
    const input = page.getByTestId('critic-review-comment-input')
    await expect(input).toBeVisible()
    await input.fill('First **note**.\n\nSecond paragraph.')
    await page.screenshot({ path: test.info().outputPath('comment-composer.png') })
    await page.getByTestId('critic-review-comment-submit').click()
    await expect(input).not.toBeVisible()
    await expect(paragraph).toHaveText('seed')
    await page.screenshot({ path: test.info().outputPath('comment-review.png') })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(
      '{==seed==}{>>First **note**.\n\nSecond paragraph.<<}\n'
    )
    await page.getByTestId('critic-review-edit-comment').click()
    await expect(input).toHaveValue('First **note**.\n\nSecond paragraph.')
    await input.fill('Revised note.')
    await page.getByTestId('critic-review-comment-submit').click()
    await expect(input).not.toBeVisible()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(
      '{==seed==}{>>Revised note.<<}\n'
    )
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('switches between read-only Original and Revised without changing saved source', async() => {
  const source = 'A {++new++} {--old--} {~~before~>after~~}\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await page.getByTestId('critic-review-original').click()
    await expect(page.locator('[data-projection="original"]')).toHaveText('A old before')
    await expect(page.locator('[data-projection="original"]')).toHaveAttribute('contenteditable', 'false')
    await page.getByTestId('critic-review-revised').click()
    await expect(page.locator('[data-projection="revised"]')).toHaveText('A new after')
    await page.getByTestId('critic-review-markup').click()
    await expect(page.locator('span.mu-paragraph-content').first()).toBeVisible()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('deletes across an addition boundary and keeps editing its surviving text', async() => {
  const { app, page, filePath } = await launchWithMarkdown('a{++bc++}d\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    const paragraph = page.locator('span.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Shift+End')
    await page.keyboard.press('Backspace')
    await expect(paragraph).toHaveText('ab')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('a{++b++}\n')
    await paragraph.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await expect(paragraph).toHaveText('ab!')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('a{++b!++}\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('refreshes a read-only projection after accepting a suggestion', async() => {
  const { app, page } = await launchWithMarkdown('A {++new++}\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await page.getByTestId('critic-review-original').click()
    await expect(page.locator('[data-projection="original"]')).toHaveText('A')
    await page.getByTestId('critic-review-accept').click()
    await expect(page.locator('[data-projection="original"]')).toHaveText('A new')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('formats an existing addition without accepting it', async() => {
  const { app, page, filePath } = await launchWithMarkdown('{++added++}\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_MODE: '1', MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    const paragraph = page.locator('span.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await page.keyboard.press('ControlOrMeta+b')
    await expect(paragraph.locator('strong')).toHaveText('added')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('{++**added**++}\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

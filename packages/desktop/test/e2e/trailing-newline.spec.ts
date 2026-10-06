import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  enterSourceMode,
  exitSourceMode,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'
import { textPoint } from './reviewGestures'

// Upstream MarkText detects each file's trailing-newline mode when it opens
// (one final newline: "Ensure single newline"; none: "Trim all trailing
// newlines") and writes a saved file's end that way; the command palette's
// "Trailing Newline" command changes the mode for the next save.

const env = { MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined, MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
const command = (key: string) => `${process.platform === 'darwin' ? 'Meta' : 'Control'}+${key}`

const save = async(app: ElectronApplication, filePath: string, expected: string): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
}

const typeAtEndOf = async(page: Page, text: string, typed: string): Promise<void> => {
  const point = await textPoint(page, text, 'end')
  await page.mouse.click(point.x, point.y)
  await page.keyboard.type(typed)
}

test('Source view text typed after the last line ends with one newline, as upstream saves it', async() => {
  const source = 'Alpha beta gamma.\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await enterSourceMode(page, app)
    await page.locator('.source-code .CodeMirror').click()
    await page.keyboard.press(command('ArrowDown'))
    await page.keyboard.press('Enter')
    await page.keyboard.type('Source line.')
    await exitSourceMode(page, app)
    await save(app, filePath, 'Alpha beta gamma.\n\nSource line.\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Return at the end of Source view, then saving there, writes one newline', async() => {
  const source = 'Alpha beta gamma.\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await enterSourceMode(page, app)
    await page.locator('.source-code .CodeMirror').click()
    await page.keyboard.press(command('ArrowDown'))
    await page.keyboard.press('Enter')
    await save(app, filePath, source)
    // Typing continues in the saved document.
    await page.keyboard.type('More.')
    await save(app, filePath, 'Alpha beta gamma.\nMore.\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('a file without a final newline keeps none after an edit', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Alpha beta gamma.', { suppressErrorDialog: true, env })
  try {
    await typeAtEndOf(page, 'gamma.', ' Delta.')
    await save(app, filePath, 'Alpha beta gamma. Delta.')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('an unedited save keeps the file\'s bytes whatever its final newlines', async() => {
  for (const source of ['Alpha.\n', 'Alpha.', 'Alpha.\n\n\n']) {
    const { app, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
    try {
      await save(app, filePath, source)
    } finally {
      await app.close()
    }
  }
})

test('the command palette\'s Trailing Newline choice applies at the next save', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Alpha beta gamma.\n', { suppressErrorDialog: true, env })
  try {
    await sendIpcToRenderer(app, 'mt::show-command-palette')
    const search = page.locator('.search-wrapper input.search, input.search').first()
    await expect(search).toBeVisible()
    await search.fill('Trailing Newline')
    await page.keyboard.press('Enter')
    await search.fill('Trim all trailing newlines')
    await page.keyboard.press('Enter')
    await expect(search).toBeHidden()

    await save(app, filePath, 'Alpha beta gamma.')
    await typeAtEndOf(page, 'gamma.', ' Delta.')
    await save(app, filePath, 'Alpha beta gamma. Delta.')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  enterSourceMode,
  exitSourceMode,
  expectNoRendererErrors,
  launchWithMarkdown,
  launchWithReviewMarkdown,
  sendIpcToRenderer
} from './helpers'
import { openPaletteAt, textPoint } from './reviewGestures'

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
    // The file already held these bytes, so wait for the save to drop the
    // typed line break from the view before typing on.
    await expect.poll(() => page.evaluate(() => (document.querySelector('.source-code .CodeMirror') as Element & {
      CodeMirror: { getValue(): string }
    }).CodeMirror.getValue())).toBe(source)
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

const chooseTrailingNewline = async(app: ElectronApplication, page: Page, choice: string): Promise<void> => {
  await openPaletteAt(app, page, 'Trailing Newline')
  await page.keyboard.press('Enter')
  const options = page.locator('.command-palette li')
  await expect(options.first()).toContainText('Trim all trailing newlines')
  await page.locator('.command-palette input.search').pressSequentially(choice)
  await expect(options).toHaveCount(1)
  await expect(options.first()).toContainText(choice)
  await page.keyboard.press('Enter')
  await expect(page.locator('.command-palette input.search')).toBeHidden()
}

test('the command palette\'s Trailing Newline choice applies at the next save', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Alpha beta gamma.\n', { suppressErrorDialog: true, env })
  try {
    await chooseTrailingNewline(app, page, 'Trim all')
    await save(app, filePath, 'Alpha beta gamma.')
    await typeAtEndOf(page, 'gamma.', ' Delta.')
    await save(app, filePath, 'Alpha beta gamma. Delta.')
    await chooseTrailingNewline(app, page, 'Ensure single')
    await save(app, filePath, 'Alpha beta gamma. Delta.\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('undo after a save that wrote the final newline reverts the last edit, not the newline', async() => {
  const source = 'Alpha beta gamma.\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await enterSourceMode(page, app)
    await page.locator('.source-code .CodeMirror').click()
    await page.keyboard.press(command('ArrowDown'))
    await page.keyboard.press('Enter')
    await page.keyboard.type('Source line.')
    await save(app, filePath, 'Alpha beta gamma.\n\nSource line.\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await save(app, filePath, source)
    await exitSourceMode(page, app)
    await save(app, filePath, source)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('a CRLF file keeps CRLF line breaks, its final one included', async() => {
  const { app, page, filePath } = await launchWithMarkdown('Alpha beta gamma.\r\n', { suppressErrorDialog: true, env })
  try {
    await enterSourceMode(page, app)
    await page.locator('.source-code .CodeMirror').click()
    await page.keyboard.press(command('ArrowDown'))
    await page.keyboard.press('Enter')
    await page.keyboard.type('Source line.')
    await exitSourceMode(page, app)
    await save(app, filePath, 'Alpha beta gamma.\r\n\r\nSource line.\r\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

// The final newline is the file's form, not a suggestion: a tracked edit saves
// with the same end, so Accept All gives the untracked edit's bytes.
for (const decision of [
  { name: 'Accept All', testId: 'critic-review-accept-all', expected: 'Alpha beta gamma. Delta.' },
  { name: 'Reject All', testId: 'critic-review-reject-all', expected: 'Alpha beta gamma.' }
]) {
  test(`a tracked edit saves in the file's trailing-newline mode; ${decision.name} keeps it`, async() => {
    const { app, page, filePath } = await launchWithReviewMarkdown('Alpha beta gamma.\n', { suppressErrorDialog: true, env })
    try {
      await page.getByTestId('critic-review-track-changes').click()
      await chooseTrailingNewline(app, page, 'Trim all')
      await typeAtEndOf(page, 'gamma.', ' Delta.')
      await save(app, filePath, 'Alpha beta gamma.{++ Delta.++}')
      await page.getByTestId('critic-review-entry').first().locator(':scope > button').click()
      await page.getByTestId(decision.testId).click()
      await save(app, filePath, decision.expected)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

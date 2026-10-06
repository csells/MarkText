import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  launchWithReviewMarkdown,
  sendIpcToRenderer
} from './helpers'

// Preferences › Editor › Remove empty lines (upstream's
// trimUnnecessaryCodeBlockEmptyLines), edit-scoped: typing in a code block
// also trims that block's leading and trailing empty lines in the same edit;
// other blocks and saves keep their bytes.

const source = '# Trim\n\n```js\n\n\nalpha\n\n```\n\n```\n\nkeep\n\n```\n'
const trimmed = '# Trim\n\n```js\nalphaX\n```\n\n```\n\nkeep\n\n```\n'
const typedOnly = '# Trim\n\n```js\n\n\nalphaX\n\n```\n\n```\n\nkeep\n\n```\n'

const launch = () => launchWithMarkdown(source, {
  suppressErrorDialog: true,
  env: { MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined, MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
})

/** Puts the caret after `text` in the first code block. */
const caretAfter = async(page: Page, text: string): Promise<void> => {
  const point = await page.locator('.mu-codeblock-content').first().evaluate((element, target) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(target) ?? -1
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at + target.length - 1)
      range.setEnd(node, at + target.length)
      const rect = range.getBoundingClientRect()
      return { x: rect.left + 1, y: rect.top + rect.height / 2 }
    }
    return undefined
  }, text)
  if (point === undefined) throw new Error(`No ${text} to click`)
  // A click before the text's last character, then a step past it.
  await page.mouse.click(point.x, point.y)
  await page.keyboard.press('ArrowRight')
}

const typeAfter = async(page: Page, text: string, key: string): Promise<void> => {
  await caretAfter(page, text)
  await page.keyboard.type(key)
}

const command = (key: string) => `${process.platform === 'darwin' ? 'Meta' : 'Control'}+${key}`

const save = async(app: ElectronApplication, filePath: string, expected: string): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
}

const openEditorPreferences = async(app: ElectronApplication): Promise<Page> => {
  const settingsWindow = app.waitForEvent('window')
  await app.evaluate(({ ipcMain }) => {
    ipcMain.emit('app-create-settings-window')
  })
  const settings = await settingsWindow
  await settings.waitForSelector('.pref-container', { timeout: 15000 })
  await settings.evaluate(() => {
    location.hash = '#/preference/editor'
  })
  return settings
}

const removeEmptyLinesSwitch = (settings: Page) =>
  settings.locator('.pref-switch-item', { hasText: 'Remove empty lines' }).locator('.el-switch')

test('an unedited save keeps the code blocks\' empty lines', async() => {
  const { app, filePath } = await launch()
  try {
    await save(app, filePath, source)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('typing in a code block trims only that block, in one undoable edit', async() => {
  const { app, page, filePath } = await launch()
  try {
    await typeAfter(page, 'alpha', 'X')
    await save(app, filePath, trimmed)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await save(app, filePath, source)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await save(app, filePath, trimmed)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('pasting and cutting in a code block trim it in one undoable edit', async() => {
  const { app, page, filePath } = await launch()
  try {
    await caretAfter(page, 'alpha')
    await app.evaluate(({ clipboard }) => clipboard.writeText('ZZ'))
    await page.keyboard.press(command('V'))
    await save(app, filePath, trimmed.replace('alphaX', 'alphaZZ'))
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await save(app, filePath, source)

    await caretAfter(page, 'alpha')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press(command('X'))
    await save(app, filePath, trimmed.replace('alphaX', 'alp'))
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('ha')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await save(app, filePath, source)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('turning the preference off in Preferences writes only the typed text', async() => {
  const { app, page, filePath } = await launch()
  try {
    const settings = await openEditorPreferences(app)
    const toggle = removeEmptyLinesSwitch(settings)
    await expect(toggle).toHaveClass(/is-checked/)
    await toggle.click()
    await expect(toggle).not.toHaveClass(/is-checked/)
    await settings.close()

    await typeAfter(page, 'alpha', 'X')
    await save(app, filePath, typedOnly)

    const again = await openEditorPreferences(app)
    await removeEmptyLinesSwitch(again).click()
    await expect(removeEmptyLinesSwitch(again)).toHaveClass(/is-checked/)
    await again.close()
    await typeAfter(page, 'alphaX', 'Y')
    await save(app, filePath, trimmed.replace('alphaX', 'alphaXY'))
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

// With Track Changes on the trim is part of the suggestion: accepting it gives
// the untracked edit's bytes, rejecting it the original block.
const tracked = [
  { name: 'typing', act: async(page: Page) => typeAfter(page, 'alpha', 'X'), accepted: trimmed },
  {
    name: 'a paste',
    act: async(page: Page, app: ElectronApplication) => {
      await caretAfter(page, 'alpha')
      await app.evaluate(({ clipboard }) => clipboard.writeText('ZZ'))
      await page.keyboard.press(command('V'))
    },
    accepted: trimmed.replace('alphaX', 'alphaZZ')
  },
  {
    name: 'a cut',
    act: async(page: Page) => {
      await caretAfter(page, 'alpha')
      await page.keyboard.press('Shift+ArrowLeft')
      await page.keyboard.press('Shift+ArrowLeft')
      await page.keyboard.press(command('X'))
    },
    accepted: trimmed.replace('alphaX', 'alp')
  }
]
for (const edit of tracked) {
  for (const decision of [
    { name: 'Accept All', testId: 'critic-review-accept-all', expected: edit.accepted },
    { name: 'Reject All', testId: 'critic-review-reject-all', expected: source }
  ]) {
    test(`tracked ${edit.name} in a code block suggests the trim; ${decision.name} gives the ${decision.name === 'Accept All' ? 'untracked' : 'original'} bytes`, async() => {
      const { app, page, filePath } = await launchWithReviewMarkdown(source, {
        suppressErrorDialog: true,
        env: { MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined, MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
      })
      try {
        await page.getByTestId('critic-review-track-changes').click()
        await edit.act(page, app)
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('{~~```js\n\n\nalpha\n\n```\n~>')
        const suggested = readFileSync(filePath, 'utf8')
        await page.getByTestId('critic-review-entry').first().locator(':scope > button').click()
        await page.getByTestId(decision.testId).click()
        await save(app, filePath, decision.expected)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await save(app, filePath, suggested)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await save(app, filePath, source)
        await expectNoRendererErrors(app)
      } finally {
        await app.close()
      }
    })
  }
}

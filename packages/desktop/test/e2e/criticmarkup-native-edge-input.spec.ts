import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { LEGACY_MARKDOWN_REACH_PREFIX } from '../../src/shared/legacyMarkdownReach'
import {
  LEGACY_MARKDOWN_LOG_ENV,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

// B9 item 1: native input at the edges of Muya's own text handling still
// reaches the bound document, with real mouse and keyboard gestures. A press
// held in a table cell selects no cells, so typing and Backspace there are
// ordinary edits; an insertion that states no text edits nothing.
//
// A native spelling correction (insertReplacementText) cannot be produced in
// the hidden-window harness: the window never holds a focused frame
// (webContents.isFocused() stays false even after webContents.focus()), so
// Electron's webContents.replaceMisspelling() is a no-op even on a plain
// contenteditable that Chromium has marked, and Chromium never marks Muya's
// model-rendered text there. A visible window would take the user's focus.
// muya/src/editor/__tests__/unclaimedNativeInput.spec.ts covers it instead.

const options = {
  suppressErrorDialog: true,
  env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
}

const settle = (page: Page) => page.evaluate(() => window.__marktextDocumentCore?.settled())

const save = async(app: ElectronApplication, page: Page, filePath: string): Promise<string> => {
  await settle(page)
  const before = readFileSync(filePath, 'utf8')
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  // A save whose bytes match the file leaves no visible change to wait for.
  await expect.poll(() => page.evaluate(() => window.__marktextDocumentCore?.authoritySource?.())).toBeDefined()
  const source = await page.evaluate(() => window.__marktextDocumentCore!.authoritySource!())
  if (source !== before) await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
  return readFileSync(filePath, 'utf8')
}

const undo = async(app: ElectronApplication, page: Page): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
  await settle(page)
}

/** Records every beforeinput the page sees; the flags are read after dispatch. */
const recordBeforeInput = (page: Page) =>
  page.evaluate(() => {
    const events: InputEvent[] = []
    window.addEventListener('beforeinput', (event) => events.push(event as InputEvent), true)
    ;(window as unknown as { __edgeInputs: () => unknown[] }).__edgeInputs = () =>
      events.map((event) => ({
        inputType: event.inputType,
        data: event.data,
        transfer: event.dataTransfer?.getData('text/plain') ?? null,
        prevented: event.defaultPrevented
      }))
  })

interface RecordedInput {
  inputType: string
  data: string | null
  transfer: string | null
  prevented: boolean
}

const recordedInputs = (page: Page): Promise<RecordedInput[]> =>
  page.evaluate(() => (window as unknown as { __edgeInputs: () => RecordedInput[] }).__edgeInputs())

/** The viewport point just right of the last character of a table cell's text. */
const cellTextEnd = (page: Page, text: string) =>
  page.evaluate((text) => {
    const cell = [...document.querySelectorAll('.editor-component td, .editor-component th')]
      .find((candidate) => candidate.textContent === text)
    const walker = document.createTreeWalker(cell!, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode() as Text
    const range = document.createRange()
    range.setStart(node, node.length - 1)
    range.setEnd(node, node.length)
    const rect = range.getBoundingClientRect()
    return { x: rect.right - 1, y: rect.top + rect.height / 2 }
  }, text)

const cellTexts = (page: Page) =>
  page.locator('.editor-component td').evaluateAll((cells) => cells.map((cell) => cell.textContent))

for (const gesture of [
  { name: 'typing', key: 'x', edited: 'cellx' },
  { name: 'Backspace', key: 'Backspace', edited: 'cel' }
] as const) {
  test(`${gesture.name} in a table cell with the mouse button held edits the cell as without it`, async() => {
    const source = '| a | b |\n| --- | --- |\n| cell | d |\n'
    const { app, page, filePath } = await launchWithMarkdown(source, options)
    try {
      const point = await cellTextEnd(page, 'cell')
      // Control: the same key with the button released.
      await page.mouse.click(point.x, point.y)
      await page.keyboard.press(gesture.key)
      await expect.poll(() => cellTexts(page)).toContain(gesture.edited)
      const released = await save(app, page, filePath)
      await undo(app, page)
      await expect.poll(() => cellTexts(page)).toContain('cell')
      expect(await save(app, page, filePath)).toBe(source)

      await recordBeforeInput(page)
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.keyboard.press(gesture.key)
      await expect.poll(() => cellTexts(page)).toContain(gesture.edited)
      await page.mouse.up()
      const inputs = await recordedInputs(page)
      expect(inputs.map(({ inputType, prevented }) => ({ inputType, prevented }))).toEqual([
        {
          inputType: gesture.key === 'Backspace' ? 'deleteContentBackward' : 'insertText',
          prevented: true
        }
      ])
      expect(await save(app, page, filePath)).toBe(released)
      await undo(app, page)
      expect(await save(app, page, filePath)).toBe(source)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

test('an insertion that states no text (Ctrl+Y with an empty kill ring) edits nothing', async() => {
  test.skip(process.platform !== 'darwin', 'Ctrl+Y is the Cocoa yank binding')
  const source = 'abc def\n'
  const { app, page, filePath } = await launchWithMarkdown(source, options)
  try {
    const paragraph = page.locator('.editor-component span.mu-paragraph-content[contenteditable="true"]').first()
    await paragraph.click()
    await page.keyboard.press('Meta+ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await recordBeforeInput(page)
    await page.keyboard.press('Control+y')
    await settle(page)
    const inputs = await recordedInputs(page)
    expect(inputs).toEqual([{ inputType: 'insertFromYank', data: null, transfer: null, prevented: true }])
    await expect(paragraph).toHaveText('abc def')
    expect(await save(app, page, filePath)).toBe(source)
    // The caret stays where it was: the next key lands after the first character.
    await page.keyboard.type('Z')
    expect(await save(app, page, filePath)).toBe('aZbc def\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('the legacy Markdown guard is armed on a harness launch and fails the closing of an app that reports a reach', async() => {
  const { app, page } = await launchWithMarkdown('a\n', options)
  const log = process.env[LEGACY_MARKDOWN_LOG_ENV]
  try {
    await expect.poll(() => page.evaluate(() => window.__marktextLegacyMarkdownGuard?.strict)).toBe(true)
    expect(await page.evaluate(() => window.__marktextLegacyMarkdownGuard!.reaches())).toBe(0)
    // A stand-in report, kept out of the run's log, proves the harness's half.
    delete process.env[LEGACY_MARKDOWN_LOG_ENV]
    const reported = new Promise<void>((resolve) => {
      page.on('console', (message) => {
        if (message.text().startsWith(LEGACY_MARKDOWN_REACH_PREFIX)) resolve()
      })
    })
    await page.evaluate((prefix) => console.error(`${prefix} self-test`), LEGACY_MARKDOWN_REACH_PREFIX)
    await reported
  } finally {
    await expect(app.close()).rejects.toThrow('self-test')
    if (log !== undefined) process.env[LEGACY_MARKDOWN_LOG_ENV] = log
  }
})

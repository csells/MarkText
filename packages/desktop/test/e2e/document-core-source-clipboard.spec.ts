import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  clickMenuById,
  closeElectron,
  enterSourceMode,
  expectNoCapturedErrors,
  launchWithMarkdown
} from './helpers'

const SOURCE = [
  'copy:[COPY_TOKEN]',
  'cut:[CUT_TOKEN]',
  'paste:[PASTE_SLOT]',
  ''
].join('\n')
const AFTER_CUT = SOURCE.replace('CUT_TOKEN', '')
const AFTER_INTERNAL_PASTE = SOURCE.replace('PASTE_SLOT', 'CUT_TOKEN')
const PASTED_TEXT = '{++PASTED_ONCE++}'
const AFTER_PASTE = SOURCE.replace('PASTE_SLOT', PASTED_TEXT)
const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control'

type TrustedClipboardEvent = Readonly<{
  type: 'beforeinput' | 'copy' | 'cut' | 'paste'
  inputType: string | null
  isTrusted: boolean
}>

const sourceInput = (page: Page) => page.locator('.source-code-input')

const sourceValue = async(page: Page): Promise<string> =>
  await sourceInput(page).inputValue()

const selectSourceText = async(page: Page, text: string): Promise<void> => {
  const input = sourceInput(page)
  await input.focus()
  await input.evaluate((element: HTMLTextAreaElement, needle) => {
    const start = element.value.indexOf(needle)
    if (start < 0) throw new Error(`Source selection text is absent: ${needle}`)
    element.setSelectionRange(start, start + needle.length, 'forward')
  }, text)
  await expect.poll(async() => {
    return await input.evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd)
    )
  }).toBe(text)
}

const readClipboard = async(app: ElectronApplication): Promise<string> =>
  await app.evaluate(({ clipboard }) => clipboard.readText())

const readClipboardHtml = async(app: ElectronApplication): Promise<string> =>
  await app.evaluate(({ clipboard }) => clipboard.readHTML())

const writeClipboard = async(
  app: ElectronApplication,
  text: string
): Promise<void> => {
  await app.evaluate(({ clipboard }, value) => {
    clipboard.writeText(value)
  }, text)
}

const menuEnabled = async(
  app: ElectronApplication,
  id: 'editRedoMenuItem' | 'editUndoMenuItem'
): Promise<boolean> =>
  await app.evaluate(({ Menu }, menuId) =>
    Menu.getApplicationMenu()?.getMenuItemById(menuId)?.enabled === true,
  id)

const installTrustedEventRecorder = async(page: Page): Promise<void> => {
  await sourceInput(page).evaluate((element) => {
    const events: TrustedClipboardEvent[] = []
    Object.defineProperty(element, '__sourceClipboardEvents', {
      configurable: true,
      value: events
    })
    for (const type of ['beforeinput', 'copy', 'cut', 'paste'] as const) {
      element.addEventListener(type, (event) => {
        events.push(Object.freeze({
          type,
          inputType: event instanceof InputEvent ? event.inputType : null,
          isTrusted: event.isTrusted
        }))
      }, { capture: true })
    }
  })
}

const trustedEvents = async(page: Page): Promise<TrustedClipboardEvent[]> =>
  await sourceInput(page).evaluate((element) => {
    const events = (
      element as HTMLTextAreaElement & {
        __sourceClipboardEvents?: TrustedClipboardEvent[]
      }
    ).__sourceClipboardEvents
    if (events === undefined) {
      throw new Error('Source clipboard event recorder is not installed')
    }
    return events
  })

test.describe('document-core Source clipboard gestures', () => {
  test.describe.configure({ timeout: 90_000 })

  test('copies cuts and pastes through the OS clipboard exactly once with exact undo and redo', async() => {
    let app: ElectronApplication | undefined
    let previousClipboard: string | undefined
    try {
      const launched = await launchWithMarkdown(SOURCE)
      const liveApp = launched.app
      app = liveApp
      const { page } = launched
      previousClipboard = await readClipboard(liveApp)

      await enterSourceMode(page, liveApp)
      await expect(sourceInput(page)).toBeEnabled()
      await expect(sourceInput(page)).toHaveValue(SOURCE)
      await installTrustedEventRecorder(page)

      await selectSourceText(page, 'COPY_TOKEN')
      await writeClipboard(liveApp, 'copy-sentinel')
      await page.keyboard.press(`${MODIFIER}+C`)
      await expect.poll(() => readClipboard(liveApp)).toBe('COPY_TOKEN')
      await expect.poll(() => sourceValue(page)).toBe(SOURCE)

      await selectSourceText(page, 'CUT_TOKEN')
      await writeClipboard(liveApp, 'cut-sentinel')
      await page.keyboard.press(`${MODIFIER}+X`)
      await expect.poll(() => readClipboard(liveApp)).toBe('CUT_TOKEN')
      await expect.poll(() => readClipboardHtml(liveApp)).toContain(
        '<!--marktext-private-source-v1:'
      )
      const cutHtml = await readClipboardHtml(liveApp)
      expect(cutHtml).toContain('<pre>CUT_TOKEN</pre>')
      await expect.poll(() => sourceValue(page)).toBe(AFTER_CUT)

      await expect.poll(() =>
        menuEnabled(liveApp, 'editUndoMenuItem')
      ).toBe(true)
      await clickMenuById(liveApp, 'editUndoMenuItem')
      await expect.poll(() => sourceValue(page)).toBe(SOURCE)
      await expect.poll(() =>
        menuEnabled(liveApp, 'editRedoMenuItem')
      ).toBe(true)
      await clickMenuById(liveApp, 'editRedoMenuItem')
      await expect.poll(() => sourceValue(page)).toBe(AFTER_CUT)
      await expect.poll(() =>
        menuEnabled(liveApp, 'editUndoMenuItem')
      ).toBe(true)
      await clickMenuById(liveApp, 'editUndoMenuItem')
      await expect.poll(() => sourceValue(page)).toBe(SOURCE)

      // Paste the exact cut carrier back through the OS clipboard before
      // replacing it with external text. Both text/plain and text/html remain
      // readable after the one native write, and main authenticates the
      // private envelope without exposing its source to the renderer.
      await selectSourceText(page, 'PASTE_SLOT')
      await page.keyboard.press(`${MODIFIER}+V`)
      await expect.poll(() => sourceValue(page)).toBe(AFTER_INTERNAL_PASTE)
      await expect.poll(() =>
        menuEnabled(liveApp, 'editUndoMenuItem')
      ).toBe(true)
      await clickMenuById(liveApp, 'editUndoMenuItem')
      await expect.poll(() => sourceValue(page)).toBe(SOURCE)

      await selectSourceText(page, 'PASTE_SLOT')
      await writeClipboard(liveApp, PASTED_TEXT)
      await page.keyboard.press(`${MODIFIER}+V`)
      await expect.poll(() => sourceValue(page)).toBe(AFTER_PASTE)

      // One undo must remove the complete paste. This independently proves
      // that the browser's clipboard/beforeinput sequence did not commit two
      // paste transactions or insert the same clipboard material twice.
      await expect.poll(() =>
        menuEnabled(liveApp, 'editUndoMenuItem')
      ).toBe(true)
      await clickMenuById(liveApp, 'editUndoMenuItem')
      await expect.poll(() => sourceValue(page)).toBe(SOURCE)
      await expect.poll(() =>
        menuEnabled(liveApp, 'editRedoMenuItem')
      ).toBe(true)
      await clickMenuById(liveApp, 'editRedoMenuItem')
      await expect.poll(() => sourceValue(page)).toBe(AFTER_PASTE)

      const events = await trustedEvents(page)
      expect(events).toContainEqual({
        type: 'copy',
        inputType: null,
        isTrusted: true
      })
      expect(events).toContainEqual({
        type: 'cut',
        inputType: null,
        isTrusted: true
      })
      expect(events).toContainEqual({
        type: 'paste',
        inputType: null,
        isTrusted: true
      })
      expect(events.filter(event => event.type === 'paste')).toHaveLength(2)
      expect(events.every(event => event.isTrusted)).toBe(true)
      await expectNoCapturedErrors(liveApp)
    } finally {
      if (app !== undefined) {
        if (previousClipboard !== undefined) {
          await writeClipboard(app, previousClipboard).catch(() => undefined)
        }
        await closeElectron(app).catch(() => undefined)
      }
    }
  })
})

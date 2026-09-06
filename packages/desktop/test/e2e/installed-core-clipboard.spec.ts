import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import { defaultCoreLaunchEnvironment, expectDefaultCoreAuthority, expectInstalledArtifactCommit } from './installedArtifactProvenance'
import { preserveSystemClipboard } from './helpers/systemClipboardFixture'

let clipboardFixture: ReturnType<typeof preserveSystemClipboard>
test.beforeAll(() => { clipboardFixture = preserveSystemClipboard() })
test.afterAll(() => { clipboardFixture?.restore() })

const projectionSource =
  'alpha copied\n\n{--gone--}{++new++}\n\nbeta\n'
const projectedPlainText = 'copied\n\nnew\n\nbe'
const cutSource = 'alpha ta\n'
const pasteSource = `${projectionSource}\nZ\n`
const pastedSource =
  `${projectionSource}\nZcopied\n\nnew\n\nbe\n`

const installedBinary = (): string => {
  const configured = process.env.MARKTEXT_PACKAGED_APP
  if (configured === undefined || configured.trim().length === 0) {
    throw new Error('MARKTEXT_PACKAGED_APP must name the installed MarkText executable')
  }
  const absolute = path.resolve(configured)
  if (!fs.existsSync(absolute)) {
    throw new Error(`Installed MarkText executable does not exist: ${absolute}`)
  }
  return absolute
}

const launchInstalled = async(
  binary: string,
  userDataDir: string,
  filePath: string
): Promise<{ app: ElectronApplication, page: Page }> => {
  const app = await electron.launch({
    executablePath: binary,
    args: ['--user-data-dir', userDataDir, filePath],
    env: defaultCoreLaunchEnvironment({
      PERF_TESTING: 'true',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      MARKTEXT_ERROR_INTERACTION: '1'
    }),
    timeout: 60_000
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await waitForEditor(page, 60_000)
    await waitForMenuReady(app, 60_000)
    await expectInstalledArtifactCommit(page)
    await expectDefaultCoreAuthority(page)
    return { app, page }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

const selectProjectedRange = async(page: Page): Promise<void> => {
  const selected = await page.evaluate(() => {
    const root = document.querySelector('.editor-component') as HTMLElement | null
    if (root === null) return undefined

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let startNode: Node | undefined
    let startOffset = 0
    let endNode: Node | undefined
    let endOffset = 0
    let node = walker.nextNode()
    while (node !== null) {
      const text = node.textContent ?? ''
      if (startNode === undefined) {
        const copiedAt = text.indexOf('copied')
        if (copiedAt >= 0) {
          startNode = node
          startOffset = copiedAt
        }
      }
      const betaAt = text.indexOf('beta')
      if (betaAt >= 0) {
        endNode = node
        endOffset = betaAt + 2
      }
      node = walker.nextNode()
    }
    if (startNode === undefined || endNode === undefined) return undefined
    const selectionTarget = endNode.parentElement
    if (selectionTarget === null) return undefined

    root.focus()
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    const selection = window.getSelection()
    if (selection === null) return undefined
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    // Muya commits a cross-block DOM selection through its Shift+click path;
    // key events deliberately leave cross-block selections uncommitted.
    selectionTarget.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      shiftKey: true
    }))
    return selection.toString()
  })
  expect(selected).toContain('copied')
  expect(selected).toContain('new')
  expect(selected).toContain('gone')
  await page.waitForTimeout(150)
}

const placeCaretAtTargetEnd = async(page: Page): Promise<void> => {
  const placed = await page.evaluate(() => {
    const root = document.querySelector('.editor-component') as HTMLElement | null
    const paragraphs = root?.querySelectorAll('span.mu-paragraph-content')
    const target = paragraphs?.item((paragraphs?.length ?? 0) - 1)
    if (root === null || target === undefined) return false
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
    let text = walker.nextNode()
    let next = walker.nextNode()
    while (next !== null) {
      text = next
      next = walker.nextNode()
    }
    if (text === null) return false

    root.focus()
    const range = document.createRange()
    range.setStart(text, text.textContent?.length ?? 0)
    range.collapse(true)
    const selection = window.getSelection()
    if (selection === null) return false
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    root.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true
    }))
    return true
  })
  expect(placed).toBe(true)
  await page.waitForTimeout(150)
}

const invokeNativeClipboard = (
  app: ElectronApplication,
  operation: 'copy' | 'cut' | 'paste'
): Promise<void> => app.evaluate(({ BrowserWindow }, requested) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined) throw new Error('Installed editor window is absent')
  if (requested === 'copy') win.webContents.copy()
  else if (requested === 'cut') win.webContents.cut()
  else win.webContents.paste()
}, operation)

const clearClipboard = async(app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ clipboard }) => { clipboard.clear() })
  clipboardFixture.rememberOwnedWrite('')
}

const readClipboard = (app: ElectronApplication): Promise<Readonly<{
  text: string
  html: string
  formats: readonly string[]
}>> => app.evaluate(({ clipboard }) => ({
  text: clipboard.readText(),
  html: clipboard.readHTML(),
  formats: clipboard.availableFormats()
}))

const expectProjectedClipboard = async(app: ElectronApplication): Promise<void> => {
  await expect.poll(async() => (await readClipboard(app)).text)
    .toBe(projectedPlainText)
  clipboardFixture.rememberOwnedWrite(projectedPlainText)
  const payload = await readClipboard(app)
  expect(payload.formats).toContain('text/plain')
  expect(payload.formats).toContain('text/html')
  expect(payload.html).toContain('<p>copied</p>')
  expect(payload.html).toContain('<p>new</p>')
  expect(payload.html).toContain('<p>be</p>')
  expect(payload.html).not.toContain('gone')
  expect(payload.html).not.toContain('{++')
  expect(payload.html).not.toContain('{--')
}

const saveAndExpect = async(
  app: ElectronApplication,
  filePath: string,
  expectedSource: string
): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(expectedSource)
}

test.describe('installed Core projected clipboard authority', () => {
  test.describe.configure({ timeout: 180_000 })

  test('native Copy publishes the selected Revised rich and plain projections', async() => {
    const binary = installedBinary()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-clipboard-'))
    const filePath = path.join(root, 'clipboard.md')
    const userDataDir = path.join(root, 'profile')
    fs.writeFileSync(filePath, projectionSource, 'utf8')
    let launched: { app: ElectronApplication, page: Page } | undefined
    try {
      launched = await launchInstalled(binary, userDataDir, filePath)
      const { app, page } = launched
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      expect(await page.evaluate(() =>
        window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
      )).toBeUndefined()

      await clearClipboard(app)
      await selectProjectedRange(page)
      await invokeNativeClipboard(app, 'copy')
      await expectProjectedClipboard(app)
      await saveAndExpect(app, filePath, projectionSource)

      await app.close()
      launched = undefined
      launched = await launchInstalled(binary, userDataDir, filePath)
      await expectEditorWindowHidden(launched.app)
      expectEditorNotFrontmost(launched.app)
      expect(fs.readFileSync(filePath, 'utf8')).toBe(projectionSource)
    } finally {
      if (launched !== undefined) await launched.app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('native Cut writes its Revised payload before one actor history mutation', async() => {
    const binary = installedBinary()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-clipboard-'))
    const filePath = path.join(root, 'clipboard.md')
    const userDataDir = path.join(root, 'profile')
    fs.writeFileSync(filePath, projectionSource, 'utf8')
    let launched: { app: ElectronApplication, page: Page } | undefined
    try {
      launched = await launchInstalled(binary, userDataDir, filePath)
      const { app, page } = launched
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)

      await clearClipboard(app)
      await selectProjectedRange(page)
      await invokeNativeClipboard(app, 'cut')
      await expectProjectedClipboard(app)
      await expect.poll(() => page.locator('span.mu-paragraph-content').allTextContents())
        .toEqual(['alpha ta'])
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await saveAndExpect(app, filePath, cutSource)

      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await saveAndExpect(app, filePath, projectionSource)

      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await saveAndExpect(app, filePath, cutSource)

      await app.close()
      launched = undefined
      launched = await launchInstalled(binary, userDataDir, filePath)
      await expectEditorWindowHidden(launched.app)
      expectEditorNotFrontmost(launched.app)
      expect(fs.readFileSync(filePath, 'utf8')).toBe(cutSource)
    } finally {
      if (launched !== undefined) await launched.app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('native Paste commits a copied Revised projection through actor history', async() => {
    const binary = installedBinary()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-clipboard-'))
    const filePath = path.join(root, 'clipboard.md')
    const userDataDir = path.join(root, 'profile')
    fs.writeFileSync(filePath, pasteSource, 'utf8')
    let launched: { app: ElectronApplication, page: Page } | undefined
    try {
      launched = await launchInstalled(binary, userDataDir, filePath)
      const { app, page } = launched
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)

      await clearClipboard(app)
      await selectProjectedRange(page)
      await invokeNativeClipboard(app, 'copy')
      await expectProjectedClipboard(app)
      await placeCaretAtTargetEnd(page)
      await page.evaluate(() => {
        delete document.documentElement.dataset.phase4PasteEvent
        document.addEventListener('paste', event => {
          document.documentElement.dataset.phase4PasteEvent = JSON.stringify({
            text: event.clipboardData?.getData('text/plain') ?? null,
            html: event.clipboardData?.getData('text/html') ?? null,
            activeElementClass: document.activeElement?.getAttribute('class') ?? null
          })
        }, { capture: true, once: true })
      })
      await invokeNativeClipboard(app, 'paste')
      await expect.poll(() => page.evaluate(() =>
        document.documentElement.dataset.phase4PasteEvent
      )).not.toBeUndefined()
      const observedPaste = await page.evaluate(() =>
        document.documentElement.dataset.phase4PasteEvent
      )
      if (observedPaste === undefined) throw new Error('Native paste event is absent')
      expect(JSON.parse(observedPaste)).toMatchObject({
        text: projectedPlainText,
        activeElementClass: expect.stringContaining('editor-component')
      })
      await expect.poll(() => page.locator('span.mu-paragraph-content').allTextContents())
        .toEqual(['alpha copied', 'gonenew', 'beta', 'Zcopied', 'new', 'be'])
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await saveAndExpect(app, filePath, pastedSource)

      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await saveAndExpect(app, filePath, pasteSource)

      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await saveAndExpect(app, filePath, pastedSource)

      await app.close()
      launched = undefined
      launched = await launchInstalled(binary, userDataDir, filePath)
      await expectEditorWindowHidden(launched.app)
      expectEditorNotFrontmost(launched.app)
      expect(fs.readFileSync(filePath, 'utf8')).toBe(pastedSource)
    } finally {
      if (launched !== undefined) await launched.app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

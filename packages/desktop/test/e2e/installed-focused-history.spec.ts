import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  clickMenuByLabel,
  enterSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  placeCaretInEditor,
  waitForEditor,
  waitForMenuReady,
  showReviewSidebar
} from './helpers'
import {
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'
import { nativeKey } from './reviewGestures'

type Surface = 'markup' | 'source'
type Trigger = 'native shortcut' | 'Edit menu'
type Field = 'Find' | 'command palette' | 'Review comment'
type SaveProbe = { focusedHistorySaves: number }

const initialSource = 'seed\n\nText.{>>note<<}\n'
const editedSource = 'seedX\n\nText.{>>note<<}\n'
const launchOptions = {
  suppressErrorDialog: true,
  env: {
    MARKTEXT_E2E_HIDDEN_WINDOW: '1',
    MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
  }
} as const

async function menu(app: ElectronApplication, ...labels: string[]): Promise<void> {
  await expectEditorWindowHidden(app)
  await clickMenuByLabel(app, ...labels)
}

async function history(app: ElectronApplication, trigger: Trigger, redo = false): Promise<void> {
  if (trigger === 'Edit menu') return menu(app, 'Edit', redo ? 'Redo' : 'Undo')
  // Page.keyboard.press bypasses Electron's window-wide shortcut interception.
  await nativeKey(app, 'Z', redo ? ['meta', 'shift'] : ['meta'])
}

async function focusDocument(
  page: Page,
  app: ElectronApplication,
  surface: Surface
): Promise<void> {
  if (surface === 'markup') return placeCaretInEditor(page)
  await enterSourceMode(page, app)
  await page.evaluate(() => {
    const cm = (
      document.querySelector('.source-code .CodeMirror') as Element & {
        CodeMirror: {
          focus(): void
          getLine(index: number): string
          setCursor(position: { line: number; ch: number }): void
        }
      }
    ).CodeMirror
    cm.focus()
    cm.setCursor({ line: 0, ch: cm.getLine(0).length })
  })
}

async function saveAndExpect(
  app: ElectronApplication,
  file: string,
  expected: string
): Promise<void> {
  const before = await app.evaluate(() => (globalThis as unknown as SaveProbe).focusedHistorySaves)
  await menu(app, 'File', 'Save')
  // Await this save's acknowledgement even when the previous disk content
  // already equals expected; otherwise a wrong undo can pass before the write.
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as SaveProbe).focusedHistorySaves))
    .toBe(before + 1)
  expect(readFileSync(file, 'utf8')).toBe(expected)
}

async function openField(app: ElectronApplication, page: Page, field: Field): Promise<Locator> {
  if (field === 'Review comment') {
    await showReviewSidebar(app)
    await page.getByTestId('critic-review-edit-comment').click()
    return page.getByTestId('critic-review-comment-input')
  }
  await menu(app, ...(field === 'Find' ? ['Edit', 'Find'] : ['View', 'Command Palette']))
  return page.locator(field === 'Find' ? '.search-bar .search input' : 'input.search').last()
}

for (const surface of ['markup', 'source'] as const) {
  for (const field of ['Find', 'command palette', 'Review comment'] as const) {
    if (surface === 'source' && field === 'Review comment') continue
    for (const trigger of ['native shortcut', 'Edit menu'] as const) {
      test(`${surface}: ${field} owns Undo/Redo through ${trigger}, then document history and save still work`, async() => {
        test.skip(process.platform !== 'darwin', 'Native macOS shortcut regression')
        const { app, page, filePath } = await launchWithMarkdown(initialSource, launchOptions)
        try {
          await waitForEditor(page)
          await waitForMenuReady(app)
          await expectEditorWindowHidden(app)
          expectEditorNotFrontmost(app)
          await expectDefaultCoreAuthority(page)
          if (process.env.MARKTEXT_PACKAGED_APP) await expectInstalledArtifactCommit(page)
          await app.evaluate(({ ipcMain }) => {
            const probe = globalThis as unknown as SaveProbe
            probe.focusedHistorySaves = 0
            ipcMain.on('window-file-saved', () => probe.focusedHistorySaves++)
          })
          await focusDocument(page, app, surface)
          await page.keyboard.type('X')
          await saveAndExpect(app, filePath, editedSource)

          const input = await openField(app, page, field)
          await expect(input).toBeVisible()
          await input.focus()
          const before = field === 'Review comment' ? 'note' : ''
          const suffix = field === 'Review comment' ? ' changed' : 'seed'
          await expect(input).toHaveValue(before)
          await input.press('End')
          await input.pressSequentially(suffix)
          await expect(input).toBeFocused()
          const undoneValues: string[] = []
          let value = before + suffix
          // Chromium may split typing when the palette updates its selection.
          // Each native group must undo within this field and redo exactly.
          while (value !== before) {
            expect(undoneValues.length).toBeLessThan(suffix.length)
            undoneValues.push(value)
            await history(app, trigger)
            await expect.poll(() => input.inputValue()).not.toBe(value)
            const next = await input.inputValue()
            expect(value.startsWith(next)).toBe(true)
            expect(next.startsWith(before)).toBe(true)
            expect(next.length).toBeLessThan(value.length)
            await saveAndExpect(app, filePath, editedSource)
            value = next
          }
          for (const redone of undoneValues.reverse()) {
            await expect(input).toBeFocused()
            await history(app, trigger, true)
            await expect(input).toHaveValue(redone)
            await saveAndExpect(app, filePath, editedSource)
          }

          if (field !== 'Review comment') {
            // Probe exhausted history after the field's exact redo round-trip.
            // Chromium can retain earlier CodeMirror textarea entries in its
            // native stack; none may change the canonical document.
            for (let step = 0; step <= undoneValues.length; step++) {
              await history(app, trigger)
              await saveAndExpect(app, filePath, editedSource)
            }
            await expect(input).toHaveValue('')
          }

          if (field === 'Review comment') {
            await page.getByTestId('critic-review-comment-cancel').click()
          } else await input.press('Escape')
          await expect(input).toBeHidden()
          await focusDocument(page, app, surface)
          await history(app, trigger)
          await saveAndExpect(app, filePath, initialSource)
          await history(app, trigger, true)
          await saveAndExpect(app, filePath, editedSource)
          await page.keyboard.type('Y')
          await saveAndExpect(app, filePath, 'seedXY\n\nText.{>>note<<}\n')
          await expectNoRendererErrors(app)
        } finally {
          if (!page.isClosed()) {
            await test.info().attach('focused-history-state.txt', {
              contentType: 'text/plain',
              body: await page.locator('body').innerText()
            })
            await test.info().attach('focused-history-source.md', {
              contentType: 'text/markdown',
              body: readFileSync(filePath, 'utf8')
            })
          }
          await app.close()
        }
      })
    }
  }
}

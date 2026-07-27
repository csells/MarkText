import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import {
  closeElectron,
  launchWithMarkdown,
  waitForMenuReady,
  enterSourceMode,
  sendIpcToRenderer
} from './helpers'

// Issue #781 — Undo/redo while in Source Code mode must act on the
// main-owned document history, whose head drives the source input.

const sourceValue = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const input = document.querySelector(
      '.source-code-input'
    ) as HTMLTextAreaElement
    return input.value
  })

const typeInSource = async(page: Page, text: string): Promise<void> => {
  const input = page.locator('.source-code-input')
  await input.focus()
  await input.evaluate((element: HTMLTextAreaElement) => {
    const offset = 'saved baseline'.length
    element.setSelectionRange(offset, offset)
  })
  await page.keyboard.insertText(text)
}

const undo = (app: Parameters<typeof sendIpcToRenderer>[0]): Promise<void> =>
  sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
const redo = (app: Parameters<typeof sendIpcToRenderer>[0]): Promise<void> =>
  sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')

test.describe('Issue #781 — undo/redo in source code mode', () => {
  test('undo reverts a source-mode edit; redo re-applies it', async() => {
    const { app, page } = await launchWithMarkdown('saved baseline\n')
    await waitForMenuReady(app)

    await enterSourceMode(page, app)
    const baseline = await sourceValue(page)

    await typeInSource(page, ' SRCKEY')
    expect(await sourceValue(page)).toContain('saved baseline SRCKEY')

    await undo(app)
    await expect.poll(() => sourceValue(page)).toBe(baseline)

    await redo(app)
    await expect.poll(() => sourceValue(page)).toContain('saved baseline SRCKEY')

    await closeElectron(app)
  })
})

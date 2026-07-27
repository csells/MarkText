import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import {
  closeElectron,
  expectNoCapturedErrors,
  launchWithMarkdown,
  readCanonicalMarkdown,
  sendIpcToRenderer
} from './helpers'

const SOURCE = `${'> '.repeat(129)}text\r\n`

async function dispatchBeforeInput(
  page: Page,
  start: number,
  end: number,
  inputType: string,
  data: string | null = null
): Promise<void> {
  await page.evaluate(({ start, end, inputType, data }) => {
    const host = document.querySelector(
      '.document-view-container'
    ) as HTMLElement | null
    const text = host?.querySelector('.document-view-run')?.firstChild
    if (!host || !(text instanceof Text)) {
      throw new Error('Automatic Source view has no raw-source text carrier')
    }
    const range = document.createRange()
    range.setStart(text, start)
    range.setEnd(text, end)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType,
      data
    })
    if (host.dispatchEvent(event) || !event.defaultPrevented) {
      throw new Error('Automatic Source beforeinput was not intercepted')
    }
  }, { start, end, inputType, data })
}

test.describe('document-core automatic Source view', () => {
  test.describe.configure({ timeout: 90_000 })

  test('edits, saves, recovers, and crosses undo/redo without a second editor', async() => {
    let app: ElectronApplication | undefined
    try {
      const launched = await launchWithMarkdown(SOURCE)
      app = launched.app
      const { page, filePath } = launched
      const host = page.locator(
        '.document-view-container[data-document-mode="source-only"]'
      )
      await expect(host).toHaveAttribute('contenteditable', 'true')
      await expect(host).toHaveText(SOURCE)
      await expect(page.locator('.source-code-input')).toHaveCount(0)

      await dispatchBeforeInput(
        page,
        SOURCE.length,
        SOURCE.length,
        'insertText',
        '!'
      )
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(`${SOURCE}!`)
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8'))
        .toBe(`${SOURCE}!`)

      // Removing one quote prefix drops below the semantic-depth budget. The
      // same main-owned session publishes a semantic tree; no view handoff or
      // renderer-side reparse is involved.
      await dispatchBeforeInput(page, 0, 2, 'deleteContentForward')
      await expect(page.locator(
        '.document-view-container[data-document-mode="semantic"]'
      )).toBeVisible()
      await expect.poll(() => readCanonicalMarkdown(page))
        .toBe(`${SOURCE.slice(2)}!`)

      await dispatchBeforeInput(page, 0, 0, 'historyUndo')
      await expect(host).toHaveText(`${SOURCE}!`)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(`${SOURCE}!`)

      await dispatchBeforeInput(page, 0, 0, 'historyRedo')
      await expect(page.locator(
        '.document-view-container[data-document-mode="semantic"]'
      )).toBeVisible()
      await expect.poll(() => readCanonicalMarkdown(page))
        .toBe(`${SOURCE.slice(2)}!`)
      await expectNoCapturedErrors(app)
    } finally {
      if (app !== undefined) {
        await closeElectron(app).catch(() => undefined)
      }
    }
  })
})

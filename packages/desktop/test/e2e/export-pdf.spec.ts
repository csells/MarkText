import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

// Exercise Chromium's real PDF producer against the hidden MarkText editor
// window. Native save-dialog composition and cancellation are unit-tested at
// the presentation-policy boundary; an E2E test must not patch Electron or add
// a production-only authorization backdoor merely to choose a destination.

const PDF_DOC =
  '# Export Smoke\n\n' +
  'First paragraph with **bold** and *italic* text.\n\n' +
  'Second paragraph for a multi-block document.\n\n' +
  '- list item one\n- list item two\n'

const printHiddenEditorToPdf = async(app: ElectronApplication): Promise<Buffer> => {
  const base64 = await app.evaluate(async({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!win) {
      throw new Error('Expected a live hidden MarkText editor window')
    }
    const data = await win.webContents.printToPDF({
      printBackground: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true
    })
    return data.toString('base64')
  })
  return Buffer.from(base64, 'base64')
}

test.describe('hidden Electron PDF generation (item 231)', () => {
  test.describe.configure({ timeout: 60000 })

  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(PDF_DOC)
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('prints the real editor window to a non-empty PDF artifact', async() => {
    await expect(page.locator('body')).toContainText('Export Smoke')

    const data = await printHiddenEditorToPdf(app)

    expect(data.length).toBeGreaterThan(500)
    expect(data.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(data.subarray(-6).toString('latin1')).toContain('%%EOF')
  })

  test('can print the same live document repeatedly without presentation UI', async() => {
    const first = await printHiddenEditorToPdf(app)
    const second = await printHiddenEditorToPdf(app)

    expect(first.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(second.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(second.length).toBeGreaterThan(500)
    expect(second.subarray(-6).toString('latin1')).toContain('%%EOF')
  })
})

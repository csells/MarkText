import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import path from 'node:path'
import {
  enterSourceMode,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

// Revised text is "Keep  new fresh text": four words, whatever the annotations.
const REVIEW_DOC = 'Keep {--gone--} {++new++} {~~old~>fresh~~} text{>>a note<<}\n'
const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A'

const suggestedSaveNames = async(app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as { saveNames: string[] }).saveNames)

const recordSaveDialog = async(app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ dialog }) => {
    const names: string[] = []
    ;(globalThis as unknown as { saveNames: string[] }).saveNames = names
    dialog.showSaveDialog = (async(...args: unknown[]) => {
      const options = args.at(-1) as { defaultPath?: string }
      names.push(options.defaultPath ?? '')
      return { canceled: true, filePath: '' }
    }) as typeof dialog.showSaveDialog
  })
}

test.describe('Core-only view consumers', () => {
  let app: ElectronApplication
  let page: Page

  test.afterEach(async() => {
    if (app) await app.close()
  })

  test('counts the document and a WYSIWYG selection as Revised shows them', async() => {
    ;({ app, page } = await launchWithMarkdown(REVIEW_DOC, { suppressErrorDialog: true }))
    const counter = page.locator('.word-count')
    await expect(counter).toHaveText('W 4')

    await page.locator('p.mu-paragraph').first().click()
    await page.keyboard.press(selectAll)
    await expect(counter).toHaveText('W 4 / 4')
    await expectNoRendererErrors(app)
  })

  test('counts a Source selection as Revised shows it, not its CriticMarkup', async() => {
    ;({ app, page } = await launchWithMarkdown(REVIEW_DOC, { suppressErrorDialog: true }))
    await enterSourceMode(page, app)
    const counter = page.locator('.word-count')
    await page.click('.source-code .CodeMirror')
    await page.keyboard.press(selectAll)
    await expect(counter).toHaveText('W 4 / 4')
    await page.keyboard.press('ArrowRight')
    await expect(counter).toHaveText('W 4')
    await expectNoRendererErrors(app)
  })

  test('the hidden WYSIWYG view refuses clipboard and drops while Source owns the lease', async() => {
    ;({ app, page } = await launchWithMarkdown(REVIEW_DOC, { suppressErrorDialog: true }))
    await enterSourceMode(page, app)
    const refused = await page.evaluate(() => {
      const surface = document.querySelector('.editor-surface')
      const target = surface?.querySelector('.editor-component') ?? surface
      if (!target) throw new Error('The WYSIWYG surface is not mounted')
      return ['copy', 'cut', 'paste', 'drop'].map((type) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        target.dispatchEvent(event)
        return [type, event.defaultPrevented]
      })
    })
    expect(refused).toEqual([
      ['copy', true],
      ['cut', true],
      ['paste', true],
      ['drop', true]
    ])
    // Source view's own copy target is untouched by the hidden view's guard.
    const sourceCopy = await page.evaluate(() => {
      const input = document.querySelector('.source-code .CodeMirror textarea')
      if (!input) throw new Error('Source input is not mounted')
      const event = new Event('copy', { bubbles: true, cancelable: true })
      input.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(sourceCopy).toBe(false)
    await expectNoRendererErrors(app)
  })

  test('Save suggests a new file name from the heading Core reads, without markers', async() => {
    ;({ app, page } = await launchWithMarkdown('', { suppressErrorDialog: true }))
    await recordSaveDialog(app)
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '# Draft {++new++}{>>why<<}\n\nBody\n')
    await expect(page.locator('h1')).toContainText('Draft')
    await expect
      .poll(async() => {
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        return path.basename((await suggestedSaveNames(app)).at(-1) ?? '')
      })
      .toBe('Draft new.md')
    await expectNoRendererErrors(app)
  })
})

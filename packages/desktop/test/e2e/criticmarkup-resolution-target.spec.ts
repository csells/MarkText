import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  clickMenuById,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

// Vision: "actions make their target clear." Resolution commands act only on
// the annotation under the caret or selection, or on one chosen explicitly
// and revealed; never on an invisible default, and never from a read-only view.
const source = 'Plain start.\n\nMiddle {++added phrase++} and {--gone--}.\n\nPlain end.\n'
const env = { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }

const enabled = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => Object.fromEntries(
    ['critic-accept', 'critic-reject', 'critic-accept-all', 'critic-reject-all'].map(id => [id, Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled ?? null])
  ))

const outlined = (page: Page) => page.locator('.core-review-current-block').count()

test('resolution needs a visible target and clears when the caret leaves it', async() => {
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    const paragraphs = page.locator('.editor-component .mu-paragraph-content')
    await paragraphs.first().click()
    await expect.poll(() => enabled(app)).toMatchObject({ 'critic-accept': false, 'critic-reject': false })

    await page.locator('[data-critic-kind="addition"]').click()
    await expect.poll(() => enabled(app)).toMatchObject({ 'critic-accept': true, 'critic-reject': true })

    await paragraphs.last().click()
    await expect.poll(() => enabled(app)).toMatchObject({ 'critic-accept': false, 'critic-reject': false })
    expect(await outlined(page)).toBe(0)

    // Explicit navigation reveals its target, which Accept then resolves.
    await clickMenuById(app, 'critic-next')
    await expect.poll(() => outlined(page)).toBe(1)
    await expect.poll(() => enabled(app)).toMatchObject({ 'critic-accept': true })
    await clickMenuById(app, 'critic-accept')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).not.toBe(source)
    await expectEditorWindowHidden(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('reader views disable every resolution command', async() => {
  const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await page.locator('[data-critic-kind="addition"]').click()
    await expect.poll(() => enabled(app)).toMatchObject({ 'critic-accept': true })
    for (const view of ['critic-original', 'critic-revised']) {
      await clickMenuById(app, view)
      await expect.poll(() => enabled(app)).toEqual({
        'critic-accept': false,
        'critic-reject': false,
        'critic-accept-all': false,
        'critic-reject-all': false
      })
    }
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

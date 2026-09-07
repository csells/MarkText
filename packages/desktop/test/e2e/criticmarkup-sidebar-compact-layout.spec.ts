import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

const source = Array.from({ length: 12 }, (_, index) =>
  `{==Passage ${index + 1}==}{>>Comment ${index + 1}.<<}\n`
).join('\n')

test('review and comment editing remain reachable at minimum window height with view help expanded', async() => {
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 350))
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    const sidebar = page.locator('.side-bar')
    const divider = sidebar.locator('.drag-bar')
    const bounds = await sidebar.boundingBox()
    const drag = await divider.boundingBox()
    if (!bounds || !drag) throw new Error('Expected the visible sidebar and its native divider')
    await page.mouse.move(drag.x + drag.width / 2, 175)
    await page.mouse.down()
    await page.mouse.move(drag.x + drag.width / 2 - (bounds.width - 220), 175)
    await page.mouse.up()
    await expect(sidebar).toHaveCSS('width', '220px')
    await sidebar.getByText('About these views', { exact: true }).click()
    await expect(sidebar.locator('details')).toHaveAttribute('open', '')

    const entry = sidebar.getByTestId('critic-review-entry').first()
    const select = entry.locator(':scope > button')
    await select.scrollIntoViewIfNeeded()
    await expect(select).toBeInViewport({ ratio: 1 })
    await select.click()
    const edit = entry.getByTestId('critic-review-edit-comment')
    await edit.scrollIntoViewIfNeeded()
    await expect(edit).toBeInViewport({ ratio: 1 })
    await edit.click()
    const input = sidebar.getByTestId('critic-review-comment-input')
    await expect(input).toBeEditable()
    await input.fill('A temporary draft that will be cancelled.')
    await expect(input).toHaveValue('A temporary draft that will be cancelled.')
    const cancel = sidebar.getByTestId('critic-review-comment-cancel')
    await cancel.scrollIntoViewIfNeeded()
    await expect(cancel).toBeInViewport({ ratio: 1 })
    await cancel.click()
    await expect(input).toHaveCount(0)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expectNoRendererErrors(app)
    await page.screenshot({ path: test.info().outputPath('compact-sidebar.png') })
  } finally { await app.close() }
})

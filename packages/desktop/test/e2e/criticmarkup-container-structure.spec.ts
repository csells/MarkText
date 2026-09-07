import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost, expectEditorWindowHidden, expectNoRendererErrors,
  launchElectron, launchWithReviewMarkdown as launchWithMarkdown, sendIpcToRenderer, waitForEditor, waitForMenuReady
} from './helpers'

const options = {
  suppressErrorDialog: true,
  env: {
    MARKTEXT_DOCUMENT_CORE_MODE: undefined,
    MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
    MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
    MARKTEXT_E2E_HIDDEN_WINDOW: '1'
  }
}

test('removes annotated list formatting and continues typing through save and history', async() => {
  const source = '- {++first++}{>>keep<<}\n- second\n'
  const unlisted = '{++first++}{>>keep<<}\n\nsecond\n'
  const { app, page, filePath } = await launchWithMarkdown(source, options)
  try {
    await page.locator('.mu-paragraph-content').filter({ hasText: 'first' }).click()
    await sendIpcToRenderer(app, 'mt::editor-paragraph-action', { type: 'ul-bullet' })
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expect(page.locator('.editor-component ul li')).toHaveCount(0)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(unlisted)
    await page.locator('.mu-paragraph-content').filter({ hasText: 'second' }).click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
    await page.waitForTimeout(1100)
    await page.keyboard.type('!')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(unlisted.replace('second', 'second!'))
    for (const expected of [unlisted, source]) {
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
    }
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('tracks removing annotated list formatting across code and retains continued input', async() => {
  const source = '- {++first++}{>>keep<<}\n\n  ```js\n  const x = 1\n  ```\n- second\n'
  const revised = '{++first++}{>>keep<<}\n\n```js\nconst x = 1\n```\n\nsecond\n'
  const suggestion = '{~~' + source.slice(0, source.indexOf('second')) + '~>' +
    revised.slice(0, revised.indexOf('second')) + '~~}second\n'
  const { app, page, filePath } = await launchWithMarkdown(source, options)
  try {
    await page.getByTestId('critic-review-track-changes').click()
    await page.locator('.mu-paragraph-content').filter({ hasText: 'first' }).click()
    await sendIpcToRenderer(app, 'mt::editor-paragraph-action', { type: 'ul-bullet' })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(suggestion)
    await page.getByTestId('critic-review-revised').click()
    await expect(page.locator('[data-projection="revised"] ul')).toHaveCount(0)
    await expect(page.locator('[data-projection="revised"] pre')).toContainText('const x = 1')
    await page.getByTestId('critic-review-original').click()
    // Original omits the added first item's text; its empty item ends before
    // the blank line and fence, so the final item starts a second list.
    await expect(page.locator('[data-projection="original"] ul')).toHaveCount(2)
    await page.getByTestId('critic-review-markup').click()
    await page.locator('.mu-paragraph-content').filter({ hasText: 'second' }).click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
    await page.waitForTimeout(1100)
    await page.keyboard.type('!')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(suggestion.replace('second', 'second{++!++}'))
    for (const expected of [suggestion, source]) {
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
    }
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

for (const tracked of [false, true]) {
  test(`toggles an annotated checkbox through save and undo with tracked=${tracked}`, async() => {
    const source = '- [ ] {++task++}{>>keep<<}\n'
    const { app, page, filePath } = await launchWithMarkdown(source, options)
    try {
      if (tracked) await page.getByTestId('critic-review-track-changes').click()
      await page.locator('.editor-component input[type=checkbox]').check()
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked
        ? '- [{~~ ~>x~~}] {++task++}{>>keep<<}\n'
        : '- [x] {++task++}{>>keep<<}\n')
      if (tracked) {
        await page.getByTestId('critic-review-revised').click()
        await expect(page.locator('[data-projection="revised"] input[type=checkbox]')).toBeChecked()
        await page.getByTestId('critic-review-original').click()
        await expect(page.locator('[data-projection="original"] input[type=checkbox]')).not.toBeChecked()
        await page.getByTestId('critic-review-markup').click()
        await expect(page.locator('.mu-paragraph-content')).toContainText('[ x] task')
        await expect(page.locator('.mu-paragraph-content')).toHaveAttribute('contenteditable', 'true')
      } else {
        await expect(page.locator('.editor-component input[type=checkbox]')).toBeChecked()
      }
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
      await expect(page.locator('.editor-component input[type=checkbox]')).not.toBeChecked()
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expectNoRendererErrors(app)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
    } finally {
      await app.close()
    }
  })
}

test('indents an annotated list without losing hidden comments or subsequent input', async() => {
  const source = '- {++first++}{>>keep note<<}\n- second\n'
  const nested = '- {++first++}{>>keep note<<}\n  - second\n'
  const { app, page, filePath } = await launchWithMarkdown(source, options)
  try {
    const second = page.locator('.mu-paragraph-content').filter({ hasText: 'second' })
    await second.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Tab')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expect(page.locator('.editor-component ul li ul li')).toHaveCount(1)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(nested)
    // Separate native history groups using Muya's one-second idle boundary.
    await page.waitForTimeout(1100)
    await page.keyboard.type('!')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(nested.replace('second', 'second!'))
    for (const expected of [nested, source]) {
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
    }
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('inserts a row in an annotated table and preserves it through history and reopen', async() => {
  const source = '| col |\n| --- |\n| {++cell++} |\n'
  const { app, page, filePath } = await launchWithMarkdown(source, options)
  let reopened: Awaited<ReturnType<typeof launchElectron>> | undefined
  try {
    const cell = page.locator('.mu-table-cell-content').filter({ hasText: 'cell' })
    await cell.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expect(page.locator('.editor-component table tr')).toHaveCount(3)
    await page.waitForTimeout(1100)
    await page.keyboard.type('newrow')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('newrow')
    const edited = readFileSync(filePath, 'utf8')
    expect(edited).toBe(source + '|     newrow|\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(edited)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await app.close()
    reopened = await launchElectron([filePath], options)
    await waitForEditor(reopened.page)
    await waitForMenuReady(reopened.app)
    await expect(reopened.page.locator('.editor-component table tr')).toHaveCount(3)
    await expect(reopened.page.locator('.mu-table-cell-content').last()).toHaveText('newrow')
    await sendIpcToRenderer(reopened.app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(edited)
  } finally {
    await (reopened?.app ?? app).close().catch(() => {})
  }
})

test('annotated table toolbar preserves source through alignment, column removal and history', async() => {
  const source = '| first | second |\n| ---- | --- |\n| {++cell++}{>>note<<} | other |\n'
  const { app, page, filePath } = await launchWithMarkdown(source, options)
  const toolbar = async(column: number) => {
    const cell = page.locator('.editor-component table tr').first().locator('th, td').nth(column)
    const box = await cell.boundingBox()
    if (!box) throw new Error('Expected table header bounds')
    await page.mouse.move(box.x + box.width / 2, box.y - 10)
    await page.waitForTimeout(80)
    await page.mouse.move(box.x + box.width / 2, box.y - 9)
    const tools = page.locator('.mu-table-column-tools').first()
    await expect.poll(() => tools.evaluate(element => Number.parseFloat((element.closest('.mu-float-wrapper') as HTMLElement).style.opacity || '0'))).toBeGreaterThan(0)
    return tools
  }
  const save = async(expected: string) => {
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
  }
  try {
    await (await toolbar(0)).locator('li.item.center').click()
    await save(source.replace('----', ':----:'))
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await save(source)
    await (await toolbar(1)).locator('li.item.remove').click()
    const removed = '| first |\n| ---- |\n| {++cell++}{>>note<<} |\n'
    await save(removed)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await save(source)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await save(removed)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

for (const { kind, body, indented } of [
  { kind: 'fenced code', body: '  ```js\n  const n = 1\n  ```\n', indented: '    ```js\n    const n = 1\n    ```\n' },
  { kind: 'heading', body: '  ## Section\n', indented: '    ## Section\n' },
  { kind: 'setext heading', body: '  Section\n  -------\n', indented: '    Section\n    -------\n' },
  { kind: 'math', body: '  $$\n  x = 1\n  $$\n', indented: '    $$\n    x = 1\n    $$\n' },
  { kind: 'HTML', body: '  <div>\n  literal {++text++}\n  </div>\n', indented: '    <div>\n    literal {++text++}\n    </div>\n' },
  { kind: 'table', body: '  | a | b |\n  | --- | :--- |\n  | x | y |\n', indented: '    | a | b |\n    | --- | :--- |\n    | x | y |\n' }
]) {
  test(`indents an annotated list item together with its ${kind}`, async() => {
    const source = '- {++first++}{>>note<<}\n- second\n\n' + body
    const nested = '- {++first++}{>>note<<}\n  - second\n\n' + indented
    const { app, page, filePath } = await launchWithMarkdown(source, options)
    try {
      await page.locator('.mu-paragraph-content').filter({ hasText: /^second$/ }).click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
      await page.keyboard.press('Tab')
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(nested)
      await expect(page.locator('.editor-component ul li ul li')).toHaveCount(1)
      if (kind === 'table') await expect(page.locator('.editor-component ul li ul li table')).toHaveCount(1)
      await page.waitForTimeout(1100)
      await page.keyboard.type('!')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(nested.replace('second', 'second!'))
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expectNoRendererErrors(app)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
    } finally {
      await app.close()
    }
  })
}

test('removes a table header through the row menu and retains the annotated replacement', async() => {
  const source = '| heading |\n| :---- |\n| {++cell++}{>>note<<} |\n| body |\n'
  const { app, page, filePath } = await launchWithMarkdown(source, options)
  try {
    const cell = page.locator('.editor-component table tr').first().locator('td, th').last()
    const box = await cell.boundingBox()
    if (!box) throw new Error('Expected table header bounds')
    await page.mouse.move(box.x + box.width + 10, box.y + box.height / 2)
    await page.waitForTimeout(80)
    await page.mouse.move(box.x + box.width + 10, box.y + box.height / 2 + 1)
    const bar = page.locator('.mu-table-drag-bar').first()
    await expect.poll(() => bar.evaluate(element => Number.parseFloat((element.closest('.mu-float-wrapper') as HTMLElement).style.opacity || '0'))).toBeGreaterThan(0)
    await bar.click()
    await page.locator('.mu-float-container.mu-table-bar-tools').getByText('Remove Row', { exact: true }).click()
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('| {++cell++}{>>note<<} |\n| :---- |\n| body |\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

test('inserts a row in an annotated table inside a list and preserves it through history and reopen', async() => {
  const source = '- item\n\n  | col |\n  | --- |\n  | {++cell++} |\n'
  const { app, page, filePath } = await launchWithMarkdown(source, options)
  let reopened: Awaited<ReturnType<typeof launchElectron>> | undefined
  try {
    const cell = page.locator('.mu-table-cell-content').filter({ hasText: 'cell' })
    await cell.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expect(page.locator('.editor-component table tr')).toHaveCount(3)
    await page.waitForTimeout(1100)
    await page.keyboard.type('newrow')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('newrow')
    const edited = readFileSync(filePath, 'utf8')
    expect(edited).toBe(source + '  |     newrow|\n')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(edited)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await app.close()
    reopened = await launchElectron([filePath], options)
    await waitForEditor(reopened.page)
    await waitForMenuReady(reopened.app)
    await expect(reopened.page.locator('.editor-component table tr')).toHaveCount(3)
    await expect(reopened.page.locator('.mu-table-cell-content').last()).toHaveText('newrow')
    await sendIpcToRenderer(reopened.app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(edited)
  } finally {
    await (reopened?.app ?? app).close().catch(() => {})
  }
})

test('annotated table toolbar inside a list preserves source through alignment, column removal and history', async() => {
  const source = '- item\n\n  | first | second |\n  | ---- | --- |\n  | {++cell++}{>>note<<} | other |\n'
  const { app, page, filePath } = await launchWithMarkdown(source, options)
  const toolbar = async(column: number) => {
    const cell = page.locator('.editor-component table tr').first().locator('th, td').nth(column)
    const box = await cell.boundingBox()
    if (!box) throw new Error('Expected table header bounds')
    await page.mouse.move(box.x + box.width / 2, box.y - 10)
    await page.waitForTimeout(80)
    await page.mouse.move(box.x + box.width / 2, box.y - 9)
    const tools = page.locator('.mu-table-column-tools').first()
    await expect.poll(() => tools.evaluate(element => Number.parseFloat((element.closest('.mu-float-wrapper') as HTMLElement).style.opacity || '0'))).toBeGreaterThan(0)
    return tools
  }
  const save = async(expected: string) => {
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
  }
  try {
    await (await toolbar(0)).locator('li.item.center').click()
    await save(source.replace('----', ':----:'))
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await save(source)
    await (await toolbar(1)).locator('li.item.remove').click()
    const removed = '- item\n\n  | first |\n  | ---- |\n  | {++cell++}{>>note<<} |\n'
    await save(removed)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await save(source)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await save(removed)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

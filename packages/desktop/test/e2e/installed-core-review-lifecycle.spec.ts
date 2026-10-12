import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import {
  clickMenuByLabelIfEnabled as menu,
  closeWithoutRendererErrors,
  enterSourceMode,
  exitSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  getRendererErrors,
  launchInstalled
} from './helpers'

const original = 'alpha {++beta++} omega.{>>old note<<}\n'
async function launch(second = false) {
  const root = test.info().outputPath('fixture')
  fs.mkdirSync(root, { recursive: true })
  const file = path.join(root, 'first.md')
  const other = path.join(root, 'second.md')
  fs.writeFileSync(file, original, { flag: 'wx' })
  if (second) fs.writeFileSync(other, 'Second document.\n', { flag: 'wx' })
  const { app, page } = await launchInstalled([file, ...(second ? [other] : [])], {
    userDataDir: path.join(root, 'profile')
  })
  await expectEditorWindowHidden(app)
  expectEditorNotFrontmost(app)
  if (second) await page.locator(`.tabs-container li[title="${file}"]`).click()
  return { app, page, file, other }
}
async function close(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => {
    // A failed case may leave a composer open; never show a real close prompt.
    dialog.showMessageBox = (async() => ({
      response: 0,
      checkboxChecked: false
    })) as typeof dialog.showMessageBox
  })
  await closeWithoutRendererErrors(app)
}
// A pointer on the comment marker only selects its entry (ADR 0004); Review →
// Edit Comment opens the composer, and with it the sidebar.
async function editMarkedComment(app: ElectronApplication, page: Page) {
  await page.locator('.mu-critic-comment-marker').click()
  await expect
    .poll(() =>
      app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('critic-edit-comment')?.enabled)
    )
    .toBe(true)
  await menu(app, 'Review', 'Edit Comment')
}

test('an unsubmitted comment survives switching tabs and commits through normal history and save', async() => {
  const { app, page, file, other } = await launch(true)
  try {
    await editMarkedComment(app, page)
    await page.getByTestId('critic-review-comment-input').fill('My pending **comment**')
    await page.locator(`.tabs-container li[title="${other}"]`).click()
    await expect(page.getByTestId('critic-review-comment-input')).toHaveCount(0)
    await page.locator(`.tabs-container li[title="${file}"]`).click()
    await expect(page.getByTestId('critic-review-comment-input')).toHaveValue(
      'My pending **comment**'
    )
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    await page.getByTestId('critic-review-comment-submit').click()
    const edited = 'alpha {++beta++} omega.{>>My pending **comment**<<}\n'
    await menu(app, 'File', 'Save')
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(edited)
    await menu(app, 'Edit', 'Undo')
    await menu(app, 'File', 'Save')
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(original)
    await menu(app, 'Edit', 'Redo')
    await menu(app, 'File', 'Save')
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(edited)
  } finally {
    await close(app)
  }
})

test('an unsubmitted comment survives Source handoff and refuses a changed target without losing its text', async() => {
  const { app, page, file } = await launch()
  try {
    await editMarkedComment(app, page)
    await page.getByTestId('critic-review-comment-input').fill('Retained across Source')
    await enterSourceMode(page, app)
    await expect(page.getByTestId('critic-review-comment-input')).toHaveCount(0)
    await exitSourceMode(page, app)
    await expect(page.getByTestId('critic-review-comment-input')).toHaveValue(
      'Retained across Source'
    )
    await enterSourceMode(page, app)
    await page.evaluate(() => {
      const element = document.querySelector('.source-code .CodeMirror') as Element & {
        CodeMirror: { setCursor(position: { line: number; ch: number }): void; focus(): void }
      }
      element.CodeMirror.setCursor({ line: 0, ch: 0 })
      element.CodeMirror.focus()
    })
    await page.keyboard.type('Changed ')
    await menu(app, 'File', 'Save')
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(`Changed ${original}`)
    await exitSourceMode(page, app)
    await expect(page.getByTestId('critic-review-comment-input')).toHaveValue(
      'Retained across Source'
    )
    await page.getByTestId('critic-review-comment-submit').click()
    await expect(page.getByTestId('critic-review-comment-error')).toContainText('document changed')
    await expect(page.getByTestId('critic-review-comment-input')).toHaveValue(
      'Retained across Source'
    )
    await page.getByTestId('critic-review-comment-cancel').click()
    await menu(app, 'File', 'Save')
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(`Changed ${original}`)
  } finally {
    await close(app)
  }
})

test('tab and window close ask before discarding a pending comment', async() => {
  const { app, page, file } = await launch()
  let closed = false
  try {
    await editMarkedComment(app, page)
    await page.getByTestId('critic-review-comment-input').fill('Do not discard me')
    await enterSourceMode(page, app)
    // The native confirmation is answered in main so no real dialog is shown.
    const answer = (response: number) =>
      app.evaluate(({ dialog }, response) => {
        const prompts: string[] = []
        ;(globalThis as unknown as { reviewClosePrompts: string[] }).reviewClosePrompts = prompts
        dialog.showMessageBox = (async(...args: unknown[]) => {
          const options = args.find(
            (arg) => arg !== null && typeof arg === 'object' && 'message' in arg
          ) as { message: string }
          prompts.push(options.message)
          return { response, checkboxChecked: false }
        }) as typeof dialog.showMessageBox
      }, response)
    const closeWindow = async(response: number) => {
      await answer(response)
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().includes('type=editor')
        )
        if (!win) throw new Error('Editor window is missing')
        win.close()
      })
    }
    const prompts = () =>
      app.evaluate(
        () => (globalThis as unknown as { reviewClosePrompts: string[] }).reviewClosePrompts
      )

    // Cancelling the tab close keeps the tab and its unsubmitted comment.
    await answer(1)
    await menu(app, 'File', 'Close Tab')
    await expect.poll(prompts).toEqual([expect.stringContaining('comment')])
    await expect(page.locator(`.tabs-container li[title="${file}"]`)).toHaveCount(1)

    await closeWindow(1)
    await expect.poll(prompts).toEqual([expect.stringContaining('comment')])
    await expect(page.locator(`.tabs-container li[title="${file}"]`)).toHaveCount(1)
    await exitSourceMode(page, app)
    await expect(page.getByTestId('critic-review-comment-input')).toHaveValue('Do not discard me')

    // MarkText quits once its last window closes, even on macOS, so the
    // renderer errors are read first and the discard is observed as that exit.
    expect(await getRendererErrors(app)).toEqual([])
    const exited = new Promise<void>((resolve) => app.once('close', () => resolve()))
    await closeWindow(0)
    await exited
    closed = true
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
  } finally {
    if (closed) await app.close()
    else await close(app)
  }
})

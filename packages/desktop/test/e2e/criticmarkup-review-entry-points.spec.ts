import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

// The vision requires that selecting text exposes the review authoring actions
// through the selection tools, the context menu and the menu bar, whatever
// gesture made the selection.
const source = 'First paragraph with words.\n\nSecond paragraph here.\n'
const env = { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
const authoring = ['add-comment', 'mark-highlight', 'mark-addition', 'suggest-replacement']

const paragraphs = (page: Page) => page.locator('.editor-component .mu-paragraph-content')

const drag = async(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
}

const gestures: Array<{ name: string; crossParagraph: boolean; select(page: Page): Promise<void> }> = [
  {
    name: 'mouse drag within a paragraph',
    crossParagraph: false,
    async select(page) {
      const box = (await paragraphs(page).first().boundingBox())!
      await drag(page, { x: box.x + 2, y: box.y + box.height / 2 }, { x: box.x + box.width * 0.6, y: box.y + box.height / 2 })
    }
  },
  {
    name: 'double-click a word',
    crossParagraph: false,
    async select(page) {
      const box = (await paragraphs(page).first().boundingBox())!
      await page.mouse.dblclick(box.x + 60, box.y + box.height / 2)
    }
  },
  {
    name: 'mouse drag across paragraphs',
    crossParagraph: true,
    async select(page) {
      const a = (await paragraphs(page).first().boundingBox())!
      const b = (await paragraphs(page).nth(1).boundingBox())!
      await drag(page, { x: a.x + 2, y: a.y + a.height / 2 }, { x: b.x + b.width * 0.5, y: b.y + b.height / 2 })
    }
  },
  {
    name: 'Shift+arrows across paragraphs',
    crossParagraph: true,
    async select(page) {
      await paragraphs(page).first().click()
      await page.keyboard.press('Meta+ArrowLeft')
      await page.keyboard.press('Shift+ArrowDown')
      await page.keyboard.press('Shift+ArrowDown')
    }
  },
  {
    name: 'select all',
    crossParagraph: true,
    async select(page) {
      await paragraphs(page).first().click()
      await page.keyboard.press('Meta+a')
    }
  }
]

const captureContextMenu = (app: ElectronApplication) =>
  app.evaluate(({ Menu, BrowserWindow }) => {
    const state = globalThis as unknown as {
      entryContextTop?: Record<string, boolean>
      entryContextClick?: (id: string) => void
    }
    state.entryContextTop = undefined
    Menu.prototype.popup = function() {
      state.entryContextTop = Object.fromEntries(
        this.items.filter(item => item.id?.startsWith('critic-')).map(item => [item.id, item.enabled])
      )
      state.entryContextClick = (id) => {
        const item = this.items.find(candidate => candidate.id === id)
        const win = BrowserWindow.getAllWindows()[0]
        if (!item?.enabled) throw new Error(`Unavailable context action: ${id}`)
        item.click(undefined, win, win.webContents)
      }
    }
  })

const contextTop = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { entryContextTop?: Record<string, boolean> }).entryContextTop)

const reviewMenu = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => {
    const top = Menu.getApplicationMenu()?.items.find(item => item.submenu?.getMenuItemById('critic-add-comment') && item.submenu.items.some(child => child.id === 'critic-add-comment'))
    return top ? { label: top.label, addComment: top.submenu!.getMenuItemById('critic-add-comment')!.enabled } : null
  })

const toolbarState = (page: Page) =>
  page.evaluate(() => {
    const picker = document.querySelector('.mu-format-picker')
    const float = picker?.parentElement
    return {
      visible: float ? getComputedStyle(float).opacity === '1' : false,
      review: Array.from(picker?.querySelectorAll<HTMLButtonElement>('button[data-action]') ?? [])
        .filter(button => button.offsetParent !== null)
        .map(button => `${button.dataset.action}:${button.disabled ? 'off' : 'on'}`),
      formatting: Array.from(picker?.querySelectorAll<HTMLElement>('li.item') ?? []).filter(item => item.offsetParent !== null).length
    }
  })

for (const gesture of gestures) {
  test(`${gesture.name} exposes review authoring in the toolbar, context menu and Review menu`, async() => {
    const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
    try {
      await captureContextMenu(app)
      await gesture.select(page)
      const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
      expect(selected.trim().length).toBeGreaterThan(0)

      await expect.poll(() => reviewMenu(app)).toEqual({ label: 'Review', addComment: true })

      await expect.poll(() => toolbarState(page)).toMatchObject({
        visible: true,
        review: authoring.map(id => `${id}:on`)
      })
      if (gesture.crossParagraph) expect((await toolbarState(page)).formatting).toBe(0)

      const rect = await page.evaluate(() => {
        const range = window.getSelection()!.getRangeAt(0).getClientRects()[0]
        return { x: range.left + 3, y: range.top + range.height / 2 }
      })
      await page.mouse.click(rect.x, rect.y, { button: 'right' })
      await expect.poll(() => contextTop(app)).toMatchObject(
        Object.fromEntries(authoring.map(id => [`critic-${id}`, true]))
      )
      await expectEditorWindowHidden(app)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

const entryPoints: Array<{ name: string; invoke(app: ElectronApplication, page: Page): Promise<void> }> = [
  {
    name: 'selection toolbar',
    async invoke(_app, page) {
      await page.locator('.mu-format-picker button[data-action="add-comment"]').click()
    }
  },
  {
    name: 'context menu',
    async invoke(app, page) {
      const rect = await page.evaluate(() => {
        const range = window.getSelection()!.getRangeAt(0).getClientRects()[0]
        return { x: range.left + 3, y: range.top + range.height / 2 }
      })
      await page.mouse.click(rect.x, rect.y, { button: 'right' })
      await expect.poll(() => contextTop(app)).toMatchObject({ 'critic-add-comment': true })
      await app.evaluate(() =>
        (globalThis as unknown as { entryContextClick: (id: string) => void }).entryContextClick('critic-add-comment'))
    }
  },
  {
    name: 'Review menu',
    async invoke(app) {
      await app.evaluate(({ Menu, BrowserWindow }) => {
        const item = Menu.getApplicationMenu()!.getMenuItemById('critic-add-comment')!
        const win = BrowserWindow.getAllWindows()[0]
        if (!item.enabled) throw new Error('Add Comment is disabled')
        item.click(undefined, win, win.webContents)
      })
    }
  }
]

for (const entry of entryPoints) {
  for (const gesture of [gestures[0], gestures[3]]) {
    test(`Add Comment from the ${entry.name} after ${gesture.name} saves, undoes and redoes`, async() => {
      const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
      try {
        await captureContextMenu(app)
        await gesture.select(page)
        await expect.poll(() => reviewMenu(app)).toMatchObject({ addComment: true })
        await entry.invoke(app, page)
        const input = page.getByTestId('critic-review-comment-input')
        await expect(input).toBeVisible()
        await input.fill('Entry note')
        await page.getByTestId('critic-review-comment-submit').click()
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('{>>Entry note<<}')
        const commented = readFileSync(filePath, 'utf8')
        expect(commented).toContain('{==')
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(commented)
        await expectEditorWindowHidden(app)
        await expectNoRendererErrors(app)
      } finally {
        await app.close()
      }
    })
  }
}

import { expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { readFileSync } from 'node:fs'
import { sendIpcToRenderer } from './helpers'

/** Review authoring commands in Review-menu order. */
export const authoringForms = ['add-comment', 'mark-highlight', 'mark-addition', 'suggest-replacement'] as const
export type AuthoringForm = typeof authoringForms[number]

export const hiddenCoreEnv = { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }

/** The viewport point at `where` within the first rendered occurrence of `text`. */
export const textPoint = async(
  page: Page,
  text: string,
  where: 'start' | 'end' | number
): Promise<{ x: number; y: number }> => {
  const point = await page.evaluate(({ text, where }) => {
    const root = document.querySelector('.editor-component')!
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const index = node.textContent!.indexOf(text)
      if (index < 0) continue
      const offset = where === 'start' ? index : where === 'end' ? index + text.length : index + where
      const range = document.createRange()
      const ch = Math.min(offset, node.textContent!.length - 1)
      range.setStart(node, ch)
      range.setEnd(node, ch + 1)
      const rect = range.getBoundingClientRect()
      // A block's drag handle, shown once the pointer hovers the block, overlaps
      // its first letter's leftmost pixel, so a start is aimed a little inside
      // the letter's left half, where the caret still lands before it.
      const inset = where === 'start' ? Math.max(0.5, Math.min(3, rect.width / 2 - 0.5)) : 0.5
      const x = offset > ch ? rect.right - 0.5 : rect.left + inset
      return { x, y: rect.top + rect.height / 2 }
    }
    return null
  }, { text, where })
  if (!point) throw new Error(`Rendered text not found: ${text}`)
  return point
}

export const drag = async(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

/**
 * Waits for the editor's next rendered frame, where Muya commits a click. A
 * user cannot press a key before it; a test can.
 */
export const nextFrame = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

export const clickText = async(page: Page, text: string, where: 'start' | 'end' | number): Promise<void> => {
  const point = await textPoint(page, text, where)
  await page.mouse.click(point.x, point.y)
  await nextFrame(page)
}

/**
 * Presses a key through Electron's native input path, so menu accelerators and
 * before-input shortcuts run as they do for a user's keyboard.
 */
export const nativeKey = async(
  app: ElectronApplication,
  keyCode: string,
  modifiers: string[] = [],
  holdMs = 0
): Promise<void> => {
  await app.evaluate(async({ BrowserWindow }, { keyCode, modifiers, holdMs }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: modifiers as never })
    if (holdMs > 0) await new Promise(resolve => setTimeout(resolve, holdMs))
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: modifiers as never })
  }, { keyCode, modifiers, holdMs })
}

export const menuStates = (app: ElectronApplication, ids: readonly string[]) =>
  app.evaluate(({ Menu }, ids) => Object.fromEntries(ids.map(id => [
    id,
    Menu.getApplicationMenu()?.getMenuItemById(`critic-${id}`)?.enabled ?? null
  ])), ids)

/** Visible selection-toolbar state: `<action>:on|off` for each review action. */
export const toolbarState = (page: Page) =>
  page.evaluate(() => {
    const picker = document.querySelector('.mu-format-picker')
    const float = picker?.parentElement
    const style = float ? getComputedStyle(float) : undefined
    return {
      visible: style !== undefined && style.opacity === '1' && style.display !== 'none',
      review: Array.from(picker?.querySelectorAll<HTMLElement>('[data-action]') ?? [])
        .filter(item => item.offsetParent !== null)
        .map(item => `${item.dataset.action}:${item.getAttribute('aria-disabled') === 'true' ? 'off' : 'on'}`),
      formatting: Array.from(picker?.querySelectorAll<HTMLElement>('li.item:not([data-action])') ?? [])
        .filter(item => item.offsetParent !== null).length
    }
  })

/** Clicks a Review menu item once it is enabled, as a user would wait to. */
export const clickReviewMenu = async(app: ElectronApplication, id: string): Promise<void> => {
  await expect.poll(async() => (await menuStates(app, [id]))[id], { message: `Review → ${id}` }).toBe(true)
  await app.evaluate(({ Menu, BrowserWindow }, id) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById(`critic-${id}`)!
    const win = BrowserWindow.getAllWindows()[0]
    if (!item.enabled) throw new Error(`Review → ${id} is disabled`)
    item.click(undefined, win, win.webContents)
  }, id)
}

/** Replaces the native context menu popup so its items can be read and clicked. */
export const captureContextMenu = (app: ElectronApplication) =>
  app.evaluate(({ Menu, BrowserWindow }) => {
    const state = globalThis as unknown as {
      reviewContextItems?: Record<string, boolean>
      reviewContextClick?: (id: string) => void
    }
    state.reviewContextItems = undefined
    Menu.prototype.popup = function(options?: { callback?: () => void }) {
      state.reviewContextItems = Object.fromEntries(
        this.items.filter(item => item.id?.startsWith('critic-')).map(item => [item.id, item.enabled])
      )
      state.reviewContextClick = (id) => {
        const item = this.items.find(candidate => candidate.id === id)
        const win = BrowserWindow.getAllWindows()[0]
        if (!item?.enabled) throw new Error(`Unavailable context action: ${id}`)
        item.click(undefined, win, win.webContents)
        options?.callback?.()
      }
    }
  })

export const resetContextMenu = (app: ElectronApplication) =>
  app.evaluate(() => { (globalThis as unknown as { reviewContextItems?: unknown }).reviewContextItems = undefined })

export const contextMenuItems = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { reviewContextItems?: Record<string, boolean> }).reviewContextItems)

export const clickContextMenu = (app: ElectronApplication, id: string) =>
  app.evaluate((_electron, id) =>
    (globalThis as unknown as { reviewContextClick: (id: string) => void }).reviewContextClick(id), id)

/** A point inside the first rectangle of the current DOM selection. */
export const selectionPoint = (page: Page) =>
  page.evaluate(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    const rect = Array.from(range.getClientRects()).find(item => item.width > 2) ?? range.getBoundingClientRect()
    return { x: rect.left + Math.min(4, Math.max(1, rect.width / 2)), y: rect.top + rect.height / 2 }
  })

export const paletteLabels: Record<string, string> = {
  'add-comment': 'Review: Add Comment',
  'mark-highlight': 'Review: Highlight for Review',
  'mark-addition': 'Review: Mark as Addition',
  'suggest-replacement': 'Review: Suggest Replacement',
  next: 'Review: Next Change',
  'track-changes': 'Review: Toggle Track Changes'
}

export const openPaletteAt = async(app: ElectronApplication, page: Page, label: string): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::show-command-palette')
  const input = page.locator('.command-palette input.search')
  await input.waitFor({ state: 'visible' })
  await input.pressSequentially(label)
  await expect(page.locator('.command-palette li').first()).toContainText(label)
}

export const sidebarState = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.side-bar')
    const shown = !!bar && getComputedStyle(bar).display !== 'none' && bar.getBoundingClientRect().width > 0
    const active = document.querySelector('.side-bar .left-column li.active')?.getAttribute('aria-label') ?? ''
    return { shown, active }
  })

export const focusInDocument = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest('.editor-component'))

/** Saves until the file holds `expected`; a command may still be applying its change. */
export const expectSaved = async(app: ElectronApplication, filePath: string, expected: string): Promise<void> => {
  await expect.poll(async() => {
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    return readFileSync(filePath, 'utf8')
  }).toBe(expected)
}

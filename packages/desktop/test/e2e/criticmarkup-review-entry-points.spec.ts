import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'
import {
  authoringForms,
  captureContextMenu as captureReviewContextMenu,
  clickContextMenu,
  clickReviewMenu,
  clickText,
  contextMenuItems,
  drag as dragText,
  menuStates,
  nativeKey,
  openPaletteAt,
  paletteLabels,
  resetContextMenu,
  selectionPoint,
  textPoint,
  toolbarState as reviewToolbarState,
  type AuthoringForm
} from './reviewGestures'

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
      review: Array.from(picker?.querySelectorAll<HTMLElement>('[data-action]') ?? [])
        .filter(item => item.offsetParent !== null)
        .map(item => `${item.dataset.action}:${item.getAttribute('aria-disabled') === 'true' ? 'off' : 'on'}`),
      formatting: Array.from(picker?.querySelectorAll<HTMLElement>('li.item:not([data-action])') ?? []).filter(item => item.offsetParent !== null).length
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

// Every selection gesture × entry point × authoring form, executed end to end:
// the saved bytes wrap exactly the selected source, and ⌘Z through the real
// keyboard path restores the file.
const matrixSource = [
  '# Heading one',
  '',
  'First paragraph with words.',
  '',
  'Second paragraph here.',
  '',
  '- item one',
  '- item two',
  '',
  '> quoted text here',
  '',
  '| Col A | Col B |',
  '| ----- | ----- |',
  '| cell one | cell two |',
  '',
  'Last line of text.',
  ''
].join('\n')

interface MatrixGesture {
  name: string
  /** The source the selection covers, when a single block makes it certain. */
  selects?: string
  select(page: Page, app: ElectronApplication): Promise<void>
}

const lineStart = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'
const matrixGestures: MatrixGesture[] = [
  {
    name: 'drag within a paragraph',
    selects: 'paragraph with',
    async select(page) { await dragText(page, await textPoint(page, 'paragraph with', 'start'), await textPoint(page, 'paragraph with', 'end')) }
  },
  {
    name: 'double-click',
    selects: 'paragraph',
    async select(page) { const point = await textPoint(page, 'paragraph with', 3); await page.mouse.dblclick(point.x, point.y) }
  },
  {
    name: 'triple-click',
    selects: 'First paragraph with words.',
    async select(page) { const point = await textPoint(page, 'paragraph with', 3); await page.mouse.click(point.x, point.y, { clickCount: 3 }) }
  },
  {
    name: 'Shift+Right',
    selects: 'parag',
    async select(page) { await clickText(page, 'paragraph with', 'start'); for (let step = 0; step < 5; step++) await page.keyboard.press('Shift+ArrowRight') }
  },
  {
    name: 'Shift+Alt+Right',
    selects: 'paragraph',
    async select(page) { await clickText(page, 'paragraph with', 'start'); await page.keyboard.press('Shift+Alt+ArrowRight') }
  },
  {
    name: 'Shift+Cmd+Right',
    selects: 'paragraph with words.',
    async select(page) { await clickText(page, 'paragraph with', 'start'); await page.keyboard.press(process.platform === 'darwin' ? 'Shift+Meta+ArrowRight' : 'Shift+End') }
  },
  {
    name: 'Shift+Down into the next paragraph',
    async select(page) { await clickText(page, 'paragraph with', 3); await page.keyboard.press('Shift+ArrowDown') }
  },
  {
    name: 'Shift+Down ending at the next paragraph start',
    async select(page) { await clickText(page, 'First paragraph', 3); await page.keyboard.press(lineStart); await page.keyboard.press('Shift+ArrowDown') }
  },
  {
    name: 'drag across paragraphs',
    async select(page) { await dragText(page, await textPoint(page, 'paragraph with', 'start'), await textPoint(page, 'paragraph here', 4)) }
  },
  {
    name: 'drag within a heading',
    selects: 'Heading',
    async select(page) { await dragText(page, await textPoint(page, 'Heading one', 'start'), await textPoint(page, 'Heading one', 7)) }
  },
  {
    name: 'drag within a list item',
    selects: 'item one',
    async select(page) { await dragText(page, await textPoint(page, 'item one', 'start'), await textPoint(page, 'item one', 'end')) }
  },
  {
    name: 'drag within a quote',
    selects: 'quoted text',
    async select(page) { await dragText(page, await textPoint(page, 'quoted text', 'start'), await textPoint(page, 'quoted text', 'end')) }
  },
  {
    name: 'drag within a table cell',
    selects: 'cell one',
    async select(page) { await dragText(page, await textPoint(page, 'cell one', 'start'), await textPoint(page, 'cell one', 'end')) }
  },
  {
    name: 'Select All through the menu accelerator',
    selects: 'First paragraph with words.',
    // A person releases ⌘A after the menu command reaches the editor.
    async select(page, app) { await clickText(page, 'paragraph with', 3); await nativeKey(app, 'A', ['meta'], 150) }
  }
]

const matrixEntries = ['toolbar', 'context menu', 'Review menu', 'palette', 'shortcut'] as const
type MatrixEntry = typeof matrixEntries[number]
// Only Add Comment has a default shortcut (plan 0012 G33).
const shortcuts: Partial<Record<AuthoringForm, [string, string[]]>> = {
  'add-comment': ['M', ['meta', 'alt', 'shift']]
}

const wrapping: Record<AuthoringForm, { open: string; close: string; composer?: { testId: string; text: string } }> = {
  'add-comment': { open: '{==', close: '==}{>>Matrix note<<}', composer: { testId: 'critic-review-comment', text: 'Matrix note' } },
  'mark-highlight': { open: '{==', close: '==}' },
  'mark-addition': { open: '{++', close: '++}' },
  'suggest-replacement': { open: '{~~', close: '~>NEW~~}', composer: { testId: 'critic-review-replacement', text: 'NEW' } }
}

/** The source slice `saved` wraps in `form`'s markup, when it wraps exactly one. */
const wrappedSlice = (saved: string, form: AuthoringForm): string | undefined => {
  let start = 0
  while (start < saved.length && saved[start] === matrixSource[start]) start++
  const { open, close } = wrapping[form]
  if (!saved.startsWith(open, start)) return undefined
  const end = saved.indexOf(close, start + open.length)
  if (end < 0) return undefined
  const slice = saved.slice(start + open.length, end)
  const expected = matrixSource.slice(0, start) + open + slice + close + matrixSource.slice(start + slice.length)
  return slice !== '' && saved === expected && matrixSource.slice(start, start + slice.length) === slice ? slice : undefined
}

const invokeEntry = async(app: ElectronApplication, page: Page, entry: MatrixEntry, form: AuthoringForm) => {
  switch (entry) {
    case 'toolbar':
      await expect.poll(async() => {
        const state = await reviewToolbarState(page)
        return state.visible && state.review.includes(`${form}:on`)
      }, { message: `toolbar offers ${form}` }).toBe(true)
      await page.locator(`.mu-format-picker [data-action="${form}"]`).click()
      return
    case 'context menu': {
      const point = await selectionPoint(page)
      if (!point) throw new Error('No selection to right-click')
      await resetContextMenu(app)
      await page.mouse.click(point.x, point.y, { button: 'right' })
      await expect.poll(async() => (await contextMenuItems(app))?.[`critic-${form}`]).toBe(true)
      await clickContextMenu(app, `critic-${form}`)
      return
    }
    case 'Review menu':
      await clickReviewMenu(app, form)
      return
    case 'palette':
      await openPaletteAt(app, page, paletteLabels[form])
      await page.keyboard.press('Enter')
      return
    case 'shortcut': {
      const [key, modifiers] = shortcuts[form]!
      await nativeKey(app, key, modifiers)
    }
  }
}

/** Saves until the file satisfies `done`; a command may still be applying its change. */
const savedAfter = async(app: ElectronApplication, filePath: string, done: (text: string) => boolean) => {
  await expect.poll(async() => {
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    return done(readFileSync(filePath, 'utf8'))
  }).toBe(true)
  return readFileSync(filePath, 'utf8')
}

for (const gesture of matrixGestures) {
  test(`review authoring after ${gesture.name} works from every entry point`, async() => {
    test.setTimeout(240000)
    const { app, page, filePath } = await launchWithMarkdown(matrixSource, { suppressErrorDialog: true, env })
    try {
      await captureReviewContextMenu(app)
      const slices = new Set<string>()
      for (const entry of matrixEntries) {
        for (const form of authoringForms) {
          if (entry === 'shortcut' && shortcuts[form] === undefined) continue
          const label = `${gesture.name} → ${entry} → ${form}`
          // Collapse the previous selection away from the text a drag starts on,
          // and let the editor commit it before the next gesture.
          await clickText(page, 'Last line', 'end')
          await expect.poll(async() => (await menuStates(app, [form]))[form], { message: label }).toBe(false)
          await gesture.select(page, app)
          await expect.poll(async() => (await menuStates(app, [form]))[form], { message: label }).toBe(true)
          const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
          await invokeEntry(app, page, entry, form)
          const composer = wrapping[form].composer
          if (composer) {
            const input = page.getByTestId(`${composer.testId}-input`)
            await expect(input, label).toBeFocused()
            await input.fill(composer.text)
            await page.getByTestId(`${composer.testId}-submit`).click()
          }
          const saved = await savedAfter(app, filePath, text => text !== matrixSource)
          const slice = wrappedSlice(saved, form)
          expect(slice, `${label}: ${JSON.stringify(saved)}`).toBeDefined()
          if (gesture.selects !== undefined) expect(slice, label).toBe(gesture.selects)
          else expect(selected.length, label).toBeGreaterThan(0)
          slices.add(slice!)
          await nativeKey(app, 'Z', ['meta'])
          await savedAfter(app, filePath, text => text === matrixSource)
        }
      }
      // Every entry point and form addresses the same selected source.
      expect([...slices]).toHaveLength(1)
      await expectEditorWindowHidden(app)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

import { expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  assertBackgroundRuntimePolicy,
  closeElectron,
  isBackgroundTestRun,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

export async function launchDocumentCore(markdown: string) {
  return launchWithMarkdown(markdown)
}

export async function launchDocumentCoreWithKeybindings(
  markdown: string,
  userKeybindings: Readonly<Record<string, string>>
) {
  return launchWithMarkdown(markdown, { userKeybindings })
}

export async function closeDocumentCore(
  app: ElectronApplication | undefined
): Promise<void> {
  if (app !== undefined) await closeElectron(app)
}

export async function selectDomText(
  page: Page,
  startNeedle: string,
  endNeedle = startNeedle
): Promise<string> {
  const selected = await page.evaluate(({ startText, endText }) => {
    const root = document.querySelector('.editor-component') as HTMLElement | null
    if (root === null) return null
    const nodes: Text[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    const startNode = nodes.find((node) => node.data.includes(startText))
    const endNode = [...nodes].reverse().find((node) => node.data.includes(endText))
    if (startNode === undefined || endNode === undefined) return null
    const start = startNode.data.indexOf(startText)
    const end = endNode.data.lastIndexOf(endText) + endText.length
    const range = document.createRange()
    range.setStart(startNode, start)
    range.setEnd(endNode, end)
    const selection = window.getSelection()
    if (selection === null) return null
    root.focus()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    root.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true
    }))
    return selection.toString()
  }, { startText: startNeedle, endText: endNeedle })
  if (selected === null) {
    throw new Error(
      `Could not select ${JSON.stringify(startNeedle)}…${JSON.stringify(endNeedle)}`
    )
  }
  await page.waitForTimeout(180)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  return selected
}

const publicSelectionText = (page: Page): Promise<string> =>
  page.evaluate(() => window.getSelection()?.toString() ?? '')

export async function selectTextByKeyboard(
  page: Page,
  lineText: string,
  selectedText: string
): Promise<void> {
  const selectedStart = lineText.indexOf(selectedText)
  if (selectedStart < 0) {
    throw new Error(
      `${JSON.stringify(selectedText)} is not present in ${JSON.stringify(lineText)}`
    )
  }

  const line = page.locator('.document-view-paragraph').filter({
    hasText: lineText
  }).first()
  await expect(line).toBeVisible()
  await line.click()
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'
  )
  for (let offset = 0; offset < selectedStart; offset += 1) {
    await page.keyboard.press('ArrowRight')
  }
  for (let offset = 0; offset < selectedText.length; offset += 1) {
    await page.keyboard.press('Shift+ArrowRight')
  }
  await expect.poll(() => publicSelectionText(page)).toBe(selectedText)
  await page.waitForTimeout(180)
}

const toPlaywrightAccelerator = (accelerator: string): string => {
  const platformCommand = process.platform === 'darwin' ? 'Meta' : 'Control'
  const token = (value: string): string => {
    switch (value.toLowerCase()) {
      case 'cmdorctrl':
      case 'commandorcontrol':
        return platformCommand
      case 'cmd':
      case 'command':
        return 'Meta'
      case 'ctrl':
      case 'control':
        return 'Control'
      case 'option':
      case 'alt':
        return 'Alt'
      case 'shift':
        return 'Shift'
      default:
        return value
    }
  }
  return accelerator.split('+').map(token).join('+')
}

interface ObservedElectronKeyInput {
  readonly type: string
  readonly key: string
  readonly code: string
  readonly alt: boolean
  readonly control: boolean
  readonly meta: boolean
  readonly shift: boolean
}

interface ElectronInputObservation {
  readonly webContentsId: number
  readonly offset: number
}

type ElectronInputModifier = 'alt' | 'control' | 'meta' | 'shift'

interface AcceleratorStroke {
  readonly keyCode: string
  readonly modifiers: readonly ElectronInputModifier[]
  readonly alt: boolean
  readonly control: boolean
  readonly meta: boolean
  readonly shift: boolean
}

const observeElectronInput = async(
  app: ElectronApplication,
  page: Page
): Promise<ElectronInputObservation> => {
  const pageUrl = page.url()
  return await app.evaluate(({ BrowserWindow }, url) => {
    const windows = BrowserWindow.getAllWindows()
      .filter(window => !window.isDestroyed())
    const target = windows.find(window =>
      window.webContents.getURL() === url
    ) ?? (windows.length === 1 ? windows[0] : undefined)
    if (target === undefined) {
      throw new Error(`No Electron input target owns ${url}`)
    }
    const state = global as unknown as {
      __mt_e2e_before_input_events__?: Record<
        number,
        ObservedElectronKeyInput[]
      >
    }
    state.__mt_e2e_before_input_events__ ??= {}
    const id = target.webContents.id
    let events = state.__mt_e2e_before_input_events__[id]
    if (events === undefined) {
      events = []
      state.__mt_e2e_before_input_events__[id] = events
      target.webContents.on('before-input-event', (_event, input) => {
        events.push({
          type: input.type,
          key: input.key,
          code: input.code,
          alt: input.alt,
          control: input.control,
          meta: input.meta,
          shift: input.shift
        })
      })
    }
    return {
      webContentsId: id,
      offset: events.length
    }
  }, pageUrl)
}

const electronInputsSince = async(
  app: ElectronApplication,
  observation: ElectronInputObservation
): Promise<readonly ObservedElectronKeyInput[]> =>
  await app.evaluate((_electron, marker) => {
    const state = global as unknown as {
      __mt_e2e_before_input_events__?: Record<
        number,
        ObservedElectronKeyInput[]
      >
    }
    return (
      state.__mt_e2e_before_input_events__?.[marker.webContentsId] ?? []
    ).slice(marker.offset)
  }, observation)

const acceleratorStroke = (accelerator: string): AcceleratorStroke => {
  const tokens = toPlaywrightAccelerator(accelerator).split('+')
  const keyCode = tokens.at(-1)
  if (keyCode === undefined || keyCode.length === 0) {
    throw new TypeError(`Accelerator ${accelerator} has no physical key`)
  }
  const modifiers = new Set(tokens.slice(0, -1))
  const electronModifiers: ElectronInputModifier[] = []
  if (modifiers.has('Alt')) electronModifiers.push('alt')
  if (modifiers.has('Control')) electronModifiers.push('control')
  if (modifiers.has('Meta')) electronModifiers.push('meta')
  if (modifiers.has('Shift')) electronModifiers.push('shift')
  return {
    keyCode,
    modifiers: electronModifiers,
    alt: modifiers.has('Alt'),
    control: modifiers.has('Control'),
    meta: modifiers.has('Meta'),
    shift: modifiers.has('Shift')
  }
}

const matchesStroke = (
  input: ObservedElectronKeyInput,
  stroke: AcceleratorStroke,
  type: 'keyDown' | 'keyUp'
): boolean =>
  input.type === type &&
  input.key.toLocaleLowerCase() === stroke.keyCode.toLocaleLowerCase() &&
  input.alt === stroke.alt &&
  input.control === stroke.control &&
  input.meta === stroke.meta &&
  input.shift === stroke.shift

/**
 * Choose the physical input path before emitting the stroke. A hidden window
 * can deliver Playwright's CDP event to the DOM without emitting Electron's
 * `before-input-event`, so background runs use WebContents and interactive
 * runs use Playwright. No command callback is invoked directly: localshortcut,
 * CommandManager, and renderer dispatch all remain under test.
 */
const prepareAccelerator = async(
  page: Page,
  app: ElectronApplication,
  accelerator: string
): Promise<() => Promise<void>> => {
  const stroke = acceleratorStroke(accelerator)
  const observation = await observeElectronInput(app, page)
  if (isBackgroundTestRun) {
    await assertBackgroundRuntimePolicy(app)
  } else {
    await page.bringToFront()
  }
  return async() => {
    let emittedStrokeTypes: readonly ['keyDown', 'keyUp']
    if (isBackgroundTestRun) {
      const emit = async(type: 'keyDown' | 'keyUp') =>
        await app.evaluate(({ BrowserWindow }, payload) => {
          const target = BrowserWindow.getAllWindows().find(window =>
            !window.isDestroyed() &&
            window.webContents.id === payload.webContentsId
          )
          if (target === undefined) {
            throw new Error(
              `Electron input target ${payload.webContentsId} was destroyed`
            )
          }
          target.webContents.sendInputEvent({
            type: payload.type,
            keyCode: payload.keyCode,
            modifiers: [...payload.modifiers]
          })
          return payload.type
        }, {
          type,
          webContentsId: observation.webContentsId,
          keyCode: stroke.keyCode,
          modifiers: stroke.modifiers
        })
      const keyDown = await emit('keyDown')
      const keyUp = await emit('keyUp')
      if (keyDown !== 'keyDown' || keyUp !== 'keyUp') {
        throw new Error('Electron did not accept one complete physical stroke')
      }
      emittedStrokeTypes = [
        keyDown,
        keyUp
      ]
    } else {
      await page.keyboard.press(toPlaywrightAccelerator(accelerator))
      emittedStrokeTypes = ['keyDown', 'keyUp']
    }
    expect(emittedStrokeTypes).toEqual(['keyDown', 'keyUp'])

    await expect.poll(async() => {
      const inputs = await electronInputsSince(app, observation)
      return inputs
        .filter(input => matchesStroke(input, stroke, 'keyDown'))
        .map(input => input.type)
    }).toEqual(['keyDown'])
  }
}

const pressAccelerator = async(
  page: Page,
  app: ElectronApplication,
  accelerator: string
): Promise<void> => {
  const press = await prepareAccelerator(page, app, accelerator)
  await press()
}

export const pressUserKeybinding = async(
  page: Page,
  app: ElectronApplication,
  accelerator: string
): Promise<void> => {
  await pressAccelerator(page, app, accelerator)
}

export async function applicationMenuAccelerator(
  app: ElectronApplication,
  menuId: string
): Promise<string> {
  return app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id)
    if (item === undefined || item === null) {
      throw new Error(`Application menu item ${id} is unavailable`)
    }
    if (typeof item.accelerator !== 'string' || item.accelerator.length === 0) {
      throw new Error(`Application menu item ${id} has no accelerator`)
    }
    return item.accelerator
  }, menuId)
}

export async function pressApplicationMenuAccelerator(
  page: Page,
  app: ElectronApplication,
  menuId: string
): Promise<void> {
  await expect.poll(() => reviewMenuEnabled(app, menuId)).toBe(true)
  const accelerator = await applicationMenuAccelerator(app, menuId)
  await pressAccelerator(page, app, accelerator)
}

/**
 * Authenticate one menu-owned physical stroke before a timing-sensitive
 * browser gesture. The returned function emits the already-resolved stroke;
 * it performs no menu lookup, enablement poll, focus change, or input-observer
 * setup between that gesture and keyDown.
 */
export async function prepareApplicationMenuAccelerator(
  page: Page,
  app: ElectronApplication,
  menuId: string
): Promise<() => Promise<void>> {
  await expect.poll(() => reviewMenuEnabled(app, menuId)).toBe(true)
  const accelerator = await applicationMenuAccelerator(app, menuId)
  return prepareAccelerator(page, app, accelerator)
}

export async function placeCaretAfter(
  page: Page,
  needle: string
): Promise<void> {
  const placed = await page.evaluate((text) => {
    const root = document.querySelector('.editor-component') as HTMLElement | null
    if (root === null) return false
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const index = node.data.indexOf(text)
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index + text.length)
      range.collapse(true)
      const selection = window.getSelection()
      if (selection === null) return false
      root.focus()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return true
    }
    return false
  }, needle)
  if (!placed) throw new Error(`Could not place a caret after ${JSON.stringify(needle)}`)
  await page.waitForTimeout(180)
}

export async function pointForText(
  page: Page,
  needle: string
): Promise<Readonly<{ x: number; y: number }>> {
  const point = await page.evaluate((text) => {
    const root = document.querySelector('.editor-component')
    if (root === null) return null
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const index = node.data.indexOf(text)
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + text.length)
      const rect = range.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
    return null
  }, needle)
  if (point === null) throw new Error(`Could not locate ${JSON.stringify(needle)}`)
  return point
}

export async function selectWordByPointer(
  page: Page,
  needle: string
): Promise<void> {
  const point = await pointForText(page, needle)
  await page.mouse.dblclick(point.x, point.y)
  await expect.poll(() => publicSelectionText(page)).toBe(needle)
  await page.waitForTimeout(180)
}

export async function openReviewSidebar(
  page: Page,
  app: ElectronApplication
): Promise<void> {
  const sideBar = page.locator('.side-bar')
  const review = page.locator('.side-bar-review')
  if (await review.isVisible()) return
  if (!(await sideBar.isVisible())) {
    await pressApplicationMenuAccelerator(page, app, 'sideBarMenuItem')
    await expect(sideBar).toBeVisible()
  }
  await page.locator('.side-bar .left-column').getByRole('button', {
    name: 'Review'
  }).click()
  await expect(review).toBeVisible()
}

export function reviewMenuEnabled(
  app: ElectronApplication,
  id: string
): Promise<boolean | null> {
  return app.evaluate(
    ({ Menu }, menuId) =>
      Menu.getApplicationMenu()?.getMenuItemById(menuId)?.enabled ?? null,
    id
  )
}

export async function authorComment(
  page: Page,
  app: ElectronApplication,
  target: string,
  comment: string
): Promise<void> {
  await selectWordByPointer(page, target)
  await expect.poll(() =>
    reviewMenuEnabled(app, 'reviewAddCommentMenuItem')
  ).toBe(true)
  await pressApplicationMenuAccelerator(
    page,
    app,
    'reviewAddCommentMenuItem'
  )
  const input = page.locator('.comment-compose-input')
  await expect(input).toBeVisible()
  await input.fill(comment)
  await page.locator('.comment-compose-actions .submit').click()
  await expect(input).toBeHidden()
}

export const undo = (app: ElectronApplication): Promise<void> =>
  sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')

export const redo = (app: ElectronApplication): Promise<void> =>
  sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')

export const save = (app: ElectronApplication): Promise<void> =>
  sendIpcToRenderer(app, 'mt::editor-ask-file-save')

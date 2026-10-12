import { expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { LEGACY_MARKDOWN_GUARD_ENV, LEGACY_MARKDOWN_REACH_PREFIX } from '../../src/shared/legacyMarkdownReach'
import { frontmostApplicationProcessId } from './frontmostApplication'
import {
  defaultCoreLaunchEnvironment,
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

const projectRoot = path.resolve(__dirname, '../..')

const getDateAsFilename = (): string => {
  const date = new Date()
  return '' + date.getFullYear() + (date.getMonth() + 1) + date.getDate()
}

const getTempPath = (suffix = ''): string => {
  const name =
    'marktext-e2etest-' +
    getDateAsFilename() +
    '-' +
    Math.random().toString(36).slice(2, 8) +
    suffix
  return path.join(os.tmpdir(), name)
}

export const getElectronPath = (): string => {
  if (process.platform === 'win32') {
    return path.resolve(path.join('node_modules', '.bin', 'electron.cmd'))
  }
  const pathTxt = path.join(projectRoot, 'node_modules/electron/path.txt')
  const relPath = fs.readFileSync(pathTxt, 'utf-8').trim()
  return path.join(projectRoot, 'node_modules/electron/dist', relPath)
}

// Track every temp directory we create so we can sweep them on process exit
// (Playwright workers persist across specs but die when the run ends).
const createdTempDirs = new Set<string>()
const trackTempDir = (dir: string): string => {
  createdTempDirs.add(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of createdTempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

export interface LaunchResult {
  app: ElectronApplication
  page: Page
}

export interface LaunchOptions {
  // When true, sets MARKTEXT_ERROR_INTERACTION=1 in the launch env so
  // src/main/exceptionHandler.ts suppresses the modal "Unexpected error"
  // dialog. Only crash-guard specs that explicitly call expectNoRendererErrors
  // should opt in — otherwise existing specs would silently ignore renderer
  // exceptions that previously surfaced as a dialog (a hidden regression risk).
  suppressErrorDialog?: boolean
  /** Per-launch environment overrides; `undefined` removes an inherited key. */
  env?: Readonly<Record<string, string | undefined>>
  // Preferences seeded into the throwaway user data directory before launch.
  // Preference.init() fills in every key that is left out.
  preferences?: Record<string, unknown>
}

/** The file collecting every legacy Markdown reach of this run; see globalSetup. */
export const LEGACY_MARKDOWN_LOG_ENV = 'MARKTEXT_E2E_LEGACY_MARKDOWN_LOG'

/**
 * A bound Core document owns all Markdown parsing and serialization. With
 * LEGACY_MARKDOWN_GUARD_ENV set, the renderer reports each reach of Muya's
 * legacy parser or serializer on its console. Each reach is appended to the run's log, which
 * global teardown checks, and fails the closing of the app that made it.
 */
export const watchLegacyMarkdownReaches = (app: ElectronApplication): void => {
  const reaches: string[] = []
  const watch = (page: Page): void => {
    page.on('console', (message) => {
      const text = message.text()
      if (!text.startsWith(LEGACY_MARKDOWN_REACH_PREFIX)) return
      reaches.push(text)
      const log = process.env[LEGACY_MARKDOWN_LOG_ENV]
      if (log) fs.appendFileSync(log, `${text}\n\n`)
    })
  }
  for (const page of app.windows()) watch(page)
  app.on('window', watch)
  const close = app.close.bind(app)
  app.close = async(): Promise<void> => {
    await close()
    if (reaches.length > 0) {
      throw new Error(`A bound document reached Muya's legacy Markdown modules:\n\n${reaches.join('\n\n')}`)
    }
  }
}

const closeFailedLaunch = async(app: ElectronApplication): Promise<void> => {
  // Readiness can fail while a renderer is stuck. Do not depend on that
  // renderer acknowledging a graceful quit, or leave it owning a temp profile.
  // This handle belongs exclusively to the launch that failed.
  app.process().kill('SIGKILL')
  await app.close().catch(() => {})
}

export const launchElectron = async(
  userArgs?: string[],
  options: LaunchOptions = {}
): Promise<LaunchResult> => {
  userArgs = userArgs || []
  const packagedBinary = process.env.MARKTEXT_PACKAGED_APP
  const executablePath = packagedBinary ?? getElectronPath()
  const applicationRoot = process.env.MARKTEXT_E2E_APP_ROOT
    ? path.resolve(process.env.MARKTEXT_E2E_APP_ROOT)
    : projectRoot
  // Pass project root as entry so Electron reads package.json and getAppPath() returns project root.
  // Passing out/main/index.js directly bypasses package.json and breaks __static path resolution.
  const userDataDir = trackTempDir(getTempPath())
  if (options.preferences) {
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(
      path.join(userDataDir, 'preferences.json'),
      JSON.stringify(options.preferences, null, 2),
      'utf-8'
    )
  }
  const args = [
    ...(packagedBinary ? [] : [applicationRoot]),
    '--user-data-dir',
    userDataDir
  ].concat(userArgs)
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  env.PERF_TESTING = 'true'
  // Unpacked fault/recovery tracers need explicit Core test hooks. Installed
  // checks use the normal launch policy unless the individual test opts in.
  env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS = '1'
  if (options.suppressErrorDialog) env.MARKTEXT_ERROR_INTERACTION = '1'
  env[LEGACY_MARKDOWN_GUARD_ENV] = '1'
  if (packagedBinary) {
    delete env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  const app = await _electron.launch({
    executablePath,
    args,
    cwd: applicationRoot,
    env,
    timeout: 30000
  })
  watchLegacyMarkdownReaches(app)
  try {
    if (packagedBinary) expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    if (options.suppressErrorDialog) await installRendererErrorCounter(app)
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await new Promise((resolve) => setTimeout(resolve, 500))
    return { app, page }
  } catch (error) {
    await closeFailedLaunch(app)
    throw error
  }
}

// Capture renderer-process errors that would otherwise pop the "Unexpected
// error" dialog. We attach a parallel listener to the same IPC channel
// (`mt::handle-renderer-error`) that exceptionHandler.ts listens on, and
// accumulate the count in a shared global so specs can read it back via
// `getRendererErrors`. Multiple listeners are allowed on ipcMain.
export const installRendererErrorCounter = async(app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ ipcMain }) => {
    const g = global as unknown as {
      __mt_renderer_errors__?: Array<{ message?: string; name?: string; stack?: string }>
    }
    if (!g.__mt_renderer_errors__) {
      const sink: Array<{ message?: string; name?: string; stack?: string }> = []
      g.__mt_renderer_errors__ = sink
      ipcMain.on('mt::handle-renderer-error', (_e, error) => {
        sink.push(error)
      })
    }
  })
}

export const getRendererErrors = async(
  app: ElectronApplication
): Promise<Array<{ message?: string; name?: string; stack?: string }>> => {
  return await app.evaluate(() => {
    const g = global as unknown as {
      __mt_renderer_errors__?: Array<{ message?: string; name?: string; stack?: string }>
    }
    return (g.__mt_renderer_errors__ || []).slice()
  })
}

export const clearRendererErrors = async(app: ElectronApplication): Promise<void> => {
  await app.evaluate(() => {
    const g = global as unknown as {
      __mt_renderer_errors__?: Array<unknown>
    }
    if (g.__mt_renderer_errors__) g.__mt_renderer_errors__.length = 0
  })
}

// Assert that no renderer-process error has been captured since the last clear.
// On failure, prints the captured stacks so the spec output is actionable.
export const expectNoRendererErrors = async(app: ElectronApplication): Promise<void> => {
  const errors = await getRendererErrors(app)
  if (errors.length > 0) {
    const summary = errors
      .map((e) => `- ${e.name ?? 'Error'}: ${e.message}\n${e.stack ?? ''}`)
      .join('\n\n')
    throw new Error(`Expected no renderer errors, captured ${errors.length}:\n\n${summary}`)
  }
  expect(errors.length).toBe(0)
}

// Poll until a renderer error matching `predicate` is captured (or timeout).
// Prefer this over a fixed `waitForTimeout` when waiting for an error to
// surface — IPC delivery time varies on slower CI runners.
export const waitForRendererError = async(
  app: ElectronApplication,
  predicate: (e: { message?: string; name?: string; stack?: string }) => boolean,
  timeoutMs = 5000,
  pollMs = 50
): Promise<{ message?: string; name?: string; stack?: string } | null> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const errors = await getRendererErrors(app)
    const match = errors.find(predicate)
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return null
}

/** The installed MarkText executable that MARKTEXT_PACKAGED_APP names. */
export const installedBinary = (): string => {
  const configured = process.env.MARKTEXT_PACKAGED_APP
  if (configured === undefined || configured.trim().length === 0) {
    throw new Error('MARKTEXT_PACKAGED_APP must name the installed MarkText executable')
  }
  const absolute = path.resolve(configured)
  if (!fs.existsSync(absolute)) {
    throw new Error(`Installed MarkText executable does not exist: ${absolute}`)
  }
  return absolute
}

export interface InstalledLaunchOptions {
  userDataDir: string
  /** Budget for the launch and for each readiness wait; the helpers' defaults otherwise. */
  timeout?: number
  /** Runs in main before the first window loads, e.g. to observe startup IPC. */
  beforeWindow?: (app: ElectronApplication) => Promise<void>
}

/**
 * Launches the installed app hidden, with its default Core policy and the
 * renderer error counter, and waits until its document and menu are ready.
 */
export const launchInstalled = async(
  files: readonly string[],
  options: InstalledLaunchOptions
): Promise<LaunchResult> => {
  const app = await _electron.launch({
    executablePath: installedBinary(),
    args: ['--user-data-dir', options.userDataDir, ...files],
    cwd: projectRoot,
    env: defaultCoreLaunchEnvironment({
      PERF_TESTING: 'true',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      MARKTEXT_ERROR_INTERACTION: '1'
    }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout })
  })
  try {
    await installRendererErrorCounter(app)
    await options.beforeWindow?.(app)
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await waitForEditor(page, options.timeout)
    await waitForMenuReady(app, options.timeout)
    await expectInstalledArtifactCommit(page)
    await expectDefaultCoreAuthority(page)
    return { app, page }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

/** Closes the app, then fails on any renderer error it reported. */
export const closeWithoutRendererErrors = async(app: ElectronApplication): Promise<void> => {
  const errors = await getRendererErrors(app)
  expectEditorNotFrontmost(app)
  await app.close()
  expect(errors).toEqual([])
}

export const waitForMenuReady = async(
  app: ElectronApplication,
  timeout = 10000
): Promise<void> => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const ready = await app.evaluate(({ Menu }) => !!Menu.getApplicationMenu())
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Application menu was not built within timeout')
}

export const clickMenuById = async(app: ElectronApplication, id: string): Promise<void> => {
  await app.evaluate(({ Menu, BrowserWindow }, menuId) => {
    const menu = Menu.getApplicationMenu()
    if (!menu) throw new Error('Application menu is not built yet')
    const item = menu.getMenuItemById(menuId)
    if (!item) throw new Error('Menu id not found: ' + menuId)
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    // Electron auto-toggles `checked` for checkbox/radio items on a real
    // click. Replicate that here so handlers that read `menuItem.checked`
    // (e.g. theme `follow-system-theme`) behave the same under tests.
    if (item.type === 'checkbox') {
      item.checked = !item.checked
    } else if (item.type === 'radio') {
      item.checked = true
    }
    // MenuItem.click signature: (event, focusedWindow, focusedWebContents).
    // Electron synthesizes the menuItem argument for template handlers via
    // _executeCommand, so we only need to forward window/webContents.
    // Do not call win.focus() — on xvfb that can collapse the renderer's
    // current DOM selection, breaking format/selection-driven menu actions.
    item.click(undefined, win, win ? win.webContents : undefined)
  }, id)
}

type MenuItemAction = 'click' | 'click-if-enabled' | 'read-enabled'

const menuItemByLabel = (
  app: ElectronApplication,
  labels: readonly string[],
  action: MenuItemAction
): Promise<boolean> =>
  app.evaluate(({ BrowserWindow, Menu }, { labels, action }) => {
    const clean = (label: string) => label.replace(/…|\.\.\./g, '')
    let items = Menu.getApplicationMenu()?.items ?? []
    let item: Electron.MenuItem | undefined
    for (const label of labels) {
      item = items.find(candidate => clean(candidate.label) === clean(label))
      items = item?.submenu?.items ?? []
    }
    if (action === 'read-enabled') return item?.enabled === true
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('type=editor'))
    if (!item || !win || (!item.enabled && action === 'click')) {
      throw new Error(`Unavailable menu command: ${labels.join(' → ')}`)
    }
    if (!item.enabled) return false
    // Edit's Cut, Copy and Paste are native roles (upstream #5582), which act on
    // the focused window's contents; the hidden test window is never focused,
    // so perform the role on the editor window as Electron does for its menu.
    const role = item.role?.toLowerCase()
    if (role === 'cut' || role === 'copy' || role === 'paste') win.webContents[role]()
    else item.click(undefined, win, win.webContents)
    return true
  }, { labels, action })

/**
 * Clicks an enabled application menu item, found by its label path, the way a
 * pointer click on the native menu does: MenuItem.click with the editor
 * window. Labels match without their trailing ellipsis.
 */
export const clickMenuByLabel = async(app: ElectronApplication, ...labels: string[]): Promise<void> => {
  await menuItemByLabel(app, labels, 'click')
}

/** Like clickMenuByLabel, but leaves a disabled item unclicked; returns whether it was enabled. */
export const clickMenuByLabelIfEnabled = (app: ElectronApplication, ...labels: string[]): Promise<boolean> =>
  menuItemByLabel(app, labels, 'click-if-enabled')

/** Whether the application menu item at this label path is enabled. */
export const menuEnabledByLabel = (app: ElectronApplication, ...labels: string[]): Promise<boolean> =>
  menuItemByLabel(app, labels, 'read-enabled')

export const waitForEditor = async(page: Page, timeout = 15000): Promise<void> => {
  await page.waitForSelector('.editor-component', { state: 'attached', timeout })
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.editor-component')
      return el && el.children.length > 0
    },
    null,
    { timeout }
  )
  // Core first mounts its authority-backed view after the placeholder editor.
  // Synthetic caret setup must not target that outgoing placeholder subtree.
  await page.waitForFunction(() => window.__marktextDocumentCore !== undefined, null, {
    timeout
  })
  await expect(page.locator('.core-view-handoff')).toHaveCount(0)
}

/**
 * Opens `root` as the project folder of the running window and waits until
 * `marker` (a markdown file inside `root`) appears in the tree.
 *
 * A launch argument cannot be used: the launcher passes the app path first, so
 * a second directory would open a second window. This uses the same internal
 * channel as the side bar's "Open Folder" dialog, which starts the watcher.
 */
export const openProjectFolder = async(
  app: ElectronApplication,
  page: Page,
  root: string,
  marker: string,
  timeout = 20000
): Promise<void> => {
  await app.evaluate(({ BrowserWindow, ipcMain }, target) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('no editor window')
    ipcMain.emit('app-open-directory-by-id', win.id, target, true)
  }, root)
  await page.waitForSelector(`.tree-wrapper .side-bar-file[title="${marker}"]`, { timeout })
}

export const enterSourceMode = async(page: Page, app: ElectronApplication): Promise<void> => {
  const already = await page.evaluate(() => !!document.querySelector('.source-code .CodeMirror'))
  if (already) return
  await clickMenuById(app, 'sourceCodeModeMenuItem')
  await page.waitForSelector('.source-code .CodeMirror', { state: 'attached', timeout: 10000 })
  await page.waitForFunction(
    () => {
      const cm = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: unknown })
        | null
      return cm && cm.CodeMirror
    },
    null,
    { timeout: 10000 }
  )
  await expect(page.locator('.core-view-handoff')).toHaveCount(0)
}

export const exitSourceMode = async(page: Page, app: ElectronApplication): Promise<void> => {
  const inSource = await page.evaluate(() => !!document.querySelector('.source-code .CodeMirror'))
  if (!inSource) return
  await clickMenuById(app, 'sourceCodeModeMenuItem')
  await page.waitForFunction(() => !document.querySelector('.source-code'), null, {
    timeout: 10000
  })
  await expect(page.locator('.core-view-handoff')).toHaveCount(0)
}

export const getMarkdownContent = async(page: Page, app: ElectronApplication): Promise<string> => {
  const wasInSource = await page.evaluate(
    () => !!document.querySelector('.source-code .CodeMirror')
  )
  if (!wasInSource) await enterSourceMode(page, app)
  const value = await page.evaluate(() => {
    const cm = document.querySelector('.source-code .CodeMirror') as
      | (Element & { CodeMirror?: { getValue(): string } })
      | null
    return cm && cm.CodeMirror ? cm.CodeMirror.getValue() : ''
  })
  if (!wasInSource) await exitSourceMode(page, app)
  return value
}

export const typeIntoEditor = async(page: Page, text: string): Promise<void> => {
  // Preserve a caret the caller already placed. Clicking the editor's empty
  // center creates a new paragraph and changes both source and undo boundaries.
  const hasEditorSelection = await page.evaluate(() => {
    const root = document.querySelector('.editor-component')
    const selection = window.getSelection()
    return (
      !!root &&
      !!selection?.anchorNode &&
      !!selection.focusNode &&
      root.contains(selection.anchorNode) &&
      root.contains(selection.focusNode)
    )
  })
  if (!hasEditorSelection) {
    await page.locator('.editor-component [contenteditable="true"]').first().click()
  }
  await page.keyboard.type(text, { delay: 0 })
}

// The @muyajs/core engine wraps editable paragraph text in
// `span.mu-paragraph-content` (inside `p.mu-paragraph`). Selecting the inner
// content span is what the engine's selection logic expects, so we target it.
// Place a selection inside the first non-empty paragraph content span and let
// the engine commit it to its model. The @muyajs/core engine derives its
// `activeContentBlock` from `click`/`input`/`keydown`/`keyup` events on the
// editor root (see editor/index.ts), so a bare `selectionchange` is not enough
// — we dispatch a synthetic `keyup` on the editor so the active block updates.
const commitSelection = (collapse: boolean) => {
  const root = document.querySelector('.editor-component') as HTMLElement | null
  if (!root) return false
  root.focus()
  const spans = root.querySelectorAll('span.mu-paragraph-content')
  let target: Element | null = null
  for (const span of spans) {
    if (span.textContent && span.textContent.trim().length > 0) {
      target = span
      break
    }
  }
  target = target || spans[0] || null
  if (!target) return false
  const range = document.createRange()
  range.selectNodeContents(target)
  if (collapse) range.collapse(false)
  const sel = window.getSelection()
  if (!sel) return false
  sel.removeAllRanges()
  sel.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  root.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true, cancelable: true })
  )
  return true
}

export const focusEditor = async(page: Page): Promise<void> => {
  await page.evaluate(commitSelection, false)
  // Allow muya's selectionchange listener to commit the selection to its model.
  await page.waitForTimeout(150)
}

export const placeCaretInEditor = async(page: Page): Promise<void> => {
  await page
    .locator('.editor-component span.mu-paragraph-content[contenteditable="true"]')
    .first()
    .click()
  // macOS End scrolls the document; Cmd+Right moves the insertion point.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
}

/**
 * Opens an empty paragraph after the document's first ATX heading with a real
 * End + Enter. A document's final blank line has no block of its own, so
 * `# Title\n\n` shows only the heading, as upstream MarkText does.
 */
export const openParagraphAfterHeading = async(page: Page): Promise<void> => {
  await page
    .locator('.editor-component .mu-atxheading-content[contenteditable="true"]')
    .first()
    .click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await page.keyboard.press('Enter')
  await expect(
    page.locator('.editor-component span.mu-paragraph-content[contenteditable="true"]').first()
  ).toBeVisible()
}

export const setSourceMarkdown = async(
  page: Page,
  app: ElectronApplication,
  markdown: string
): Promise<void> => {
  await enterSourceMode(page, app)
  await page.evaluate((value) => {
    const cm = document.querySelector('.source-code .CodeMirror') as
      | (Element & { CodeMirror?: { setValue(v: string): void } })
      | null
    if (cm && cm.CodeMirror) cm.CodeMirror.setValue(value)
  }, markdown)
  await exitSourceMode(page, app)
}

const writeTempMarkdown = (content: string): string => {
  const dir = trackTempDir(getTempPath('-doc'))
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, 'note.md')
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

export const launchWithDoc = async(
  relativeFixture: string,
  options: LaunchOptions = {}
): Promise<LaunchResult> => {
  const { app, page } = await launchElectron([relativeFixture], options)
  try {
    await waitForEditor(page)
    await waitForMenuReady(app)
    return { app, page }
  } catch (error) {
    await closeFailedLaunch(app)
    throw error
  }
}

export interface LaunchWithMarkdownResult extends LaunchResult {
  filePath: string
}

export const launchWithMarkdown = async(
  markdown = '',
  options: LaunchOptions = {}
): Promise<LaunchWithMarkdownResult> => {
  const filePath = writeTempMarkdown(markdown)
  const { app, page } = await launchWithDoc(filePath, options)
  return { app, page, filePath }
}

/** Opens the real Review sidebar for scenarios that exercise its controls. */
export const launchWithReviewMarkdown = async(
  markdown = '',
  options: LaunchOptions = {}
): Promise<LaunchWithMarkdownResult> => {
  const launched = await launchWithMarkdown(markdown, options)
  try {
    await showReviewSidebar(launched.app)
    return launched
  } catch (error) {
    await launched.app.close().catch(() => {})
    throw error
  }
}

export const expectEditorWindowHidden = async(app: ElectronApplication): Promise<void> => {
  const state = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return {
      visible: window?.isVisible() ?? false,
      focused: window?.isFocused() ?? false
    }
  })
  expect(state).toEqual({ visible: false, focused: false })
}

export const expectEditorNotFrontmost = (app: ElectronApplication): void => {
  const frontmostProcessId = frontmostApplicationProcessId()
  if (frontmostProcessId === undefined) return
  expect(frontmostProcessId).not.toBe(app.process().pid)
}

export const sendIpcToRenderer = async(
  app: ElectronApplication,
  channel: string,
  ...args: unknown[]
): Promise<void> => {
  await app.evaluate(
    ({ BrowserWindow }, payload) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send(payload.channel, ...payload.args)
    },
    { channel, args }
  )
}

/**
 * Answers the native "discard unsubmitted Review input?" close confirmation in
 * main, so closing a test app with an open composer never shows a real dialog.
 */
export async function discardReviewInputOnClose(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async() => ({
      response: 0,
      checkboxChecked: false
    })) as typeof dialog.showMessageBox
  })
}

/** Opens the Comments and Suggestions sidebar tab through the Review menu. */
export async function showReviewSidebar(app: ElectronApplication): Promise<void> {
  await clickMenuById(app, 'critic-show')
}

/** Whether an application menu item is currently enabled. */
export async function menuItemEnabled(app: ElectronApplication, id: string): Promise<boolean | undefined> {
  return app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.enabled, id)
}

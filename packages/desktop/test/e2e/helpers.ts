import { expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

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

// Mirrors the default applied in launchElectron below: on macOS test apps run
// in background test mode (hidden, unfocused windows) unless explicitly
// overridden via MARKTEXT_TEST_BACKGROUND. Specs that assert window
// visibility use this to know which behavior to expect.
export const isBackgroundTestRun: boolean =
  process.env.MARKTEXT_TEST_BACKGROUND !== undefined
    ? process.env.MARKTEXT_TEST_BACKGROUND !== '0'
    : process.platform === 'darwin'

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
}

export const launchElectron = async(
  userArgs?: string[],
  options: LaunchOptions = {}
): Promise<LaunchResult> => {
  userArgs = userArgs || []
  const executablePath = getElectronPath()
  // Pass project root as entry so Electron reads package.json and getAppPath() returns project root.
  // Passing out/main/index.js directly bypasses package.json and breaks __static path resolution.
  const userDataDir = trackTempDir(getTempPath())
  const args = [projectRoot, '--user-data-dir', userDataDir].concat(userArgs)
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  env.PERF_TESTING = 'true'
  // PRESENCE of MARKTEXT_TEST_BACKGROUND signals test mode (the preload
  // exposes the __marktextTest bridge on it), so every launch sets it; the
  // VALUE picks window behavior. On macOS every launch would otherwise
  // activate the app and steal focus — with each spec launching its own
  // MarkText instance, a full run makes the machine unusable, so background
  // mode ('1') keeps windows hidden and unfocused. Linux CI runs under xvfb
  // and stays visible ('0'); export MARKTEXT_TEST_BACKGROUND=0 to watch the
  // app while debugging a spec.
  env.MARKTEXT_TEST_BACKGROUND = isBackgroundTestRun ? '1' : '0'
  if (options.suppressErrorDialog) env.MARKTEXT_ERROR_INTERACTION = '1'
  const app = await _electron.launch({
    executablePath,
    args,
    cwd: projectRoot,
    env,
    timeout: 30000
  })
  if (options.suppressErrorDialog) await installRendererErrorCounter(app)
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // Ready = the Vue app has mounted (empty launches render no editor
  // surface, so #app gaining children is the readiness signal), not a fixed
  // boot pause.
  await page.waitForFunction(
    () => (document.querySelector('#app')?.children.length ?? 0) > 0,
    undefined,
    { timeout: 15000 }
  )
  return { app, page }
}

// Capture renderer-process errors that would otherwise pop the "Unexpected
// error" dialog. We attach a parallel listener to the same IPC channel
// (`mt::handle-renderer-error`) that exceptionHandler.ts listens on, and
// accumulate the count in a shared global so specs can read it back via
// `getRendererErrors`. Multiple listeners are allowed on ipcMain.
const installRendererErrorCounter = async(app: ElectronApplication): Promise<void> => {
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
// The sink fills via async IPC, so the NEGATIVE must settle: empty across
// consecutive reads spanning the delivery window — a single immediate read
// could pass before a late error lands (readSettled re-settles on the error
// list if one arrives mid-check, so the failure path still reports it).
export const expectNoRendererErrors = async(app: ElectronApplication): Promise<void> => {
  const errors = await readSettled(() => getRendererErrors(app), {
    requiredStreak: 3,
    interval: 100
  })
  if (errors.length > 0) {
    const summary = errors.map((e) => `- ${e.name ?? 'Error'}: ${e.message}\n${e.stack ?? ''}`).join('\n\n')
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
}

export const exitSourceMode = async(page: Page, app: ElectronApplication): Promise<void> => {
  const inSource = await page.evaluate(() => !!document.querySelector('.source-code .CodeMirror'))
  if (!inSource) return
  await clickMenuById(app, 'sourceCodeModeMenuItem')
  await page.waitForFunction(() => !document.querySelector('.source-code'), null, {
    timeout: 10000
  })
}

// Reads the active tab's committed markdown through the test-mode preload
// bridge (specs/architecture/test-infrastructure.md) — never by toggling
// source mode, which would exercise the markdown⇄state conversion under test
// and mutate undo history. Entering source mode in a spec is only ever an
// explicit act of testing source mode.
export const getMarkdownContent = async(page: Page): Promise<string> => {
  return page.evaluate(() => {
    const bridge = (
      window as unknown as { __marktextTest?: { getTabMarkdown(): string } }
    ).__marktextTest
    if (!bridge) throw new Error('getMarkdownContent: test bridge missing')
    return bridge.getTabMarkdown()
  })
}

export const typeIntoEditor = async(page: Page, text: string): Promise<void> => {
  await page.click('.editor-component', { timeout: 5000 })
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

// Samples `read` until the value holds for `requiredStreak` consecutive
// reads (waitForMenuItemEnabled semantics): assertions on engine-adjusted
// state (caret snaps, debounced selection commits) must settle so they
// cannot pass by sampling a stale or mid-transition value. Returns the last
// sample on timeout so the caller's assertion reports the actual state.
export const readSettled = async<T>(
  read: () => Promise<T>,
  { requiredStreak = 3, interval = 50, timeout = 4000 } = {}
): Promise<T> => {
  const deadline = Date.now() + timeout
  let last = await read()
  let streak = 1
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval))
    const next = await read()
    if (JSON.stringify(next) === JSON.stringify(last)) {
      streak += 1
      if (streak >= requiredStreak) return next
    } else {
      streak = 1
      last = next
    }
  }
  return last
}

// Wait until muya's selectionchange pipeline has committed a selection to
// its model (read through the test bridge) — a condition, not a clock
// (test-infrastructure.md §Waits assert conditions).
const waitForEngineSelection = async(page: Page, collapsed: boolean): Promise<void> => {
  await page.waitForFunction(
    (wantCollapsed) => {
      const bridge = window.__marktextTest
      if (!bridge) throw new Error('waitForEngineSelection: test bridge missing')
      // Shape: editor.vue serializeCursor — { anchor: {offset}, focus:
      // {offset}, anchorPath, focusPath }.
      const selection = bridge.getEngineSelection() as {
        anchor?: { offset: number } | null
        focus?: { offset: number } | null
        anchorPath?: Array<string | number>
        focusPath?: Array<string | number>
      } | null
      if (!selection?.anchorPath?.length || !selection?.focusPath?.length) return false
      if (!wantCollapsed) return true
      return (
        selection.anchorPath.join('/') === selection.focusPath.join('/') &&
        selection.anchor?.offset === selection.focus?.offset
      )
    },
    collapsed,
    { timeout: 5000 }
  )
}

export const focusEditor = async(page: Page): Promise<void> => {
  await page.evaluate(commitSelection, false)
  await waitForEngineSelection(page, false)
}

export const placeCaretInEditor = async(page: Page): Promise<void> => {
  await page.evaluate(commitSelection, true)
  await waitForEngineSelection(page, true)
}

// Select the word "world" in the first paragraph of a "hello world" document
// and open the comment compose box. Shared by the comment-focus specs.
export const selectWorldThenComment = async(
  page: Page,
  app: ElectronApplication
): Promise<void> => {
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.mu-paragraph')].find(el => el.textContent?.includes('hello'))
    const t = p && document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()
    const sel = document.getSelection()
    if (!t || !sel) {
      throw new Error('selectWorldThenComment: hello paragraph text node or selection missing')
    }
    const r = document.createRange()
    r.setStart(t, 6)
    r.setEnd(t, 11)
    sel.removeAllRanges()
    sel.addRange(r)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await clickMenuById(app, 'review.add-comment')
  // The compose box opening is the postcondition callers rely on.
  await page.waitForSelector('.reply-box textarea', { state: 'attached', timeout: 10000 })
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
  await waitForEditor(page)
  await waitForMenuReady(app)
  return { app, page }
}

export interface LaunchWithMarkdownResult extends LaunchResult {
  filePath: string
}

export const launchWithMarkdown = async(
  markdown = '',
  options: LaunchOptions = {}
): Promise<LaunchWithMarkdownResult> => {
  const filePath = writeTempMarkdown(markdown)
  const { app, page } = await launchElectron([filePath], options)
  await waitForEditor(page)
  await waitForMenuReady(app)
  return { app, page, filePath }
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

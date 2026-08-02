import { expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assertCurrentBackgroundBuildFresh } from './backgroundBuild'

const projectRoot = path.resolve(__dirname, '../..')

const assertBackgroundCapableBuild = (): void => {
  assertCurrentBackgroundBuildFresh(projectRoot)
}

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

const interactiveTestRun = process.env.MARKTEXT_TEST_INTERACTIVE === '1'
const backgroundExplicitlyDisabled = process.env.MARKTEXT_TEST_BACKGROUND === '0'
if (interactiveTestRun !== backgroundExplicitlyDisabled) {
  throw new Error(
    'Foreground Electron tests require both MARKTEXT_TEST_INTERACTIVE=1 and ' +
    'MARKTEXT_TEST_BACKGROUND=0. Automated E2E runs are background-only.'
  )
}

export const isBackgroundTestRun: boolean = !interactiveTestRun

export interface LaunchResult {
  app: ElectronApplication
  page: Page
}

/**
 * Dispose an E2E Electron process without turning test cleanup into an
 * unsaved-document interaction.
 *
 * Playwright's ElectronApplication.close() calls app.quit(). MarkText
 * intentionally intercepts that request so a user can decide what to do with
 * dirty documents, but automated background runs cannot present the native
 * confirmation dialog. Workflow tests exercise close semantics explicitly
 * when that behavior is under test; their final cleanup must be unconditional.
 */
export const closeElectron = async(app: ElectronApplication): Promise<void> => {
  if (!isBackgroundTestRun) {
    await app.close()
    return
  }

  const electronProcess = app.process()
  if (
    electronProcess.exitCode !== null ||
    electronProcess.signalCode !== null
  ) {
    return
  }

  let exitListener: () => void = () => {}
  let timeout: ReturnType<typeof setTimeout> | undefined
  const exited = new Promise<void>((resolve, reject) => {
    let terminal = false
    const finish = (): void => {
      if (terminal) return
      terminal = true
      if (timeout !== undefined) clearTimeout(timeout)
      resolve()
    }
    exitListener = finish
    electronProcess.once('exit', finish)
    if (
      electronProcess.exitCode !== null ||
      electronProcess.signalCode !== null
    ) {
      finish()
      return
    }
    timeout = setTimeout(() => {
      if (terminal) return
      terminal = true
      electronProcess.off('exit', finish)
      reject(new Error('Electron did not exit within 5000ms during E2E cleanup'))
    }, 5000)
  })

  try {
    const requestedExit = app.evaluate(({ app: electronApp }) => {
      setImmediate(() => electronApp.exit(0))
    }).catch(() => {
      if (
        electronProcess.exitCode === null &&
        electronProcess.signalCode === null
      ) {
        electronProcess.kill('SIGKILL')
      }
    })
    await Promise.all([exited, requestedExit])
  } finally {
    electronProcess.off('exit', exitListener)
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

export const closeElectronAfterStartupFailure = async(
  app: ElectronApplication,
  error: unknown
): Promise<never> => {
  try {
    await closeElectron(app)
  } catch {
    // Preserve the startup failure that explains why the launch was unusable.
  }
  throw error
}

export const launchElectron = async(
  userArgs?: string[],
  options: Readonly<{ userDataDir?: string }> = {}
): Promise<LaunchResult> => {
  if (isBackgroundTestRun) assertBackgroundCapableBuild()
  userArgs = userArgs || []
  const executablePath = getElectronPath()
  // Pass project root as entry so Electron reads package.json and getAppPath() returns project root.
  // Passing out/main/index.js directly bypasses package.json and breaks __static path resolution.
  const userDataDir = trackTempDir(
    options.userDataDir === undefined
      ? getTempPath()
      : path.resolve(options.userDataDir)
  )
  fs.mkdirSync(userDataDir, { recursive: true })
  // The entry-path positional stopped doubling as a project root when main
  // learned to skip the app's own directory (the dev-launch wart); the
  // harness's long-standing contract — a launched window has a real
  // project open in the sidebar — is met explicitly with a fixture
  // project, named so legacy title expectations hold verbatim and carrying
  // sub-folders for the tree-folder specs.
  // Main keeps only the first directory positional, so the fixture must
  // defer to a directory the caller passes explicitly.
  const userOpensDirectory = userArgs.some((argument) => {
    if (argument.startsWith('--')) return false
    try {
      return fs.statSync(argument).isDirectory()
    } catch {
      return false
    }
  })
  const fixtureArguments: string[] = []
  if (!userOpensDirectory) {
    const projectFixture = path.join(trackTempDir(getTempPath()), 'MarkText')
    fs.mkdirSync(path.join(projectFixture, 'notes'), { recursive: true })
    fs.mkdirSync(path.join(projectFixture, 'archive'), { recursive: true })
    fs.writeFileSync(
      path.join(projectFixture, 'README.md'),
      '# Fixture project\n'
    )
    fixtureArguments.push(projectFixture)
  }
  const args = [projectRoot, ...fixtureArguments, '--user-data-dir', userDataDir]
    .concat(userArgs)
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  env.PERF_TESTING = 'true'
  // Automated runs default to a hidden, non-activating Electron instance on
  // every platform. Every launch sets the value explicitly so parent-shell
  // state cannot make visibility ambiguous.
  env.MARKTEXT_TEST_BACKGROUND = isBackgroundTestRun ? '1' : '0'
  env.MARKTEXT_ERROR_INTERACTION = '1'
  const app = await _electron.launch({
    executablePath,
    args,
    cwd: projectRoot,
    env,
    timeout: 30000
  })
  try {
    await installRendererErrorCounter(app)
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const startupRendererErrors = await getRendererErrors(app)
    if (startupRendererErrors.length > 0) {
      throw new Error(
        'Electron captured renderer errors during launch: ' +
        JSON.stringify(startupRendererErrors)
      )
    }
    if (isBackgroundTestRun) {
      await assertBackgroundRuntimePolicy(app)
    }
    return { app, page }
  } catch (error) {
    return closeElectronAfterStartupFailure(app, error)
  }
}

export const assertBackgroundRuntimePolicy = async(
  app: ElectronApplication
): Promise<void> => {
  const state = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const capturedErrors = ((global as unknown as {
      __mt_captured_errors__?: Array<{
        source?: string
        name?: string
        message?: string
        stack?: string
      }>
    }).__mt_captured_errors__ ?? []).slice()
    const getActivationPolicy = (
      electronApp as unknown as { getActivationPolicy?: () => string }
    ).getActivationPolicy
    const activationPolicy = getActivationPolicy?.call(electronApp) ?? null
    const canInspectActivationPolicy = typeof getActivationPolicy === 'function'
    const windows = BrowserWindow.getAllWindows().map((window) => ({
      id: window.id,
      visible: window.isVisible(),
      focused: window.isFocused()
    }))
    return { activationPolicy, canInspectActivationPolicy, windows, capturedErrors }
  })

  if (
    process.platform === 'darwin' &&
    state.canInspectActivationPolicy &&
    state.activationPolicy !== 'accessory'
  ) {
    throw new Error(
      `Background Electron activation policy is ${String(state.activationPolicy)}, not accessory.`
    )
  }
  const presented = state.windows.filter((window) => window.visible || window.focused)
  if (presented.length > 0) {
    throw new Error(
      `Background Electron exposed visible/focused windows: ${JSON.stringify(presented)}`
    )
  }
  if (state.capturedErrors.length > 0) {
    throw new Error(
      `Background Electron captured startup errors: ${JSON.stringify(state.capturedErrors)}`
    )
  }
}

// Capture renderer-process errors for every automated launch. Include errors
// the production policy observed before this listener was installed, then
// attach to the same IPC channel for the rest of the run.
const installRendererErrorCounter = async(app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ ipcMain }) => {
    const g = global as unknown as {
      __mt_renderer_errors__?: Array<{ message?: string; name?: string; stack?: string }>
      __mt_captured_errors__?: Array<{
        source?: string
        message?: string
        name?: string
        stack?: string
      }>
    }
    if (!g.__mt_renderer_errors__) {
      const sink: Array<{ message?: string; name?: string; stack?: string }> =
        (g.__mt_captured_errors__ ?? [])
          .filter((error) => error.source === 'renderer')
          .map(({ message, name, stack }) => ({ message, name, stack }))
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

export interface CapturedApplicationError {
  source?: string
  message?: string
  name?: string
  stack?: string
}

export const getCapturedErrors = async(
  app: ElectronApplication
): Promise<CapturedApplicationError[]> => {
  return await app.evaluate(() => {
    const g = global as unknown as {
      __mt_captured_errors__?: CapturedApplicationError[]
    }
    return (g.__mt_captured_errors__ ?? []).map((error) => ({ ...error }))
  })
}

export const clearCapturedErrors = async(app: ElectronApplication): Promise<void> => {
  await app.evaluate(() => {
    const g = global as unknown as {
      __mt_captured_errors__?: unknown[]
      __mt_renderer_errors__?: unknown[]
    }
    if (g.__mt_captured_errors__) g.__mt_captured_errors__.length = 0
    if (g.__mt_renderer_errors__) g.__mt_renderer_errors__.length = 0
  })
}

export const expectNoCapturedErrors = async(app: ElectronApplication): Promise<void> => {
  const errors = await getCapturedErrors(app)
  if (errors.length > 0) {
    const summary = errors
      .map((error) =>
        `- ${error.source ?? 'unknown'} / ${error.name ?? 'Error'}: ${error.message}\n` +
        `${error.stack ?? ''}`)
      .join('\n\n')
    throw new Error(
      `Expected no captured main/renderer errors, captured ${errors.length}:\n\n${summary}`
    )
  }
  expect(errors.length).toBe(0)
  if (isBackgroundTestRun) await assertBackgroundRuntimePolicy(app)
}

// Assert that no renderer-process error has been captured since the last clear.
// On failure, prints the captured stacks so the spec output is actionable.
export const expectNoRendererErrors = async(app: ElectronApplication): Promise<void> => {
  const errors = await getRendererErrors(app)
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
    // `MenuItem.click()` performs Electron's own checkbox toggle, so setting
    // `checked` here as well would flip it twice and hand the handler the
    // value it started with — which is how autosave stayed off through a
    // click that appeared to enable it. Radio items are selected rather than
    // toggled, so they still need the explicit set.
    if (item.type === 'radio') {
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
      return el?.getAttribute('role') === 'textbox' &&
        el.getAttribute('contenteditable') === 'true'
    },
    null,
    { timeout }
  )
}

export const enterSourceMode = async(page: Page, app: ElectronApplication): Promise<void> => {
  const already = await page.evaluate(
    () => !!document.querySelector('.source-code-input')
  )
  if (already) return
  await clickMenuById(app, 'sourceCodeModeMenuItem')
  await page.waitForSelector('.source-code-input', {
    state: 'attached',
    timeout: 10000
  })
  await page.waitForFunction(
    () => document.querySelector('.source-code-input') instanceof HTMLTextAreaElement,
    null,
    { timeout: 10000 }
  )
}

export const exitSourceMode = async(page: Page, app: ElectronApplication): Promise<void> => {
  // The textarea is the native input projection over the main-owned session,
  // so its final value is exactly the canonical source the WYSIWYG remount
  // adopts — captured before the exit because the teardown removes it.
  const sourceLength = await page.evaluate(() => {
    const input = document.querySelector(
      '.source-code-input'
    ) as HTMLTextAreaElement | null
    return input === null ? null : input.value.length
  })
  if (sourceLength === null) return
  await clickMenuById(app, 'sourceCodeModeMenuItem')
  await page.waitForFunction(() => !document.querySelector('.source-code'), null, {
    timeout: 10000
  })
  // The WYSIWYG remount trails the source-mode teardown: the head may have
  // been rewritten in source mode while the mounted runs still carry the old
  // revision's model stamps. Wait until no mounted run's model stamp points
  // past the adopted head so gestures never target the stale window.
  await page.waitForFunction((headLength) => {
    const run = document.querySelector('.editor-component .document-view-run[data-model-end]')
    // No mounted runs means no stale stamps a gesture could target — an
    // empty document's placeholder paragraph renders without runs.
    if (!run) return true
    const mountedEnd = Number(run.getAttribute('data-model-end'))
    if (!Number.isFinite(mountedEnd)) return false
    return mountedEnd <= headLength
  }, sourceLength, { timeout: 10000 })
}

export const getMarkdownContent = async(
  page: Page,
  app: ElectronApplication
): Promise<string> => {
  const wasInSource = await page.evaluate(
    () => !!document.querySelector('.source-code-input')
  )
  if (!wasInSource) await enterSourceMode(page, app)
  const value = await page.evaluate(() => {
    const input = document.querySelector(
      '.source-code-input'
    ) as HTMLTextAreaElement | null
    return input?.value ?? ''
  })
  if (!wasInSource) await exitSourceMode(page, app)
  return value
}

export const typeIntoEditor = async(page: Page, text: string): Promise<void> => {
  await page.click('.editor-component', { timeout: 5000 })
  await page.keyboard.type(text, { delay: 0 })
}

// The document view wraps editable paragraph text in
// `span.document-view-run` (inside `p.document-view-paragraph`). Selecting the inner
// content span gives the browser range an exact parser-owned model mapping.
// Dispatching keyup commits the range before a following command.
const commitSelection = (collapse: boolean) => {
  const root = document.querySelector('.editor-component') as HTMLElement | null
  if (!root) return false
  root.focus()
  const spans = root.querySelectorAll('span.document-view-run')
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
  // Allow the selectionchange listener to commit the selection to the session.
  await page.waitForTimeout(150)
}

export const placeCaretInEditor = async(page: Page): Promise<void> => {
  await page.evaluate(commitSelection, true)
  await page.waitForTimeout(150)
}

export const setSourceMarkdown = async(
  page: Page,
  app: ElectronApplication,
  markdown: string
): Promise<void> => {
  await enterSourceMode(page, app)
  const input = page.locator('.source-code-input')
  await input.fill(markdown)
  await expect(input).toHaveValue(markdown)
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
  relativeFixture: string
): Promise<LaunchResult> => {
  const { app, page } = await launchElectron([relativeFixture])
  await waitForEditor(page)
  await waitForMenuReady(app)
  return { app, page }
}

/**
 * Open a repo fixture through a throwaway temp copy. Required for any test
 * that saves: launchWithDoc opens the fixture in place, so a save would
 * overwrite checked-in test data.
 */
export const launchWithFixtureCopy = async(
  relativeFixture: string
): Promise<LaunchWithMarkdownResult> => {
  const filePath = writeTempMarkdown(fs.readFileSync(relativeFixture, 'utf-8'))
  const { app, page } = await launchElectron([filePath])
  await waitForEditor(page)
  await waitForMenuReady(app)
  return { app, page, filePath }
}

export interface LaunchWithMarkdownResult extends LaunchResult {
  filePath: string
}

export interface LaunchWithMarkdownOptions {
  readonly userKeybindings?: Readonly<Record<string, string>>
}

export const launchWithMarkdown = async(
  markdown = '',
  options: LaunchWithMarkdownOptions = {}
): Promise<LaunchWithMarkdownResult> => {
  const filePath = writeTempMarkdown(markdown)
  let userDataDir: string | undefined
  if (options.userKeybindings !== undefined) {
    userDataDir = trackTempDir(getTempPath('-profile'))
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(
      path.join(userDataDir, 'keybindings.json'),
      `${JSON.stringify(options.userKeybindings, null, 2)}\n`,
      'utf8'
    )
  }
  const launchOptions = userDataDir === undefined ? {} : { userDataDir }
  const { app, page } = await launchElectron([filePath], launchOptions)
  await waitForEditor(page)
  await waitForMenuReady(app)
  return { app, page, filePath }
}

// Opens an untitled tab through a live production boundary. The old
// renderer-side 'mt::new-untitled-tab' channel is gone: the renderer no
// longer admits documents, so seeded content goes through the same
// drag-drop import request production uses (admitImportedMarkdown in main),
// and the empty case through the tab-bar's own command.
export const openUntitledTabWithMarkdown = async(
  page: Page,
  markdown: string
): Promise<void> => {
  if (markdown === '') {
    await page.evaluate(() => {
      window.electron.ipcRenderer.send('mt::cmd-new-tab')
    })
    return
  }
  await page.evaluate(async(source) => {
    await window.electron.ipcRenderer.invoke('mt::document-import::binary', {
      schema: 'document-import-binary-request-1',
      name: 'e2e-untitled.md',
      bytes: new TextEncoder().encode(source)
    })
  }, markdown)
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

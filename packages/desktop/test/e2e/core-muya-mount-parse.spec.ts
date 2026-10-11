import { expect, test } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  enterSourceMode,
  exitSourceMode,
  getElectronPath,
  waitForEditor,
  waitForMenuReady,
  watchLegacyMarkdownReaches
} from './helpers'

// Core is the only Markdown parser for a document. Muya renders the Core
// view's projected state and must never parse the file's Markdown itself:
// not for the placeholder mounted before the first Core view arrives, and not
// for the hidden WYSIWYG surface kept mounted while Source view is up.

const TOKEN = 'MT_G20_ONLY_CORE_PARSES'
const DOCUMENT = `# Heading ${TOKEN}\n\nParagraph with **strong** text.\n`

interface MountProbe {
  roots: Element[]
}

declare global {
  interface Window {
    __marktextMountProbe?: MountProbe
  }
}

// Records every Muya surface that ever rendered the document's text. The
// observer is installed before the first editor mounts, so a placeholder
// surface that parses the file is caught even though it is replaced within
// the same launch.
const installMountProbe = (token: string): void => {
  if (window.__marktextMountProbe !== undefined) return
  const probe: MountProbe = { roots: [] }
  window.__marktextMountProbe = probe
  const scan = (): void => {
    for (const root of document.querySelectorAll('.editor-component')) {
      if (!probe.roots.includes(root) && (root.textContent ?? '').includes(token)) {
        probe.roots.push(root)
      }
    }
  }
  new MutationObserver(scan).observe(document, {
    childList: true,
    subtree: true,
    characterData: true
  })
  scan()
}

const renderedRoots = async(page: Page): Promise<number> =>
  await page.evaluate(() => window.__marktextMountProbe?.roots.length ?? -1)

test.describe('Core-required Muya mounts', () => {
  let app: ElectronApplication | undefined
  let root: string

  test.beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-core-mount-parse-'))
  })

  test.afterEach(async() => {
    if (app !== undefined) await app.close()
    app = undefined
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('Muya never parses the file on first open or Source entry', async() => {
    const filePath = path.join(root, 'note.md')
    fs.writeFileSync(filePath, DOCUMENT, 'utf8')
    const projectRoot = path.resolve(__dirname, '../..')
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value
    }
    env.PERF_TESTING = 'true'
    app = await _electron.launch({
      executablePath: getElectronPath(),
      args: [projectRoot, '--user-data-dir', path.join(root, 'profile'), filePath],
      cwd: projectRoot,
      env,
      timeout: 30_000
    })
    watchLegacyMarkdownReaches(app)
    const page = await app.firstWindow()
    await page.evaluate(installMountProbe, TOKEN)
    await waitForEditor(page)
    await waitForMenuReady(app)
    await expect(page.locator('.editor-component')).toContainText(TOKEN)

    // Only the Core view rendered the document; no placeholder parsed it.
    expect(await renderedRoots(page)).toBe(1)

    await enterSourceMode(page, app)
    await expect(page.locator('.source-code')).toContainText(TOKEN)
    // The hidden WYSIWYG surface remounted for Source view stays empty.
    expect(await renderedRoots(page)).toBe(1)
    expect(
      await page.evaluate(
        (token) =>
          [...document.querySelectorAll('.editor-component')].some((element) =>
            (element.textContent ?? '').includes(token)
          ),
        TOKEN
      )
    ).toBe(false)

    await exitSourceMode(page, app)
    await expect(page.locator('.editor-component')).toContainText(TOKEN)
  })
})

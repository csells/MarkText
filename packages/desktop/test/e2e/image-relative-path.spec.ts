import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  closeElectron,
  enterSourceMode,
  exitSourceMode,
  launchElectron,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import {
  expectCanonicalOnDisk
} from './documentCoreReviewE2e'

// A saved document's relative image crosses a main-owned path resolver and is
// exposed to Chromium only through an opaque, revision-bound custom-protocol
// capability. Renderer globals and DOM never receive the native directory.

// A 1x1 transparent PNG that Chromium can load from disk.
const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const createdDirs: string[] = []

const writeDocWithRelativeImage = (): { docPath: string; docDir: string } => {
  const docDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-e2e-relimg-'))
  createdDirs.push(docDir)
  const assetsDir = path.join(docDir, 'assets')
  fs.mkdirSync(assetsDir, { recursive: true })
  fs.writeFileSync(path.join(assetsDir, 'cat.png'), Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'))
  const docPath = path.join(docDir, 'note.md')
  fs.writeFileSync(docPath, '![a cat](assets/cat.png)\n', 'utf-8')
  return { docPath, docDir }
}

test.describe('main-owned relative image display authority', () => {
  let app: ElectronApplication | null = null
  let page: Page
  let docDir: string
  let documentPath = ''

  test.beforeAll(async() => {
    const written = writeDocWithRelativeImage()
    docDir = written.docDir
    documentPath = written.docPath
    const launched = await launchElectron([written.docPath])
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await waitForMenuReady(app)
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
    for (const dir of createdDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  test('does not publish document directory authority to renderer', async() => {
    expect(await page.evaluate(() => 'DIRNAME' in window)).toBe(false)
  })

  test('renders through an opaque capability without exposing a file URL', async() => {
    const imgLocator = page.locator('.editor-component img.document-view-image')
    await imgLocator.first().waitFor({ state: 'attached', timeout: 10000 })

    await expect.poll(async() => imgLocator.first().evaluate(image => ({
      complete: (image as HTMLImageElement).complete,
      naturalWidth: (image as HTMLImageElement).naturalWidth
    }))).toEqual({ complete: true, naturalWidth: 1 })
    const src = await imgLocator.first().getAttribute('src') ?? ''
    expect(src).toMatch(/^marktext-image:\/\/asset\/[a-zA-Z0-9_-]+$/)
    expect(src).not.toContain('file:')
    expect(src).not.toContain(docDir)
    expect(src).not.toContain('assets/cat.png')
  })

  test('keeps the authored source exact across Source and Markup surfaces', async() => {
    const source = '![a cat](assets/cat.png)\n'
    await expectCanonicalOnDisk(page, app as ElectronApplication, documentPath, source)
    await enterSourceMode(page, app as ElectronApplication)
    await expect(page.locator('.source-code-input')).toHaveValue(source)
    await exitSourceMode(page, app as ElectronApplication)
    const image = page.locator('.editor-component img.document-view-image').first()
    await image.waitFor({ state: 'attached', timeout: 10000 })
    await expect.poll(async() => image.evaluate(element =>
      (element as HTMLImageElement).naturalWidth
    )).toBe(1)
    await expectCanonicalOnDisk(page, app as ElectronApplication, documentPath, source)
  })
})

import { createServer, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import {
  expectEditorNotFrontmost, expectEditorWindowHidden, expectNoRendererErrors,
  launchElectron, sendIpcToRenderer, waitForEditor, waitForMenuReady
} from './helpers'
import { expectDefaultCoreAuthority, expectInstalledArtifactCommit } from './installedArtifactProvenance'
import { preserveSystemClipboard } from './helpers/systemClipboardFixture'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
const initialSource = 'seed\n'

test.describe.configure({ mode: 'default' })

for (const ingestion of ['local file drop', 'web image drop', 'native bitmap paste', 'completed screenshot IPC'] as const) {
  test(`${ingestion} preserves its image through Core save, undo, redo and reopen`, async() => {
    const root = mkdtempSync(join(tmpdir(), 'marktext-image-ingestion-'))
    const filePath = join(root, 'note.md')
    const imagePath = join(root, 'local.png')
    const assetDirectory = join(root, 'assets')
    writeFileSync(filePath, initialSource)
    writeFileSync(imagePath, png)
    mkdirSync(assetDirectory)
    let app: ElectronApplication | undefined
    let server: Server | undefined
    let clipboard: ReturnType<typeof preserveSystemClipboard> | undefined
    const open = async(): Promise<Page> => {
      const launched = await launchElectron([filePath], {
        suppressErrorDialog: true,
        env: {
          MARKTEXT_E2E_HIDDEN_WINDOW: '1',
          MARKTEXT_DOCUMENT_CORE_MODE: undefined,
          MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
          MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
        }
      })
      app = launched.app
      const page = launched.page
      await waitForEditor(page)
      await waitForMenuReady(app)
      await expectDefaultCoreAuthority(page)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      if (process.env.MARKTEXT_PACKAGED_APP) await expectInstalledArtifactCommit(page)
      return page
    }
    const save = async(page: Page, expected: string): Promise<void> => {
      if (!app) throw new Error('Editor application is unavailable')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
      await expect(page.getByRole('region', { name: 'Recovered drafts' })).toHaveCount(0)
      await expectNoRendererErrors(app)
    }
    const expectLoadedImage = async(page: Page): Promise<void> => {
      await expect.poll(() => page.locator('.editor-component .mu-inline-image.mu-image-success').count()).toBe(1)
      await expect(page.locator('.editor-component')).not.toContainText('loading-')
    }
    try {
      const page = await open()
      await page.evaluate(async() => {
        const changed = new Promise(resolve => window.electron.ipcRenderer.once('mt::user-preference', (_event, value) => resolve(value)))
        window.electron.ipcRenderer.send('mt::set-user-preference', {
          imageInsertAction: 'folder',
          imagePreferRelativeDirectory: true,
          imageRelativeDirectoryName: 'assets',
          imageRelativeDirectoryBase: 'file'
        })
        window.electron.ipcRenderer.send('mt::ask-for-user-preference')
        await changed
      })
      const paragraph = page.locator('span.mu-paragraph-content').first()
      await paragraph.click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
      let expected: string
      if (ingestion === 'local file drop' || ingestion === 'web image drop') {
        let imageUrl = ''
        if (ingestion === 'web image drop') {
          const imageServer = createServer((_request, response) => {
            response.writeHead(200, { 'Content-Type': 'image/png' })
            response.end(png)
          })
          server = imageServer
          await new Promise<void>((resolve, reject) => {
            imageServer.once('error', reject)
            imageServer.listen(0, '127.0.0.1', resolve)
          })
          const address = imageServer.address()
          if (!address || typeof address === 'string') throw new Error('Image server has no TCP address')
          imageUrl = `http://127.0.0.1:${address.port}/image.png`
        }
        const box = await paragraph.boundingBox()
        if (!box) throw new Error('Drop target has no bounds')
        const data = ingestion === 'local file drop'
          ? { items: [], files: [imagePath], dragOperationsMask: 1 }
          : {
            items: [
              { mimeType: 'text/uri-list', data: imageUrl },
              { mimeType: 'text/html', data: `<img src="${imageUrl}">` }
            ],
            dragOperationsMask: 1
          }
        const cdp = await page.context().newCDPSession(page)
        try {
          for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
            await cdp.send('Input.dispatchDragEvent', {
              type, x: box.x + box.width / 2, y: box.y + box.height - 2, data
            })
          }
        } finally {
          await cdp.detach()
        }
        if (ingestion === 'web image drop') {
          expected = `seed\n\n![](${imageUrl})\n`
        } else {
          await expect.poll(() => readdirSync(assetDirectory).length).toBe(1)
          const asset = readdirSync(assetDirectory)[0]
          expect(readFileSync(join(assetDirectory, asset))).toEqual(png)
          expected = `seed\n\n![${basename(imagePath)}](assets/${asset})\n`
        }
      } else if (ingestion === 'native bitmap paste') {
        clipboard = preserveSystemClipboard()
        const marker = 'marktext-image-ingestion-owned-clipboard'
        if (!app) throw new Error('Editor application is unavailable')
        try {
          await app.evaluate(({ clipboard, nativeImage }, input) => {
            const image = nativeImage.createFromBuffer(Buffer.from(input.png, 'base64'))
            if (image.isEmpty()) throw new Error('PNG fixture could not be decoded')
            clipboard.write({ image, text: input.marker })
          }, { png: png.toString('base64'), marker })
        } finally {
          clipboard.rememberOwnedWrite(marker)
        }
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]
          if (!window) throw new Error('Editor window is unavailable')
          window.webContents.paste()
        })
        await expect.poll(() => readdirSync(assetDirectory).length).toBe(1)
        const asset = readdirSync(assetDirectory)[0]
        const copied = readFileSync(join(assetDirectory, asset))
        expect(await app.evaluate(({ nativeImage }, input) => {
          const original = nativeImage.createFromBuffer(Buffer.from(input.original, 'base64'))
          const persisted = nativeImage.createFromBuffer(Buffer.from(input.persisted, 'base64'))
          return !persisted.isEmpty() && original.toBitmap().equals(persisted.toBitmap())
        }, { original: png.toString('base64'), persisted: copied.toString('base64') })).toBe(true)
        expected = `seed![](assets/${asset})\n`
      } else {
        // This covers the completed-capture delivery, not the interactive OS picker.
        if (!app) throw new Error('Editor application is unavailable')
        await sendIpcToRenderer(app, 'mt::screenshot-captured', imagePath)
        await expect.poll(() => readdirSync(assetDirectory).length).toBe(1)
        const asset = readdirSync(assetDirectory)[0]
        expect(readFileSync(join(assetDirectory, asset))).toEqual(png)
        expected = `seed![](assets/${asset})\n`
      }
      await expectLoadedImage(page)
      await save(page, expected)
      if (!app) throw new Error('Editor application is unavailable')
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await save(page, initialSource)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
      await save(page, expected)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await app.close()
      app = undefined
      const reopened = await open()
      await expectLoadedImage(reopened)
      await save(reopened, expected)
    } finally {
      try {
        await app?.close()
      } finally {
        clipboard?.restore()
      }
      const imageServer = server
      if (imageServer) await new Promise<void>((resolve, reject) => imageServer.close(error => error ? reject(error) : resolve()))
      rmSync(root, { recursive: true, force: true })
    }
  })
}

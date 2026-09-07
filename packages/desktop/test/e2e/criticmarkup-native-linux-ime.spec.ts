import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { enterSourceMode, exitSourceMode, expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

// Requires a private X11 desktop with IBus/Mozc, GTK IM modules and xdotool.
// These gestures go through the OS input method, including its candidate panel.
test.skip(process.platform !== 'linux' || process.env.MARKTEXT_NATIVE_LINUX_IME !== '1', 'Requires the isolated native Linux IME environment')
test.beforeAll(() => {
  if (process.env.MARKTEXT_E2E_PRIVATE_DISPLAY !== '1') throw new Error('Native OS input requires a private test display')
})

const nativeKey = (...keys: string[]) => execFileSync('xdotool', ['key', '--clearmodifiers', ...keys])
const selectEngine = (name: string) => execFileSync('gdbus', [
  'call', '--address', execFileSync('ibus', ['address'], { encoding: 'utf8' }).trim(),
  '--dest', 'org.freedesktop.IBus', '--object-path', '/org/freedesktop/IBus',
  '--method', 'org.freedesktop.IBus.SetGlobalEngine', name
])

for (const tracked of [false, true]) {
  for (const inside of [false, true]) {
    test(`native Mozc candidate selection, save and history: tracked=${tracked}, inside=${inside}`, async() => {
      test.setTimeout(90000)
      const testInfo = test.info()
      const source = inside ? '{++Start++}{>>keep<<}.\n' : 'Start {++kept++}{>>keep<<}.\n'
      const committed = inside
        ? '{++St日本art++}{>>keep<<}.\n'
        : (tracked ? '{++日本++}' : '日本') + source
      const edited = committed.replace('日本', '日本!')
      selectEngine('xkb:us::eng')
      const { app, page, filePath } = await launchWithMarkdown(source, {
        suppressErrorDialog: true,
        env: {
          MARKTEXT_E2E_HIDDEN_WINDOW: undefined,
          MARKTEXT_DOCUMENT_CORE_MODE: undefined,
          MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
          MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
          IBUS_ADDRESS: execFileSync('ibus', ['address'], { encoding: 'utf8' }).trim()
        }
      })
      const save = async(expected: string) => {
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
      }
      try {
        await page.waitForFunction(() => window.__marktextDocumentCore?.mode === 'core')
        if (tracked) await page.getByTestId('critic-review-track-changes').click()
        const windowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE())
        execFileSync('xdotool', ['windowactivate', '--sync', String(windowId)])
        await page.locator('.mu-paragraph-content').first().click()
        nativeKey('ctrl+Home')
        if (inside) nativeKey('Right', 'Right')
        await page.evaluate(() => {
          const host = window as typeof window & { nativeCompositionObserved?: boolean }
          document.addEventListener('compositionstart', event => {
            if (event.isTrusted) host.nativeCompositionObserved = true
          })
        })
        selectEngine('mozc-jp')
        nativeKey('ctrl+space', 'Hiragana')
        execFileSync('xdotool', ['type', '--clearmodifiers', '--delay', '100', 'nihon'])
        await page.waitForFunction(() => (window as typeof window & { nativeCompositionObserved?: boolean }).nativeCompositionObserved === true)
        nativeKey('space', 'space')
        const screenshot = testInfo.outputPath('native-candidate-panel.png')
        mkdirSync(path.dirname(screenshot), { recursive: true })
        execFileSync('python3', ['-c', "import gi,sys; gi.require_version('Gdk','3.0'); from gi.repository import Gdk; w=Gdk.get_default_root_window(); Gdk.pixbuf_get_from_window(w,0,0,w.get_width(),w.get_height()).savev(sys.argv[1],'png',[],[])", screenshot])
        nativeKey('Up', 'Return')
        await save(committed)
        selectEngine('xkb:us::eng')
        await page.waitForTimeout(1100)
        execFileSync('xdotool', ['type', '--clearmodifiers', '!'])
        await save(edited)
        await enterSourceMode(page, app)
        await exitSourceMode(page, app)
        await save(edited)
        for (const expected of [committed, source]) {
          await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
          await save(expected)
        }
        await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
        await expectNoRendererErrors(app)
      } finally {
        await app.close()
      }
    })
  }
}

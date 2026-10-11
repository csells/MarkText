import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import {
  enterSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  getElectronPath,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady,
  watchLegacyMarkdownReaches
} from './helpers'
import { expectInstalledArtifactCommit } from './installedArtifactProvenance'

for (const failure of [
  'synchronous input burst',
  'Worker failure',
  'rejected edit',
  'backup failure',
  'Source Worker failure'
] as const) {
  test(`preserves a recoverable native draft through ${failure}, close and restart`, async() => {
    const root = mkdtempSync(join(tmpdir(), 'marktext-draft-recovery-'))
    const filePath = join(root, 'draft.md')
    const profile = join(root, 'profile')
    const obstruction = join(profile, 'core-recovery-drafts')
    if (failure === 'backup failure') {
      mkdirSync(profile)
      writeFileSync(obstruction, 'existing bytes must survive')
    }
    writeFileSync(filePath, 'seed\n')
    let app: ElectronApplication | undefined
    const launch = async() => {
      const binary = process.env.MARKTEXT_PACKAGED_APP
      const environment: Record<string, string> = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined
        )
      )
      app = await electron.launch({
        executablePath: binary ?? getElectronPath(),
        args: [
          ...(binary ? [] : [resolve(__dirname, '../..')]),
          '--user-data-dir',
          profile,
          filePath
        ],
        cwd: resolve(__dirname, '../..'),
        env: {
          ...environment,
          PERF_TESTING: 'true',
          MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: '1',
          MARKTEXT_E2E_HIDDEN_WINDOW: '1',
          MARKTEXT_ERROR_INTERACTION: '1'
        }
      })
      watchLegacyMarkdownReaches(app)
      const page = await app.firstWindow()
      await waitForEditor(page)
      await waitForMenuReady(app)
      if (binary) {
        expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
        await expectInstalledArtifactCommit(page)
      }
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      if (failure === 'backup failure') {
        await sendIpcToRenderer(app, 'mt::user-preference', { textDirection: 'rtl' })
      }
      return page
    }
    try {
      const page = await launch()
      const paragraph = page.locator('span.mu-paragraph-content').first()
      await expect(paragraph).toHaveAttribute('contenteditable', 'true')
      await paragraph.fill('accepted')
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      if (app === undefined) throw new Error('Electron application is unavailable')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('accepted\n')
      const acceptedText =
        failure === 'backup failure' ? 'accepted unsaved مرحبا (ABC 123).' : 'accepted unsaved'
      await paragraph.fill(acceptedText)
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      // A fault must recover every acknowledged edit, including unsaved work.
      // Rejected input is kept in the backup without becoming canonical source.
      expect(readFileSync(filePath, 'utf8')).toBe('accepted\n')
      if (failure === 'Source Worker failure') {
        await page.evaluate(() => {
          const host = window as typeof window & { crashSourceWorker?: () => void }
          host.crashSourceWorker = window.__marktextDocumentCore?.crashWorker
        })
        if (app === undefined) throw new Error('Electron application is unavailable')
        await enterSourceMode(page, app)
      }
      const initialGeneration = await page.evaluate(() => window.__marktextDocumentCore?.generation)
      const draftText =
        failure === 'synchronous input burst'
          ? acceptedText + 'x'.repeat(129)
          : failure === 'Source Worker failure'
            ? acceptedText + ' draft\n'
            : acceptedText + ' draft'
      if (failure === 'synchronous input burst') {
        // The live model decides each action in this call. A burst cannot build
        // the retired Worker acknowledgement queue; every accepted key survives.
        const burst = await page.evaluate((accepted) => {
          const bridge = window.__marktextDocumentCore
          if (bridge?.inputPlainText === undefined) throw new Error('Missing native input bridge')
          const start = bridge.performanceEvents?.().length ?? 0
          for (let index = 1; index <= 129; index += 1) {
            const text = accepted + 'x'.repeat(index)
            bridge.inputPlainText(0, text, text.length)
          }
          const events = bridge.performanceEvents?.().slice(start) ?? []
          const dispatch = events.filter((event) => event.phase === 'dispatch')
          return {
            dispatched: dispatch.length,
            acknowledged: events.filter((event) => event.phase === 'ack').length,
            maximumPending: Math.max(...dispatch.map((event) => event.pendingDepth))
          }
        }, acceptedText)
        expect(burst).toEqual({ dispatched: 129, acknowledged: 129, maximumPending: 1 })
        await page.evaluate(() => window.__marktextDocumentCore?.crashWorker?.())
      } else if (failure === 'Source Worker failure') {
        await page.evaluate((offset) => {
          const host = document.querySelector('.source-code .CodeMirror') as Element & {
            CodeMirror: { focus(): void; setCursor(position: { line: number; ch: number }): void }
          }
          host.CodeMirror.focus()
          host.CodeMirror.setCursor({ line: 0, ch: offset })
        }, acceptedText.length)
        await page.keyboard.type(' draft')
        await page.evaluate((expected) => {
          const host = window as typeof window & { crashSourceWorker?: () => void }
          if (host.crashSourceWorker === undefined) {
            throw new Error('Missing Source Worker failure control')
          }
          const cm = (
            document.querySelector('.source-code .CodeMirror') as Element & {
              CodeMirror: { getValue(): string }
            }
          ).CodeMirror
          // Source input is already accepted synchronously. Fault before saving;
          // a missing browser input must not be mistaken for lost recovery data.
          if (cm.getValue() !== expected) {
            throw new Error('Source draft was not delivered before the Worker fault')
          }
          host.crashSourceWorker()
        }, draftText)
      } else {
        if (failure === 'rejected edit' || failure === 'backup failure') {
          await page.evaluate(() => window.__marktextDocumentCore?.staleNextTransaction?.())
        }
        await paragraph.fill(draftText)
        if (failure === 'Worker failure') {
          await page.evaluate(() => window.__marktextDocumentCore?.crashWorker?.())
        }
      }
      if (failure === 'backup failure') {
        await expect(page.getByRole('textbox', { name: 'Recovered draft text' })).toHaveValue(
          draftText
        )
        await expect(page.getByRole('textbox', { name: 'Recovered draft text' })).toHaveCSS(
          'direction',
          'rtl'
        )
        expect(await page.evaluate(() => window.__marktextDocumentCore?.generation)).toBe(
          initialGeneration
        )
        expect(readFileSync(obstruction, 'utf8')).toBe('existing bytes must survive')
        renameSync(obstruction, join(profile, 'preserved-obstruction'))
        await page.getByRole('button', { name: 'Retry backup' }).click()
      }
      const recovered = page.getByTestId('core-recovery-draft')
      await expect(recovered.getByRole('textbox', { name: 'Recovered draft text' })).toHaveValue(
        draftText
      )
      if (failure === 'backup failure') {
        await expect(recovered.getByRole('textbox', { name: 'Recovered draft text' })).toHaveCSS(
          'direction',
          'rtl'
        )
      }
      await page.waitForFunction(
        (generation) => window.__marktextDocumentCore?.generation !== generation,
        initialGeneration
      )
      const records = await page.evaluate(() =>
        window.electron.ipcRenderer.invoke('mt::core-draft::list')
      )
      expect(records).toHaveLength(1)
      const artifactPath = records[0].artifactPath
      const artifactBytes = readFileSync(artifactPath)
      expect(JSON.parse(artifactBytes.toString())).toMatchObject({
        visibleText: draftText,
        pathname: filePath
      })
      if (app === undefined) throw new Error('Electron application is unavailable')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      const savedText =
        failure === 'Source Worker failure'
          ? draftText
          : (failure === 'synchronous input burst' || failure === 'Worker failure'
            ? draftText
            : acceptedText) + '\n'
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(savedText)
      await app.close()
      app = undefined
      const reopened = await launch()
      const backup = reopened.getByTestId('core-recovery-draft')
      await expect(backup.getByRole('textbox', { name: 'Recovered draft text' })).toHaveValue(
        draftText
      )
      if (failure === 'backup failure') {
        await expect(backup.getByRole('textbox', { name: 'Recovered draft text' })).toHaveCSS(
          'direction',
          'rtl'
        )
      }
      await backup.getByRole('button', { name: 'I have recovered this draft' }).click()
      await expect(backup).toHaveCount(0)
      expect(readFileSync(artifactPath)).toEqual(artifactBytes)
    } finally {
      if (
        failure === 'backup failure' &&
        existsSync(obstruction) &&
        !existsSync(join(profile, 'preserved-obstruction'))
      ) {
        renameSync(obstruction, join(profile, 'preserved-obstruction'))
        const page = await app?.firstWindow()
        const retry = page?.getByRole('button', { name: 'Retry backup' })
        if (await retry?.isVisible()) await retry?.click()
      }
      await app?.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
}

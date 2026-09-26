import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'
import {
  discardReviewInputOnClose,
  enterSourceMode,
  exitSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

const languagePreferences = (enabled: boolean) => ({
  superSubScript: enabled,
  footnote: enabled,
  texMathGfm: enabled
})

// Exercise the same main-process persistence/broadcast boundary as Preferences.
// Each launch owns a temporary profile; this never changes the user's settings.
const setLanguagePreferences = async(page: Page, enabled: boolean): Promise<void> => {
  await page.evaluate((preferences) => {
    window.electron.ipcRenderer.send('mt::set-user-preference', preferences)
  }, languagePreferences(enabled))
}

const attachPreferenceDiagnostics = async(page: Page, filePath: string): Promise<void> => {
  // Preserve the actual recovery reason and native intent before the owned
  // temporary profile closes; the banner intentionally shows only the draft.
  const diagnostics = await page.evaluate(async() => ({
    drafts: await window.electron.ipcRenderer.invoke('mt::core-draft::list'),
    latest: window.__marktextDocumentCore?.latest(),
    events: window.__marktextDocumentCore?.performanceEvents?.(),
    editorText: document.querySelector('.editor-component')?.textContent,
    sourceText: document.querySelector('.source-code')?.textContent
  }))
  const diagnosticPath = test.info().outputPath('preference-recovery-diagnostics.json')
  writeFileSync(
    diagnosticPath,
    JSON.stringify({ ...diagnostics, savedSource: readFileSync(filePath, 'utf8') }, null, 2)
  )
  await test.info().attach('preference-recovery-diagnostics', {
    path: diagnosticPath,
    contentType: 'application/json'
  })
}

const languageSource =
  'H~2~O and 2^n^; note[^a].\n\n[^a]: Footnote body.\n\n' +
  '```math\nx^2\n```\n\nText.{>>Comment 2^n^.<<}\n'

test('supported Markdown preferences apply live and when another document opens', async() => {
  const { app, page, filePath } = await launchWithMarkdown(languageSource, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  const nextFile = join(dirname(filePath), 'preferences-open.md')
  const nextSource = '# Opened with preferences\n\n' + languageSource
  writeFileSync(nextFile, nextSource, { flag: 'wx' })
  try {
    // MarkText's fresh-profile defaults are false for all three options. Set
    // the control explicitly as well so this fixture does not depend on Core's
    // standalone defaults or future changes to application defaults.
    await setLanguagePreferences(page, false)
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    await page.getByTestId('critic-review-revised').click()
    const projection = page.locator('[data-projection="revised"]')
    await expect(projection.locator('sub')).toHaveCount(0)
    await expect(projection.locator('.footnotes')).toHaveCount(0)
    await expect(projection.locator('.katex')).toHaveCount(0)

    await setLanguagePreferences(page, true)
    await expect(projection.locator('sub')).toHaveText('2')
    await expect(projection.locator('sup:not(.footnote-ref)')).toHaveText('n')
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expect(projection.locator('.footnotes')).toContainText('Footnote body.')
    await expect(projection.locator('.katex')).toBeVisible()
    await expect(page.locator('[data-projection="comment"] sup')).toHaveText('n')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(languageSource)

    await page.getByTestId('critic-review-markup').click()
    await page.evaluate((path) => window.electron.ipcRenderer.send('mt::open-file', path), nextFile)
    await expect(page.locator('.editor-component')).toContainText('Opened with preferences')
    await page.getByTestId('critic-review-revised').click()
    await expect(projection.locator('sub')).toHaveText('2')
    await expect(projection.locator('.footnotes')).toContainText('Footnote body.')
    await expect(projection.locator('.katex')).toBeVisible()

    await setLanguagePreferences(page, false)
    await expect(projection.locator('sub')).toHaveCount(0)
    await expect(projection.locator('.footnotes')).toHaveCount(0)
    await expect(projection.locator('.katex')).toHaveCount(0)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(nextFile, 'utf8')).toBe(nextSource)
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } catch (error) {
    await attachPreferenceDiagnostics(page, filePath)
    throw error
  } finally {
    await app.close()
  }
})

for (const mode of ['Markup', 'Source'] as const) {
  test(`${mode} pending composition and undo history survive a live Markdown preference change`, async() => {
    const source = 'seed\n\nH~2~O\n\nText.{>>Note.<<}\n'
    const { app, page, filePath } = await launchWithMarkdown(source, {
      suppressErrorDialog: true,
      env: {
        MARKTEXT_E2E_HIDDEN_WINDOW: '1',
        MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
      }
    })
    const cdp = await page.context().newCDPSession(page)
    try {
      await expectDefaultCoreAuthority(page)
      if (process.env.MARKTEXT_PACKAGED_APP) await expectInstalledArtifactCommit(page)
      if (mode === 'Source') {
        await enterSourceMode(page, app)
        await page.evaluate(() => {
          const host = document.querySelector('.source-code .CodeMirror') as Element & {
            CodeMirror: { focus(): void; setCursor(position: { line: number; ch: number }): void }
          }
          host.CodeMirror.focus()
          host.CodeMirror.setCursor({ line: 0, ch: 4 })
        })
      } else {
        await page.locator('.mu-paragraph-content').first().click()
        await page.keyboard.press('End')
      }
      const traceStart = await page.evaluate(
        () => window.__marktextDocumentCore?.performanceEvents?.().length ?? 0
      )
      await page.evaluate(() => {
        const probe = {
          active: false,
          startedTrusted: false,
          composingInputTrusted: false,
          preferenceReceived: false,
          settled: false,
          error: ''
        }
        const receivedPreferences = new Set<string>()
        document.addEventListener(
          'compositionstart',
          (event) => {
            probe.active = true
            probe.startedTrusted = event.isTrusted
          },
          true
        )
        document.addEventListener(
          'compositionend',
          () => {
            probe.active = false
          },
          true
        )
        document.addEventListener(
          'input',
          (event) => {
            if (event instanceof InputEvent && event.isComposing && event.isTrusted) {
              probe.composingInputTrusted = true
            }
          },
          true
        )
        window.electron.ipcRenderer.on('mt::user-preference', (_event, preferences) => {
          if (typeof preferences === 'object' && preferences !== null) {
            // Main persists and broadcasts each preference separately.
            for (const key of ['superSubScript', 'footnote', 'texMathGfm']) {
              if ((preferences as Record<string, unknown>)[key] === true) {
                receivedPreferences.add(key)
              }
            }
            probe.preferenceReceived = receivedPreferences.size === 3
          }
        })
        ;(
          window as unknown as { preferenceCompositionProbe: typeof probe }
        ).preferenceCompositionProbe = probe
      })
      // Chromium supplies the real composition/input events and native draft.
      // The synchronous model has no Worker reply to hold; active composition
      // is the actual pending-input boundary for both native editors.
      await cdp.send('Input.imeSetComposition', { text: 'X', selectionStart: 1, selectionEnd: 1 })
      const draft = page
        .locator(mode === 'Source' ? '.source-code .CodeMirror-line' : '.mu-paragraph-content')
        .first()
      await expect(draft).toHaveText('seedX')
      await page.evaluate(() => {
        const probe = (
          window as unknown as {
            preferenceCompositionProbe: { settled: boolean; error: string }
          }
        ).preferenceCompositionProbe
        const core = window.__marktextDocumentCore
        if (!core) throw new Error('Missing Core composition owner')
        core.settled().then(
          () => {
            probe.settled = true
          },
          (error) => {
            probe.error = String(error)
          }
        )
      })
      await setLanguagePreferences(page, true)
      const compositionProbe = () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                preferenceCompositionProbe: {
                  active: boolean
                  startedTrusted: boolean
                  composingInputTrusted: boolean
                  preferenceReceived: boolean
                  settled: boolean
                  error: string
                }
              }
            ).preferenceCompositionProbe
        )
      await expect.poll(compositionProbe).toMatchObject({ preferenceReceived: true })
      // Source configuration crosses a deferred native change-delivery turn.
      // Observe after that turn: delivery happened, but neither the draft nor
      // the queued configuration may commit while composition is active.
      await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
      expect(await compositionProbe()).toEqual({
        active: true,
        startedTrusted: true,
        composingInputTrusted: true,
        preferenceReceived: true,
        settled: false,
        error: ''
      })
      expect(
        await page.evaluate(
          (offset) =>
            window.__marktextDocumentCore
              ?.performanceEvents?.()
              .slice(offset)
              .filter((event) => event.phase === 'dispatch'),
          traceStart
        )
      ).toEqual([])
      await expect(draft).toHaveText('seedX')
      if (mode === 'Markup') await expect(page.locator('.editor-component sub')).toHaveCount(0)
      await cdp.send('Input.insertText', { text: 'X' })
      await page.keyboard.type('Y')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect
        .poll(() => readFileSync(filePath, 'utf8'))
        .toBe('seedXY\n\nH~2~O\n\nText.{>>Note.<<}\n')
      expect(await compositionProbe()).toMatchObject({ active: false, settled: true, error: '' })
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect
        .poll(() => readFileSync(filePath, 'utf8'))
        .toBe('seedX\n\nH~2~O\n\nText.{>>Note.<<}\n')
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect
        .poll(() => readFileSync(filePath, 'utf8'))
        .toBe('seedX\n\nH~2~O\n\nText.{>>Note.<<}\n')
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect
        .poll(() => readFileSync(filePath, 'utf8'))
        .toBe('seedXY\n\nH~2~O\n\nText.{>>Note.<<}\n')
      if (mode === 'Source') await exitSourceMode(page, app)
      await page.getByRole('button', { name: 'Review', exact: true }).click()
      await page.getByTestId('critic-review-revised').click()
      await expect(page.locator('[data-projection="revised"] sub')).toHaveText('2')
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expectNoRendererErrors(app)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
    } catch (error) {
      await attachPreferenceDiagnostics(page, filePath)
      throw error
    } finally {
      // A failed pending-state assertion must not leave the owned application
      // waiting for unfinished native composition during its normal close.
      try {
        await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
      } finally {
        try {
          await cdp.detach()
        } finally {
          await app.close()
        }
      }
    }
  })
}

test('live Markdown preferences retain the mounted comment composer and its unsubmitted draft', async() => {
  const source = 'H~2~O.{>>Original note.<<}\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.locator('.mu-critic-comment-marker').click()
    await page.getByTestId('critic-review-edit-comment').click()
    const input = page.getByTestId('critic-review-comment-input')
    await input.fill('Unsubmitted 日本 draft.')
    const mountedInput = await input.elementHandle()
    if (!mountedInput) throw new Error('Expected mounted comment composer')
    await setLanguagePreferences(page, true)
    await expect(page.locator('.editor-component sub')).toHaveText('2')
    await expect(input).toHaveValue('Unsubmitted 日本 draft.')
    expect(
      await mountedInput.evaluate(
        (node) =>
          node.isConnected &&
          node === document.querySelector('[data-testid="critic-review-comment-input"]')
      )
    ).toBe(true)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect(input).toHaveValue('Unsubmitted 日本 draft.')
    await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } catch (error) {
    await attachPreferenceDiagnostics(page, filePath)
    throw error
  } finally {
    await discardReviewInputOnClose(app)
    await app.close()
  }
})

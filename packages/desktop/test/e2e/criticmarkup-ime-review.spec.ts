import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown as launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

// CDP drives Chromium's real composition pipeline, including trusted native
// events and selection. It does not exercise an operating-system IME panel.
// Core acknowledges native input synchronously. 'consecutive' starts the
// composition straight after typing, without waiting for the editor to settle.
for (const timing of ['consecutive', 'normal delivery'] as const) {
  for (const lane of ['ordinary', 'markup', 'tracked'] as const) {
    test(`preserves Chromium IME with ${lane} input and ${timing}`, async() => {
      const source = lane === 'markup' ? '{++seed++}\n' : 'seed\n'
      const { app, page, filePath } = await launchWithMarkdown(source, {
        suppressErrorDialog: true,
        env: {
          MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
          MARKTEXT_E2E_HIDDEN_WINDOW: '1'
        }
      })
      let cdp: Awaited<ReturnType<ReturnType<typeof page.context>['newCDPSession']>> | undefined
      try {
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
        if (process.env.MARKTEXT_PACKAGED_APP) await expectInstalledArtifactCommit(page)
        await expectDefaultCoreAuthority(page)
        const paragraph = page.locator('span.mu-paragraph-content').first()
        await expect(paragraph).toHaveAttribute('contenteditable', 'true')
        if (lane === 'tracked') await page.getByTestId('critic-review-track-changes').click()
        await paragraph.click()
        await page.keyboard.press('End')
        cdp = await page.context().newCDPSession(page)
        await page.evaluate(() => {
          const events: Array<{ type: string; trusted: boolean; composing: boolean }> = []
          const state = window as unknown as { imeEvents: typeof events }
          state.imeEvents = events
          for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'input']) {
            document.addEventListener(
              type,
              (event) => {
                events.push({
                  type,
                  trusted: event.isTrusted,
                  composing: event instanceof InputEvent && event.isComposing
                })
              },
              true
            )
          }
        })

        await page.keyboard.type('X')
        if (timing === 'normal delivery') {
          await page.evaluate(() => window.__marktextDocumentCore?.settled())
        }
        await cdp.send('Input.imeSetComposition', {
          text: '日',
          selectionStart: 1,
          selectionEnd: 1
        })
        await expect(paragraph).toHaveText('seedX日')
        await expect
          .poll(() =>
            page.evaluate(() =>
              window.__marktextDocumentCore
                ?.performanceEvents?.()
                .some((event) => event.phase === 'reconcile')
            )
          )
          .toBe(true)
        await expect(paragraph).toHaveText('seedX日')
        await cdp.send('Input.imeSetComposition', {
          text: '日本',
          selectionStart: 2,
          selectionEnd: 2
        })
        await expect(paragraph).toHaveText('seedX日本')
        // Chromium commits an active composition through insertText; no synthetic
        // composition events or editor mutation bridges are used by this test.
        await cdp.send('Input.insertText', { text: '日本' })
        await page.evaluate(() => window.__marktextDocumentCore?.settled())
        await expect(paragraph).toHaveText('seedX日本')
        const events = await page.evaluate(
          () =>
            (
              window as unknown as {
                imeEvents: Array<{ type: string; trusted: boolean; composing: boolean }>
              }
            ).imeEvents
        )
        expect(events.filter((event) => event.type === 'compositionstart')).toEqual([
          { type: 'compositionstart', trusted: true, composing: false }
        ])
        // Electron's CDP insertText commit currently marks its compositionend
        // untrusted, although compositionstart and intermediate input are trusted.
        expect(events.filter((event) => event.type === 'compositionend')).toHaveLength(1)
        expect(
          events.some((event) => event.type === 'input' && event.trusted && event.composing)
        ).toBe(true)
        await test.info().attach('chromium-composition-events', {
          body: JSON.stringify(events, null, 2),
          contentType: 'application/json'
        })

        const expected =
          lane === 'ordinary'
            ? 'seedX日本\n'
            : lane === 'markup'
              ? '{++seedX日本++}\n'
              : 'seed{++X日本++}\n'
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
        // Dispatch the real app menu action: a hidden macOS window does not own
        // the OS accelerator, even when CDP delivers a renderer key event.
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await page.evaluate(() => window.__marktextDocumentCore?.settled())
        await expect(paragraph).toHaveText('seedX')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect
          .poll(() => readFileSync(filePath, 'utf8'))
          .toBe(
            lane === 'ordinary' ? 'seedX\n' : lane === 'markup' ? '{++seedX++}\n' : 'seed{++X++}\n'
          )
        await expectNoRendererErrors(app)
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
      } finally {
        // An open composition keeps the window from closing; end it so a
        // failure reports its assertion instead of a teardown timeout.
        await cdp?.send('Input.insertText', { text: '' }).catch(() => {})
        await app.close()
      }
    })
  }
}

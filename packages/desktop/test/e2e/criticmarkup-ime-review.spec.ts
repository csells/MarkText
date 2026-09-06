import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expectDefaultCoreAuthority, expectInstalledArtifactCommit } from './installedArtifactProvenance'

import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

// CDP drives Chromium's real composition pipeline, including trusted native
// events and selection. It does not exercise an operating-system IME panel.
for (const timing of ['pending acknowledgement', 'normal delivery'] as const) {
  for (const lane of ['ordinary', 'markup', 'tracked'] as const) {
    test(`preserves Chromium IME with ${lane} input and ${timing}`, async() => {
      const source = lane === 'markup' ? '{++seed++}\n' : 'seed\n'
      const { app, page, filePath } = await launchWithMarkdown(source, {
        suppressErrorDialog: true,
        env: {
          MARKTEXT_DOCUMENT_CORE_MODE: undefined,
          MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
          MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: timing === 'pending acknowledgement' ? '1' : undefined,
          MARKTEXT_E2E_HIDDEN_WINDOW: '1'
        }
      })
      try {
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
        if (process.env.MARKTEXT_PACKAGED_APP) await expectInstalledArtifactCommit(page)
        if (timing === 'normal delivery') await expectDefaultCoreAuthority(page)
        const paragraph = page.locator('span.mu-paragraph-content').first()
        await expect(paragraph).toHaveAttribute('contenteditable', 'true')
        if (lane === 'tracked') await page.getByTestId('critic-review-track-changes').click()
        await paragraph.click()
        await page.keyboard.press('End')
        const cdp = await page.context().newCDPSession(page)
        await page.evaluate(() => {
          const events: Array<{ type: string, trusted: boolean, composing: boolean }> = []
          const state = window as unknown as { imeEvents: typeof events, imeStartedBeforeAck?: boolean }
          state.imeEvents = events
          for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'input']) {
            document.addEventListener(type, event => {
              if (type === 'compositionstart') {
                state.imeStartedBeforeAck =
                  !window.__marktextDocumentCore?.performanceEvents?.().some(event => event.phase === 'ack')
              }
              events.push({ type, trusted: event.isTrusted, composing: event instanceof InputEvent && event.isComposing })
            }, true)
          }
        })

        await page.keyboard.type('X')
        if (timing === 'pending acknowledgement') {
          await expect.poll(() => page.evaluate(() =>
            window.__marktextDocumentCore?.performanceEvents?.().some(event => event.phase === 'dispatch')
          ), { intervals: [5, 10, 20] }).toBe(true)
        } else {
          await page.evaluate(() => window.__marktextDocumentCore?.settled())
        }
        await cdp.send('Input.imeSetComposition', { text: '日', selectionStart: 1, selectionEnd: 1 })
        await expect(paragraph).toHaveText('seedX日')
        // Existing test controls delay Worker replies by 250 ms. Assert that the
        // composition actually began inside that interval, rather than guessing.
        if (timing === 'pending acknowledgement') {
          expect(await page.evaluate(() =>
            (window as unknown as { imeStartedBeforeAck?: boolean }).imeStartedBeforeAck
          )).toBe(true)
        }
        await expect.poll(() => page.evaluate(() =>
          window.__marktextDocumentCore?.performanceEvents?.().some(event => event.phase === 'reconcile')
        )).toBe(true)
        await expect(paragraph).toHaveText('seedX日')
        await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 })
        await expect(paragraph).toHaveText('seedX日本')
        // Chromium commits an active composition through insertText; no synthetic
        // composition events or editor mutation bridges are used by this test.
        await cdp.send('Input.insertText', { text: '日本' })
        await page.evaluate(() => window.__marktextDocumentCore?.settled())
        await expect(paragraph).toHaveText('seedX日本')
        const events = await page.evaluate(() =>
          (window as unknown as { imeEvents: Array<{ type: string, trusted: boolean, composing: boolean }> }).imeEvents
        )
        expect(events.filter(event => event.type === 'compositionstart')).toEqual([
          { type: 'compositionstart', trusted: true, composing: false }
        ])
        // Electron's CDP insertText commit currently marks its compositionend
        // untrusted, although compositionstart and intermediate input are trusted.
        expect(events.filter(event => event.type === 'compositionend')).toHaveLength(1)
        expect(events.some(event => event.type === 'input' && event.trusted && event.composing)).toBe(true)
        await test.info().attach('chromium-composition-events', {
          body: JSON.stringify(events, null, 2), contentType: 'application/json'
        })

        const expected = lane === 'ordinary'
          ? 'seedX日本\n'
          : lane === 'markup' ? '{++seedX日本++}\n' : 'seed{++X日本++}\n'
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
        // Dispatch the real app menu action: a hidden macOS window does not own
        // the OS accelerator, even when CDP delivers a renderer key event.
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await page.evaluate(() => window.__marktextDocumentCore?.settled())
        await expect(paragraph).toHaveText('seedX')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(lane === 'ordinary'
          ? 'seedX\n'
          : lane === 'markup' ? '{++seedX++}\n' : 'seed{++X++}\n')
        await expectNoRendererErrors(app)
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
      } finally {
        await app.close()
      }
    })
  }
}

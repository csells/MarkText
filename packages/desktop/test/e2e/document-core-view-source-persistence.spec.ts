import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import * as fs from 'node:fs'
import {
  clickMenuById,
  closeElectron,
  enterSourceMode,
  exitSourceMode,
  expectNoCapturedErrors,
  launchWithMarkdown,
  placeCaretInEditor,
  typeIntoEditor
} from './helpers'
import { expectCanonicalOnDisk } from './documentCoreReviewE2e'

const INITIAL = [
  '# One canonical head',
  '',
  'Added {++ADDED_ONLY++}.',
  'Deleted {--DELETED_ONLY--}.',
  'Changed {~~BEFORE_ONLY~>AFTER_ONLY~~}.',
  'Marked {==HIGHLIGHTED==}.',
  '{>>COMMENT_ONLY<<}',
  ''
].join('\n')

test.describe('document-core view and Source persistence', () => {
  test.describe.configure({ timeout: 90_000 })

  // The autosave toggle round-trips main before the renderer store acts on
  // it; the settled fact is the mt::user-preference broadcast carrying the
  // new value into this window. Record it page-side and poll it.
  const observeAutoSavePreference = (page: Page): Promise<void> =>
    page.evaluate(() => {
      const scope = window as Window & {
        __mtAutoSaveObserved?: boolean
        electron: {
          ipcRenderer: {
            on: (
              channel: string,
              listener: (event: unknown, payload: unknown) => void
            ) => void
          }
        }
      }
      scope.electron.ipcRenderer.on(
        'mt::user-preference',
        (_event, payload) => {
          const autoSave = (payload as { autoSave?: unknown } | null)?.autoSave
          if (typeof autoSave === 'boolean') {
            scope.__mtAutoSaveObserved = autoSave
          }
        }
      )
    })

  const observedAutoSave = (page: Page): Promise<boolean | undefined> =>
    page.evaluate(() =>
      (window as Window & { __mtAutoSaveObserved?: boolean })
        .__mtAutoSaveObserved
    )

  test('all views and Source persist one canonical head', async() => {
    let app: ElectronApplication | undefined

    try {
      const launched = await launchWithMarkdown(INITIAL)
      app = launched.app
      const { page, filePath } = launched

      // Exercise the real autosave transaction before changing surfaces.
      await observeAutoSavePreference(page)
      await clickMenuById(app, 'autoSaveMenuItem')
      await expect.poll(() => observedAutoSave(page)).toBe(true)
      await placeCaretInEditor(page)
      await typeIntoEditor(page, ' autosaved')
      // Autosave is the transaction under test: the file itself must
      // converge on the edited head with no manual save.
      await expect.poll(
        () => fs.readFileSync(filePath, 'utf8'),
        { timeout: 10_000 }
      ).toContain(' autosaved')
      const autosavedHead = fs.readFileSync(filePath, 'utf8')
      await clickMenuById(app, 'autoSaveMenuItem')
      await expect.poll(() => observedAutoSave(page)).toBe(false)

      const sourceHead =
        autosavedHead +
        (autosavedHead.endsWith('\n') ? '' : '\n') +
        'Source tail {++SOURCE_MARKER++}.\n'

      await enterSourceMode(page, app)
      const input = page.locator('.source-code-input')
      await input.fill(sourceHead)
      await expect(input).toHaveValue(sourceHead)

      // Save while the Source adapter is still mounted. The flush must wait
      // for its admitted input, then main leases and writes the canonical
      // revision; the textarea never supplies persistence bytes.
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(
        sourceHead
      )
      await exitSourceMode(page, app)
      await expectCanonicalOnDisk(page, app, filePath, sourceHead)

      const projectionAssertions = [
        {
          menuId: 'reviewShowOriginalMenuItem',
          projection: 'original',
          present: ['DELETED_ONLY', 'BEFORE_ONLY'],
          absent: ['ADDED_ONLY', 'AFTER_ONLY', 'SOURCE_MARKER']
        },
        {
          menuId: 'reviewShowRevisedMenuItem',
          projection: 'revised',
          present: ['ADDED_ONLY', 'AFTER_ONLY', 'SOURCE_MARKER'],
          absent: ['DELETED_ONLY', 'BEFORE_ONLY']
        },
        {
          menuId: 'reviewShowMarkedMenuItem',
          projection: 'marked',
          present: [
            'ADDED_ONLY',
            'DELETED_ONLY',
            'BEFORE_ONLY',
            'AFTER_ONLY',
            'SOURCE_MARKER'
          ],
          absent: []
        }
      ] as const

      for (const row of projectionAssertions) {
        await clickMenuById(app, row.menuId)
        const editor = page.locator('.editor-component')
        await expect(editor).toHaveAttribute(
          'data-critic-projection',
          row.projection
        )
        for (const text of row.present) await expect(editor).toContainText(text)
        for (const text of row.absent) {
          await expect(editor).not.toContainText(text)
        }
        await expectCanonicalOnDisk(page, app, filePath, sourceHead)
      }

      // Persisting from a projected view still writes canonical CriticMarkup,
      // never the Original/Revised presentation.
      await placeCaretInEditor(page)
      await typeIntoEditor(page, ' projected-save')
      // The edit's arrival is observed in the mounted view; reading canonical
      // bytes here would save and destroy the unsaved-window assert below.
      await expect(page.locator('.editor-component')).toContainText(
        ' projected-save'
      )
      expect(fs.readFileSync(filePath, 'utf8')).toBe(sourceHead)
      await clickMenuById(app, 'reviewShowRevisedMenuItem')
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toContain(
        ' projected-save'
      )
      const projectedHead = fs.readFileSync(filePath, 'utf8')
      expect(projectedHead).not.toBe(sourceHead)
      // Written from the Revised projection, yet the bytes are canonical
      // CriticMarkup — the markers survive, not their projected spelling.
      expect(projectedHead).toContain('{++SOURCE_MARKER++}')
      expect(projectedHead).toContain('{--DELETED_ONLY--}')

      await enterSourceMode(page, app)
      await expect(page.locator('.source-code-input')).toHaveValue(projectedHead)
      await exitSourceMode(page, app)
      await expectCanonicalOnDisk(page, app, filePath, projectedHead)
      await expectNoCapturedErrors(app)
    } finally {
      if (app !== undefined) {
        await closeElectron(app).catch(() => undefined)
      }
    }
  })
})

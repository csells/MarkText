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
  readCanonicalMarkdown,
  typeIntoEditor
} from './helpers'

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

  test('all views and Source persist one canonical head', async() => {
    let app: ElectronApplication | undefined

    try {
      const launched = await launchWithMarkdown(INITIAL)
      app = launched.app
      const { page, filePath } = launched

      // Exercise the real autosave transaction before changing surfaces.
      await clickMenuById(app, 'autoSaveMenuItem')
      await page.waitForTimeout(100)
      await placeCaretInEditor(page)
      await typeIntoEditor(page, ' autosaved')
      await expect.poll(() => readCanonicalMarkdown(page)).toContain(
        ' autosaved'
      )
      const autosavedHead = await readCanonicalMarkdown(page)
      await expect.poll(
        () => fs.readFileSync(filePath, 'utf8'),
        { timeout: 10_000 }
      ).toBe(autosavedHead)
      await clickMenuById(app, 'autoSaveMenuItem')
      await page.waitForTimeout(100)

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
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(sourceHead)

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
        expect(await readCanonicalMarkdown(page)).toBe(sourceHead)
      }

      // Persisting from a projected view still writes canonical CriticMarkup,
      // never the Original/Revised presentation.
      await placeCaretInEditor(page)
      await typeIntoEditor(page, ' projected-save')
      await expect.poll(() => readCanonicalMarkdown(page)).toContain(
        ' projected-save'
      )
      const projectedHead = await readCanonicalMarkdown(page)
      expect(projectedHead).not.toBe(sourceHead)
      expect(fs.readFileSync(filePath, 'utf8')).toBe(sourceHead)
      await clickMenuById(app, 'reviewShowRevisedMenuItem')
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(
        projectedHead
      )

      await enterSourceMode(page, app)
      await expect(page.locator('.source-code-input')).toHaveValue(projectedHead)
      await exitSourceMode(page, app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(projectedHead)
      await expectNoCapturedErrors(app)
    } finally {
      if (app !== undefined) {
        await closeElectron(app).catch(() => undefined)
      }
    }
  })
})

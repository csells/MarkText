import * as fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { clickMenuById, closeElectron } from './helpers'
import {
  openReviewSidebar,
  selectDomText
} from './documentCoreReviewE2e'
import {
  closeInstalled,
  createInstalledFixture
} from './installedDocumentCoreE2e'

const MARKUP =
  'head {++add++} {--old--} {~~before~>after~~} ' +
  '{==mark==}{>>note<<} base\n'

test.describe('installed document-core full workflow', () => {
  test.describe.configure({ timeout: 180_000 })

  test('completes author edit resolve consume persist and reopen', async() => {
    const fixture = createInstalledFixture(MARKUP)
    let app: ElectronApplication | undefined
    try {
      let launched = await fixture.launch()
      app = launched.app
      const editor = launched.page.locator('.editor-component')
      await expect(editor.locator('[data-critic-id]').first()).toBeVisible()

      // Consume both parser-derived projections before changing source.
      await clickMenuById(launched.app, 'reviewShowOriginalMenuItem')
      await expect(editor).toContainText('old')
      await expect(editor).toContainText('before')
      await expect(editor).toContainText('base')
      await expect(editor).not.toContainText('add')
      await clickMenuById(launched.app, 'reviewShowRevisedMenuItem')
      await expect(editor).toContainText('add')
      await expect(editor).toContainText('after')
      await expect(editor).not.toContainText('old')
      await clickMenuById(launched.app, 'reviewShowMarkedMenuItem')

      await clickMenuById(launched.app, 'reviewTrackChangesMenuItem')
      await selectDomText(launched.page, 'base')
      await launched.page.keyboard.type('edited')
      await expect(editor.locator('[data-critic-type="substitution"]'))
        .toContainText('edited')

      await openReviewSidebar(launched.page, launched.app)
      await expect(launched.page.locator('.review-card')).toHaveCount(5)
      await clickMenuById(launched.app, 'reviewAcceptAllMenuItem')
      await expect(launched.page.locator('.review-card')).toHaveCount(1)
      await expect(launched.page.locator('.review-card.type-comment'))
        .toHaveCount(1)

      const resolved =
        'head add  after {==mark==}{>>note<<} edited\n'
      await clickMenuById(launched.app, 'fileSaveMenuItem')
      await expect.poll(() => fs.readFileSync(fixture.filePath, 'utf8'))
        .toBe(resolved)
      await closeInstalled(launched.app)
      app = undefined

      launched = await fixture.launch()
      app = launched.app
      await expect(launched.page.locator('.editor-component'))
        .toContainText('head add after mark edited')
      await openReviewSidebar(launched.page, launched.app)
      await expect(launched.page.locator('.review-card')).toHaveCount(1)
      await expect(launched.page.locator('.review-card.type-comment'))
        .toContainText('note')
      expect(fs.readFileSync(fixture.filePath, 'utf8')).toBe(resolved)
    } finally {
      if (app !== undefined) await closeElectron(app)
      fixture.cleanup()
    }
  })
})

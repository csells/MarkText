import * as fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { clickMenuById, closeElectron } from './helpers'
import {
  openReviewSidebar,
  selectWordByPointer
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
      await expect(editor.locator('[data-critic-type]').first()).toBeVisible()

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
      // A user sees the marked projection land before touching it: only
      // marked shows both change arms at once.
      await expect(editor).toContainText('old')
      await expect(editor).toContainText('add')

      // The toggle's state-changed publication re-mounts the document.
      // Wait for that re-mount (the mounted paragraph node is replaced)
      // the way a user waits for the click's visible settling, so the
      // selection gesture below targets the freshly issued coordinates.
      const mountedParagraph = await editor
        .locator('.document-view-paragraph')
        .first()
        .elementHandle()
      await clickMenuById(launched.app, 'reviewTrackChangesMenuItem')
      if (mountedParagraph !== null) {
        await launched.page.waitForFunction(
          (element) => !element.isConnected,
          mountedParagraph
        )
      }
      await selectWordByPointer(launched.page, 'base')
      await launched.page.keyboard.type('edited')
      // One tracked substitution: the deleted arm holds the whole word and
      // the revised arm holds the whole typed run. Per-keystroke
      // fragmentation would leave no single ins carrying 'edited'.
      await expect(
        editor.locator('del').filter({ hasText: 'base' })
      ).toHaveCount(1)
      await expect(
        editor.locator('ins').filter({ hasText: 'edited' })
      ).toHaveCount(1)

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

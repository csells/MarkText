import * as fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { clickMenuById, closeElectron } from './helpers'
import {
  authorComment,
  openReviewSidebar
} from './documentCoreReviewE2e'
import {
  closeInstalled,
  createInstalledFixture
} from './installedDocumentCoreE2e'

test.describe('installed document-core Comment workflow', () => {
  test.describe.configure({ timeout: 180_000 })

  test('completes exact Comment CRUD in the installed artifact', async() => {
    const fixture = createInstalledFixture('alpha target omega\n')
    let app: ElectronApplication | undefined
    try {
      let launched = await fixture.launch()
      app = launched.app
      await openReviewSidebar(launched.page, launched.app)
      await authorComment(
        launched.page,
        launched.app,
        'target',
        'outer {++nested++}\nsecond'
      )
      const card = launched.page.locator('.review-card.type-comment')
      await expect(card).toHaveCount(1)
      await expect(card.locator('.comment-anchor')).toHaveText('target')

      await card.getByRole('button', { name: 'Edit' }).click()
      const editor = card.locator('.comment-edit textarea')
      await expect(editor).toHaveValue('outer {++nested++}\nsecond')
      await editor.fill('edited {--raw--}')
      await card.locator('.comment-edit .submit').click()
      await expect(card.locator('.item-content')).toContainText('edited')

      const annotated =
        'alpha {==target==}{>>edited {--raw--}<<} omega\n'
      await clickMenuById(launched.app, 'fileSaveMenuItem')
      await expect.poll(() => fs.readFileSync(fixture.filePath, 'utf8'))
        .toBe(annotated)
      await closeInstalled(launched.app)
      app = undefined

      launched = await fixture.launch()
      app = launched.app
      await openReviewSidebar(launched.page, launched.app)
      const reopened = launched.page.locator('.review-card.type-comment')
      await expect(reopened).toHaveCount(1)
      await expect(reopened.locator('.item-content')).toContainText('edited')
      await reopened.getByRole('button', { name: 'Remove comment' }).click()
      await expect(reopened).toHaveCount(0)
      await clickMenuById(launched.app, 'fileSaveMenuItem')
      await expect.poll(() => fs.readFileSync(fixture.filePath, 'utf8'))
        .toBe('alpha target omega\n')
      await closeInstalled(launched.app)
      app = undefined

      launched = await fixture.launch()
      app = launched.app
      await expect(launched.page.locator('.editor-component'))
        .toContainText('alpha target omega')
      await openReviewSidebar(launched.page, launched.app)
      await expect(launched.page.locator('.review-card')).toHaveCount(0)
    } finally {
      if (app !== undefined) await closeElectron(app)
      fixture.cleanup()
    }
  })
})

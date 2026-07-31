import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { launchWithDoc } from './helpers'
import {
  expectCanonicalOnDisk,
  authorComment,
  closeDocumentCore,
  launchDocumentCoreWithKeybindings,
  save
} from './documentCoreReviewE2e'

test.describe('document-core Comment persistence', () => {
  test('reopens the exact portable Highlight Comment pair', async() => {
    let app: ElectronApplication | undefined
    let page: Page
    // Review commands ship unbound by default (user-assignable), so the
    // gesture needs a real user keybinding, exactly as the sibling targets do.
    const launched = await launchDocumentCoreWithKeybindings(
      'before target after\n',
      { 'review.add-comment': 'CmdOrCtrl+Alt+Shift+C' }
    )
    app = launched.app
    page = launched.page
    const expected = 'before {==target==}{>>portable note<<} after\n'
    try {
      await authorComment(page, app, 'target', 'portable note')
      await expectCanonicalOnDisk(page, app as ElectronApplication, launched.filePath, expected)
      await save(app)
      await expect.poll(() => readFileSync(launched.filePath, 'utf8')).toBe(
        expected
      )
      await closeDocumentCore(app)
      app = undefined

      const reopened = await launchWithDoc(launched.filePath)
      app = reopened.app
      page = reopened.page
      await expectCanonicalOnDisk(page, app as ElectronApplication, launched.filePath, expected)
      expect(readFileSync(launched.filePath, 'utf8')).toBe(expected)
    } finally {
      await closeDocumentCore(app)
    }
  })
})

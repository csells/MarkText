import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { launchWithDoc, readCanonicalMarkdown } from './helpers'
import {
  authorComment,
  closeDocumentCore,
  launchDocumentCore,
  save
} from './documentCoreReviewE2e'

test.describe('document-core Comment persistence', () => {
  test('reopens the exact portable Highlight Comment pair', async() => {
    let app: ElectronApplication | undefined
    let page: Page
    const launched = await launchDocumentCore('before target after\n')
    app = launched.app
    page = launched.page
    const expected = 'before {==target==}{>>portable note<<} after\n'
    try {
      await authorComment(page, app, 'target', 'portable note')
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(expected)
      await save(app)
      await expect.poll(() => readFileSync(launched.filePath, 'utf8')).toBe(
        expected
      )
      await closeDocumentCore(app)
      app = undefined

      const reopened = await launchWithDoc(launched.filePath)
      app = reopened.app
      page = reopened.page
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(expected)
      expect(readFileSync(launched.filePath, 'utf8')).toBe(expected)
    } finally {
      await closeDocumentCore(app)
    }
  })
})

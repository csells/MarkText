import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readCanonicalMarkdown } from './helpers'
import {
  authorComment,
  closeDocumentCore,
  launchDocumentCoreWithKeybindings,
  pressApplicationMenuAccelerator
} from './documentCoreReviewE2e'

const ADD_COMMENT_ACCELERATOR = 'CmdOrCtrl+Alt+Shift+C'

test.describe('document-core raw Comment authoring', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchDocumentCoreWithKeybindings(
      'before target after\n',
      { 'review.add-comment': ADD_COMMENT_ACCELERATOR }
    )
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => closeDocumentCore(app))

  test('round-trips raw nested Comment input and EOL policy', async() => {
    await authorComment(page, app, 'target', 'outer {++nested++}\nsecond')
    const expected =
      'before {==target==}{>>outer {++nested++}\nsecond<<} after\n'
    await expect.poll(() => readCanonicalMarkdown(page)).toBe(expected)
    await pressApplicationMenuAccelerator(page, app, 'editUndoMenuItem')
    await expect.poll(() => readCanonicalMarkdown(page)).toBe(
      'before target after\n'
    )
  })
})

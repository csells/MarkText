import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeDocumentCore,
  launchDocumentCoreWithKeybindings,
  openReviewSidebar,
  pressApplicationMenuAccelerator,
  reviewMenuEnabled
} from './documentCoreReviewE2e'

interface PublicSelection {
  readonly text: string
  readonly anchorText: string | null
  readonly anchorOffset: number
  readonly focusText: string | null
  readonly focusOffset: number
  readonly editorFocused: boolean
  readonly projection: string | null
}

const readPublicSelection = (page: Page): Promise<PublicSelection | null> =>
  page.evaluate(() => {
    const root = document.querySelector('.editor-component')
    const selection = window.getSelection()
    if (
      root === null ||
      selection === null ||
      selection.anchorNode === null ||
      selection.focusNode === null
    ) {
      return null
    }
    const active = document.activeElement
    return {
      text: selection.toString(),
      anchorText: selection.anchorNode.textContent,
      anchorOffset: selection.anchorOffset,
      focusText: selection.focusNode.textContent,
      focusOffset: selection.focusOffset,
      editorFocused: active === root || (active !== null && root.contains(active)),
      projection: root.getAttribute('data-critic-projection')
    }
  })

const activeReviewId = (page: Page): Promise<string | null> =>
  page.locator('.review-card.active').getAttribute('data-critic-id')

test.describe('document-core Review navigation', () => {
  test.describe.configure({ timeout: 120000 })
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchDocumentCoreWithKeybindings(
      'a {++one++} b {==two {--deep--}==} c {~~old~>new~~}\n',
      {
        'review.show-original': 'CmdOrCtrl+Alt+Shift+O',
        'review.next': 'CmdOrCtrl+Alt+Shift+N',
        'review.previous': 'CmdOrCtrl+Alt+Shift+P'
      }
    )
    app = launched.app
    page = launched.page
    await openReviewSidebar(page, app)
  })

  test.afterAll(async() => {
    if (app) await closeDocumentCore(app)
  })

  test('navigates nested items and hands projection focus back exactly', async() => {
    await pressApplicationMenuAccelerator(
      page,
      app,
      'reviewShowOriginalMenuItem'
    )
    await expect(page.locator('.editor-component')).toHaveAttribute(
      'data-critic-projection',
      'original'
    )
    await expect(page.locator('.editor-component')).toHaveAttribute(
      'contenteditable',
      'false'
    )

    const nested = page.locator('.review-card.type-deletion').filter({
      hasText: 'deep'
    })
    const nestedId = await nested.getAttribute('data-critic-id')
    expect(nestedId).not.toBeNull()
    await nested.locator('.review-card-focus').click()

    await expect.poll(() => readPublicSelection(page)).toMatchObject({
      text: 'deep',
      anchorText: 'deep',
      anchorOffset: 0,
      focusText: 'deep',
      focusOffset: 4,
      editorFocused: true,
      projection: 'marked'
    })
    await expect(page.locator('.editor-component')).toHaveAttribute(
      'contenteditable',
      'true'
    )
    await expect.poll(() => activeReviewId(page)).toBe(nestedId)

    await expect.poll(() =>
      reviewMenuEnabled(app, 'reviewNextMenuItem')
    ).toBe(true)
    await pressApplicationMenuAccelerator(page, app, 'reviewNextMenuItem')
    const substitution = page.locator('.review-card.type-substitution')
    const substitutionId = await substitution.getAttribute('data-critic-id')
    expect(substitutionId).not.toBeNull()
    await expect.poll(() => activeReviewId(page)).toBe(substitutionId)
    await expect.poll(() => readPublicSelection(page)).toMatchObject({
      text: 'oldnew',
      anchorText: 'old',
      anchorOffset: 0,
      focusText: 'new',
      focusOffset: 3,
      editorFocused: true,
      projection: 'marked'
    })

    await pressApplicationMenuAccelerator(page, app, 'reviewPreviousMenuItem')
    await expect.poll(() => activeReviewId(page)).toBe(nestedId)
    await expect.poll(() => readPublicSelection(page)).toMatchObject({
      text: 'deep',
      anchorText: 'deep',
      anchorOffset: 0,
      focusText: 'deep',
      focusOffset: 4,
      editorFocused: true,
      projection: 'marked'
    })
  })
})

test.describe('document-core annotation-only Review navigation', () => {
  test.describe.configure({ timeout: 120000 })

  test('navigates standalone Highlight and Comment items without enabling bulk resolution', async() => {
    const launched = await launchDocumentCoreWithKeybindings(
      '{==attention==} between {>>point note<<}\n',
      {
        'review.next': 'CmdOrCtrl+Alt+Shift+N',
        'review.previous': 'CmdOrCtrl+Alt+Shift+P'
      }
    )
    const { app, page } = launched
    try {
      await openReviewSidebar(page, app)
      const highlightId = await page.locator(
        '.review-card.type-highlight'
      ).getAttribute('data-critic-id')
      const commentId = await page.locator(
        '.review-card.type-comment'
      ).getAttribute('data-critic-id')
      expect(highlightId).not.toBeNull()
      expect(commentId).not.toBeNull()

      await expect.poll(() =>
        reviewMenuEnabled(app, 'reviewNextMenuItem')
      ).toBe(true)
      await expect.poll(() =>
        reviewMenuEnabled(app, 'reviewPreviousMenuItem')
      ).toBe(true)
      await expect.poll(() =>
        reviewMenuEnabled(app, 'reviewAcceptAllMenuItem')
      ).toBe(false)
      await expect.poll(() =>
        reviewMenuEnabled(app, 'reviewRejectAllMenuItem')
      ).toBe(false)

      await pressApplicationMenuAccelerator(
        page,
        app,
        'reviewNextMenuItem'
      )
      await expect.poll(() => activeReviewId(page)).toBe(highlightId)
      await pressApplicationMenuAccelerator(
        page,
        app,
        'reviewNextMenuItem'
      )
      await expect.poll(() => activeReviewId(page)).toBe(commentId)
      await pressApplicationMenuAccelerator(
        page,
        app,
        'reviewPreviousMenuItem'
      )
      await expect.poll(() => activeReviewId(page)).toBe(highlightId)
    } finally {
      await closeDocumentCore(app)
    }
  })
})

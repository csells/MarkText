import { expect, test } from '@playwright/test'
import { createDocumentCore, type MarkdownAstNode } from '@marktext/document-core'
import { criticMarkupProjectionMediaSource } from '../fixtures/criticmarkupProjectionMedia'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  launchWithDoc,
  sendIpcToRenderer
} from './helpers'

test('reader and comment projections preserve native media rendering and exact source', async() => {
  const root = mkdtempSync(join(tmpdir(), 'marktext-projection-media-'))
  const filePath = join(root, 'review.md')
  const source = criticMarkupProjectionMediaSource
  // A fixture failure must not be mistaken for a media renderer failure.
  const core = createDocumentCore()
  const revision = core.open(source)
  const comments = revision.annotations.filter((annotation) => annotation.kind === 'comment')
  expect(comments).toHaveLength(1)
  const commentKinds = (node: MarkdownAstNode): string[] => [
    node.kind,
    ...node.children.flatMap(commentKinds)
  ]
  expect(commentKinds(core.projectComment(revision, comments[0]).ast.root)).toContain('inline-math')
  writeFileSync(filePath, source)
  writeFileSync(join(root, 'next.md'), '# Local destination\n')
  writeFileSync(
    join(root, 'image.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  )
  const { app, page } = await launchWithDoc(filePath, {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await expect(page.locator('.editor-component .mu-diagram-preview svg')).toBeVisible()
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    const comment = page.locator('[data-projection="comment"]')
    await expect(comment.locator('.katex')).toBeVisible()
    await expect
      .poll(() =>
        comment
          .locator('img')
          .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).naturalWidth))
      )
      .toEqual([1, 1])
    for (const mode of ['original', 'revised'] as const) {
      await page.getByTestId(`critic-review-${mode}`).click()
      const projection = page.locator(`[data-projection="${mode}"]`)
      await expect(projection.locator('.katex')).toBeVisible()
      await expect
        .poll(() =>
          projection
            .locator('img')
            .evaluateAll((images) =>
              images.map((image) => (image as HTMLImageElement).naturalWidth)
            )
        )
        .toEqual([1, 1])
      await expect(projection.locator('.mermaid svg')).toBeVisible()
      await expect(projection.locator('code .token.keyword')).toHaveText('const')
      await expect(projection).toHaveAttribute('aria-busy', 'false')
      await expect(projection.locator('[role="alert"]')).toHaveCount(0)
      await page.screenshot({ path: test.info().outputPath(`media-${mode}.png`) })
    }
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await page
      .locator('[data-projection="revised"]')
      .getByRole('link', { name: 'Next document' })
      .click()
    await expect(page.locator('.editor-component')).toContainText('Local destination')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

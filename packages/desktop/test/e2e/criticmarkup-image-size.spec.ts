import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  enterSourceMode,
  exitSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchElectron,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady,
  showReviewSidebar
} from './helpers'
import {
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

for (const annotated of [false, true]) {
  test(`native image sizing retains ${annotated ? 'independent alt suggestions' : 'plain alt text'} through Source, history and reopen`, async() => {
    const directory = mkdtempSync(join(tmpdir(), 'marktext-image-size-'))
    const filePath = join(directory, 'document.md')
    const imagePath = join(directory, 'beach.svg')
    writeFileSync(
      imagePath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="blue"/></svg>',
      { flag: 'wx' }
    )
    const label = annotated ? 'A {++sunny ++}{++sandy ++}beach{>>keep<<}' : 'A sunny sandy beach'
    const imageSource = `![${label}](${imagePath})`
    const source = `${imageSource}\n`
    const resized = `${imageSource}{width=200}\n`
    const aligned = `${imageSource}{width=200 data-align=center}\n`
    const typed = `${aligned.slice(0, -1)}X\n`
    writeFileSync(filePath, source, { flag: 'wx' })
    const options = {
      suppressErrorDialog: true,
      env: {
        MARKTEXT_E2E_HIDDEN_WINDOW: '1',
        MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
      }
    }
    const { app, page } = await launchElectron([filePath], options)
    let finalSource = typed
    try {
      await waitForEditor(page)
      await waitForMenuReady(app)
      await expectDefaultCoreAuthority(page)
      if (process.env.MARKTEXT_PACKAGED_APP !== undefined) await expectInstalledArtifactCommit(page)
      const image = page.locator('.editor-component .mu-inline-image img')
      await expect
        .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBe(160)
      await image.click()
      const handle = page.locator('.mu-transformer .bar.right')
      await expect(handle).toBeVisible()
      const bounds = await handle.boundingBox()
      if (!bounds) throw new Error('Missing image resize handle')
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await page.mouse.down()
      // The resize bar measures from the left bar's edge (plus its 5px handle
      // radius) and truncates; aim inside the 200px band so fractional layout
      // positions cannot round the result down.
      const left = await page
        .locator('.mu-transformer .bar.left')
        .evaluate((bar) => bar.getBoundingClientRect().left)
      await page.mouse.move(left + 5 + 200.5, bounds.y + bounds.height / 2, {
        steps: 4
      })
      await page.mouse.up()
      await expect(image).toHaveAttribute('width', '200')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(resized)
      // Image edits join upstream's one-second undo step;
      // wait it out so each edit is its own step.
      await page.waitForTimeout(1100)
      await image.click()
      await page.locator('.mu-image-toolbar li.center').click()
      await page.waitForTimeout(1100)
      await page.keyboard.type('X')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(typed)
      for (const expected of [aligned, resized, source]) {
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
      }
      for (const expected of [resized, aligned, typed]) {
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
      }
      await enterSourceMode(page, app)
      expect(
        await page.evaluate(() => {
          const host = document.querySelector('.source-code .CodeMirror') as Element & {
            CodeMirror: { getValue(): string; getCursor(): { line: number; ch: number } }
          }
          return { source: host.CodeMirror.getValue(), caret: host.CodeMirror.getCursor() }
        })
      ).toEqual({ source: typed, caret: { line: 0, ch: typed.length - 1 } })
      await exitSourceMode(page, app)
      await page.keyboard.type('Y')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(`${typed.slice(0, -1)}Y\n`)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(typed)
      if (annotated) {
        await showReviewSidebar(app)
        await page
          .getByTestId('critic-review-entry')
          .filter({ hasText: 'sunny' })
          .locator(':scope > button')
          .click()
        await page.getByTestId('critic-review-accept').click()
        const sunnyAccepted = typed.replace('{++sunny ++}', 'sunny ')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(sunnyAccepted)
        await page
          .getByTestId('critic-review-entry')
          .filter({ hasText: 'sandy' })
          .locator(':scope > button')
          .click()
        await page.getByTestId('critic-review-reject').click()
        finalSource = sunnyAccepted.replace('{++sandy ++}', '')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(finalSource)
        await expect(
          page.getByTestId('critic-review-entry').filter({ hasText: 'keep' })
        ).toBeVisible()
        // Review leaves the caret inside the label, where native image editing
        // exposes Markdown. Moving out restores the preview without an edit.
        await page.locator('.editor-component .mu-paragraph-content').click()
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
        await expect(image).toHaveAttribute('alt', 'A sunny beach')
        await expect(image).toHaveAttribute('width', '200')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(finalSource)
      }
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
    const reopened = await launchElectron([filePath], options)
    try {
      await waitForEditor(reopened.page)
      await expectDefaultCoreAuthority(reopened.page)
      if (process.env.MARKTEXT_PACKAGED_APP !== undefined) {
        await expectInstalledArtifactCommit(reopened.page)
      }
      const image = reopened.page.locator('.editor-component .mu-inline-image img')
      await expect(image).toHaveAttribute('width', '200')
      await expect(image).toHaveAttribute(
        'alt',
        annotated ? 'A sunny beach' : 'A sunny sandy beach'
      )
      await sendIpcToRenderer(reopened.app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(finalSource)
      await expectEditorWindowHidden(reopened.app)
      expectEditorNotFrontmost(reopened.app)
      await expectNoRendererErrors(reopened.app)
    } finally {
      await reopened.app.close()
    }
  })
}

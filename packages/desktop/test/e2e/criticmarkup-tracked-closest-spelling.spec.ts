import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchElectron,
  launchWithReviewMarkdown,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import { clickText, expectSaved, hiddenCoreEnv as env, nativeKey, nextFrame } from './reviewGestures'

// Owner decision, 6 October: typing is never refused and never interrupted.
// An edit no tracked spelling holds exactly is recorded with the closest one:
// Accept All and Reject All give the operation, and resolving one suggestion
// alone is what the CriticMarkup syntax allows (Profile 2, plan 0012 G47).
// Every step uses the real keyboard and mouse; the saved file is the oracle.

const undo = (app: ElectronApplication) => nativeKey(app, 'Z', ['meta'])
const redo = (app: ElectronApplication) => nativeKey(app, 'Z', ['meta', 'shift'])
const settled = (page: Page) => page.evaluate(() => window.__marktextDocumentCore?.settled())

/** The rendered text just before and after the caret, and any selected text. */
const caretContext = (page: Page) => page.evaluate(() => {
  const selection = window.getSelection()
  const node = selection?.focusNode
  if (!selection || !node || !document.querySelector('.editor-component')?.contains(node)) return null
  const text = node.textContent ?? ''
  const at = selection.focusOffset
  return { before: text.slice(Math.max(0, at - 6), at), after: text.slice(at, at + 6), selected: selection.toString() }
})

/** No dialog, message, notification or recovery prompt interrupts typing. */
const expectNoNotice = async(page: Page): Promise<void> => {
  await expect(page.locator('.el-message, .el-notification, .el-message-box, [role="alertdialog"]')).toHaveCount(0)
  await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
}

const expectHealthy = async(app: ElectronApplication, page: Page): Promise<void> => {
  await expectNoNotice(page)
  await expectEditorWindowHidden(app)
  expectEditorNotFrontmost(app)
  await expectNoRendererErrors(app)
}

const reviewEntries = (page: Page) => page.getByTestId('critic-review-entry')

const shapes = [
  {
    name: 'an unclosed fence ending the document with its own closer',
    source: '```\nconst value2 = 2\n~~}\n',
    // A Deletion and an Addition, alike while pending.
    tracked: '{--```\nconst value2 = 2\n~~}\n--}{++```\nconst que2 = 2\n~~}\n++}'
  },
  {
    name: 'the same fence without a final line break',
    source: '```\nconst value2 = 2\n~~}',
    // The last line stays outside, a stray closer until the suggestion resolves.
    tracked: '{~~```\nconst value2 = 2\n~>```\nconst que2 = 2\n~~}~~}'
  }
] as const

for (const shape of shapes) {
  test(`records typing over text in ${shape.name}`, async() => {
    const { source } = shape
    const untracked = source.replace('val', 'q')
    const { app, page, filePath } = await launchWithReviewMarkdown(source, { suppressErrorDialog: true, env })
    let reopened: Awaited<ReturnType<typeof launchElectron>> | undefined
    try {
      await page.getByTestId('critic-review-track-changes').click()
      // Select `val` with the mouse and the keyboard, then type over it.
      await clickText(page, 'value2', 'start')
      for (let index = 0; index < 3; index += 1) await page.keyboard.press('Shift+ArrowRight')
      await nextFrame(page)
      const before = await caretContext(page)
      expect(before?.selected).toBe('val')
      await page.keyboard.type('q')
      await settled(page)
      await expectNoNotice(page)
      await expect.poll(async() => {
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        return readFileSync(filePath, 'utf8')
      }).toBe(shape.tracked)
      const tracked = shape.tracked
      console.log(`[closest] ${shape.name}: tracked ${JSON.stringify(tracked)}`)
      // A stray closer while pending reads as its text, as any stray marker
      // does, beside one review entry, and nothing interrupts the typing.
      const strayCloser = shape.tracked.endsWith('~~}~~}')
      await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll('.editor-component .mu-paragraph-content'))
        .some(element => element.textContent?.includes('~~}')))).toBe(strayCloser)
      await expect(reviewEntries(page)).toHaveCount(strayCloser ? 1 : 2)
      await expectNoNotice(page)
      console.log(`[closest] caret after the key ${JSON.stringify(await caretContext(page))}`)
      expect((await caretContext(page))?.before.endsWith('q')).toBe(true)

      // Undo returns the exact source and the selection the key replaced.
      await undo(app)
      await expectSaved(app, filePath, source)
      await expect.poll(async() => (await caretContext(page))?.selected).toBe('val')
      await redo(app)
      await expectSaved(app, filePath, tracked)

      // Accept All and Reject All give the operation, each one ⌘Z step.
      await reviewEntries(page).first().locator(':scope > button').click()
      await page.getByTestId('critic-review-accept-all').click()
      await expectSaved(app, filePath, untracked)
      await undo(app)
      await expectSaved(app, filePath, tracked)
      await page.getByTestId('critic-review-reject-all').click()
      await expectSaved(app, filePath, source)
      await undo(app)
      await expectSaved(app, filePath, tracked)

      // Resolving one suggestion alone: what the syntax allows, recorded.
      const count = await reviewEntries(page).count()
      console.log(`[closest] review entries ${count}`)
      for (let index = 0; index < count; index += 1) {
        for (const decision of ['accept', 'reject'] as const) {
          await reviewEntries(page).nth(index).locator(':scope > button').click()
          await page.getByTestId(`critic-review-${decision}`).click()
          await settled(page)
          await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
          await expect.poll(() => readFileSync(filePath, 'utf8')).not.toBe(tracked)
          console.log(`[closest] ${decision} entry ${index} alone: ${JSON.stringify(readFileSync(filePath, 'utf8'))}`)
          await undo(app)
          await expectSaved(app, filePath, tracked)
        }
      }
      await expectHealthy(app, page)

      // Save and reopen: the file round-trips byte for byte.
      await app.close()
      reopened = await launchElectron([filePath], { suppressErrorDialog: true, env })
      await waitForEditor(reopened.page)
      await waitForMenuReady(reopened.app)
      await expectSaved(reopened.app, filePath, tracked)
      await expectHealthy(reopened.app, reopened.page)
    } finally {
      await app.close().catch(() => {})
      await reopened?.app.close().catch(() => {})
    }
  })
}

test('records typing into replaced text that no split there holds', async() => {
  const source = 'Intro.\n\n{~~    indented 5\n~>  new\n~~}\n'
  const { app, page, filePath } = await launchWithReviewMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await page.getByTestId('critic-review-track-changes').click()
    await clickText(page, 'indented', 'start')
    const before = await caretContext(page)
    console.log(`[closest] caret before ${JSON.stringify(before)}`)
    await page.keyboard.type('x')
    await settled(page)
    await expectNoNotice(page)
    const tracked = 'Intro.\n\n{++x++}{~~    indented 5\n~>  new\n~~}\n'
    await expectSaved(app, filePath, tracked)
    console.log(`[closest] caret after the key ${JSON.stringify(await caretContext(page))}`)
    expect((await caretContext(page))?.before.endsWith('x')).toBe(true)

    await undo(app)
    await expectSaved(app, filePath, source)
    await expect.poll(async() => (await caretContext(page))?.after.startsWith('indent')).toBe(true)
    await redo(app)
    await expectSaved(app, filePath, tracked)

    // Accept All keeps the typing before the proposed text; Reject All drops it.
    await reviewEntries(page).first().locator(':scope > button').click()
    await page.getByTestId('critic-review-accept-all').click()
    await expectSaved(app, filePath, 'Intro.\n\nx  new\n\n')
    await undo(app)
    await expectSaved(app, filePath, tracked)
    await page.getByTestId('critic-review-reject-all').click()
    await expectSaved(app, filePath, 'Intro.\n\n    indented 5\n\n')
    await undo(app)
    await expectSaved(app, filePath, tracked)
    await expectHealthy(app, page)
  } finally {
    await app.close()
  }
})

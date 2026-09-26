import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  clickMenuById,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown,
  sendIpcToRenderer
} from './helpers'

// Upstream MarkText's History groups every change by time alone. Enter in a
// paragraph marks a word boundary, so it starts a new undo step that the key
// typed right after it joins; a Format or Paragraph menu command marks none, so
// it undoes together with the keys typed just before and after it. Both hold
// with Track Changes off or on.

const options = {
  suppressErrorDialog: true,
  env: {
    MARKTEXT_E2E_HIDDEN_WINDOW: '1',
    MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
  }
}

const darwin = process.platform === 'darwin'
const endKey = darwin ? 'Meta+ArrowRight' : 'End'
const selectToLineStart = darwin ? 'Meta+Shift+ArrowLeft' : 'Shift+Home'

const save = async(app: ElectronApplication, filePath: string, previous: string) => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  let saved = previous
  await expect
    .poll(() => {
      saved = readFileSync(filePath, 'utf8')
      return saved
    })
    .not.toBe(previous)
  return saved
}

const expectSaved = async(app: ElectronApplication, filePath: string, expected: string) => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
}

const history = (app: ElectronApplication, action: 'undo' | 'redo') =>
  sendIpcToRenderer(app, 'mt::editor-edit-action', action)

const launch = async(source: string, tracked: boolean) => {
  const launched = await launchWithReviewMarkdown(source, options)
  try {
    if (tracked) await launched.page.getByTestId('critic-review-track-changes').click()
    return launched
  } catch (error) {
    await launched.app.close()
    throw error
  }
}

const finish = async(app: ElectronApplication) => {
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
}

const endOfFirstParagraph = async(page: Page) => {
  await page.locator('.editor-component .mu-paragraph-content').first().click()
  await page.keyboard.press(endKey)
}

for (const tracked of [false, true]) {
  test(`Enter starts an undo step the next key joins (Track=${tracked})`, async() => {
    const source = 'seed\n'
    const { app, page, filePath } = await launch(source, tracked)
    try {
      await endOfFirstParagraph(page)
      await page.keyboard.type('a')
      const typed = await save(app, filePath, source)
      expect(typed).toBe(tracked ? 'seed{++a++}\n' : 'seeda\n')
      await page.keyboard.press('Enter')
      await page.keyboard.type('b')
      const entered = await save(app, filePath, typed)
      expect(entered).toMatch(tracked ? /^seed\{\+\+a\n\nb\+\+\}\n$/ : /^seeda\n\nb\n$/)

      await history(app, 'undo')
      await expectSaved(app, filePath, typed)
      await history(app, 'undo')
      await expectSaved(app, filePath, source)
      await history(app, 'redo')
      await history(app, 'redo')
      await expectSaved(app, filePath, entered)
    } finally {
      await finish(app)
    }
  })

  for (const { menu, typed } of [
    {
      menu: 'strongMenuItem',
      typed: tracked
        ? /^\{~~para\{\+\+a\+\+\}~>\*\*para\{\+\+a\*\*b~~\}\n\nafter\n$/
        : /^\*\*paraa\*\*b\n\nafter\n$/
    },
    {
      menu: 'heading1MenuItem',
      typed: tracked ? /^\{\+\+# \+\+\}para\{\+\+ab\+\+\}\n\nafter\n$/ : /^# paraab\n\nafter\n$/
    }
  ]) {
    test(`${menu} undoes with the keys typed around it (Track=${tracked})`, async() => {
      const source = 'para\n\nafter\n'
      const { app, page, filePath } = await launch(source, tracked)
      try {
        await endOfFirstParagraph(page)
        await page.keyboard.type('a')
        if (menu === 'strongMenuItem') await page.keyboard.press(selectToLineStart)
        await clickMenuById(app, menu)
        await page.keyboard.press(endKey)
        await page.keyboard.type('b')
        const saved = await save(app, filePath, source)
        expect(saved).toMatch(typed)

        await history(app, 'undo')
        await expectSaved(app, filePath, source)
        await history(app, 'redo')
        await expectSaved(app, filePath, saved)
      } finally {
        await finish(app)
      }
    })
  }
}

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown,
  sendIpcToRenderer
} from './helpers'

// Upstream MarkText's History groups every change by time alone: a change
// within one second of the one that opened the current undo step joins it. A
// block conversion from the `/` quick-insert menu or the paragraph front menu
// therefore undoes together with the query before it and the key typed right
// after it, with Track Changes off or on.

const options = {
  suppressErrorDialog: true,
  env: {
    MARKTEXT_E2E_HIDDEN_WINDOW: '1',
    MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
  }
}

const endKey = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'

const expectSaved = async(app: ElectronApplication, filePath: string, expected: string) => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
}

const expectOneStep = async(
  app: ElectronApplication,
  filePath: string,
  source: string,
  typed: string
) => {
  await expectSaved(app, filePath, typed)
  await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
  await expectSaved(app, filePath, source)
  await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
  await expectSaved(app, filePath, typed)
}

const run = async(
  source: string,
  tracked: boolean,
  gesture: (page: Page) => Promise<void>
): Promise<{ app: ElectronApplication; filePath: string }> => {
  const { app, page, filePath } = await launchWithReviewMarkdown(source, options)
  try {
    if (tracked) await page.getByTestId('critic-review-track-changes').click()
    // History groups by elapsed time; a frozen clock keeps a slow picker or
    // menu click inside the one-second window the gesture represents.
    await page.evaluate(() => {
      const now = Date.now()
      const frozen = window as unknown as { __realDateNow?: () => number }
      frozen.__realDateNow = Date.now
      Date.now = () => now
    })
    try {
      await gesture(page)
    } finally {
      await page.evaluate(() => {
        const frozen = window as unknown as { __realDateNow?: () => number }
        if (frozen.__realDateNow) Date.now = frozen.__realDateNow
      })
    }
    return { app, filePath }
  } catch (error) {
    await app.close()
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

for (const tracked of [false, true]) {
  test(`quick-insert heading undoes with its query and next key (Track=${tracked})`, async() => {
    const source = 'intro\n\n/hea\n'
    const typed = tracked ? 'intro\n\n{~~/hea{++d++}~># X~~}\n' : 'intro\n\n# X\n'
    const { app, filePath } = await run(source, tracked, async(page) => {
      await page.locator('.editor-component .mu-paragraph-content').nth(1).click()
      await page.keyboard.press(endKey)
      await page.keyboard.type('d')
      await page.locator('.mu-quick-insert [data-label="atx-heading 1"]').click()
      await expect(page.locator('.editor-component h1')).toBeVisible()
      await page.keyboard.type('X')
    })
    try {
      await expectOneStep(app, filePath, source, typed)
    } finally {
      await finish(app)
    }
  })

  test(`quick-insert table undoes with its query and next key (Track=${tracked})`, async() => {
    const source = 'intro\n\n/tabl\n'
    const table = '| X    |     |\n| --- | --- |\n|     |     |'
    const typed = tracked
      ? 'intro\n\n{~~/tabl{++e++}~>| X    |     |\n| --- | --- |\n|     |     |~~}\n'
      : `intro\n\n${table}\n`
    const { app, filePath } = await run(source, tracked, async(page) => {
      await page.locator('.editor-component .mu-paragraph-content').nth(1).click()
      await page.keyboard.press(endKey)
      await page.keyboard.type('e')
      await page.locator('.mu-quick-insert [data-label="table"]').click()
      const cell = page.locator(
        '.mu-table-picker span.mu-table-picker-cell[data-row="1"][data-column="1"]'
      )
      await cell.hover()
      await cell.click()
      await expect(page.locator('.editor-component table tr')).toHaveCount(2)
      await page.keyboard.type('X')
    })
    try {
      await expectOneStep(app, filePath, source, typed)
    } finally {
      await finish(app)
    }
  })

  for (const { item, typed } of [
    {
      item: '.turn-into-item.atx-heading >> nth=1',
      typed: tracked ? '{++## ++}para{++X++}\n\nafter\n' : '## paraX\n\nafter\n'
    },
    {
      item: '.turn-into-item.block-quote',
      typed: tracked ? '{++> ++}para{++X++}\n\nafter\n' : '> paraX\n\nafter\n'
    }
  ]) {
    test(`front-menu ${item} undoes with the next key (Track=${tracked})`, async() => {
      const source = 'para\n\nafter\n'
      const { app, filePath } = await run(source, tracked, async(page) => {
        const paragraph = page.locator('.editor-component .mu-paragraph-content').first()
        await paragraph.click()
        const box = await paragraph.boundingBox()
        if (!box) throw new Error('Missing paragraph geometry')
        await page.mouse.move(box.x + 10, box.y + box.height / 2)
        await page.mouse.move(box.x + 12, box.y + box.height / 2)
        await page.locator('.mu-front-button').click()
        await page.locator(`.mu-front-menu ${item}`).click()
        await page.keyboard.type('X')
      })
      try {
        await expectOneStep(app, filePath, source, typed)
      } finally {
        await finish(app)
      }
    })
  }
}

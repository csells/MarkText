import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { expectEditorNotFrontmost, expectEditorWindowHidden, expectNoRendererErrors, launchWithReviewMarkdown, sendIpcToRenderer } from './helpers'
import { clickText, hiddenCoreEnv as env } from './reviewGestures'

// Upstream MarkText writes an ordered list afresh after an edit changes its
// items, renumbering it. Every edit path renumbers the lists it changes in the
// same operation, so one undo restores them. A tracked edit proposes the
// renumbering with the edit: Accept All gives the untracked result and Reject
// All the original. Other lists keep their bytes.

const source = '1. alpha\n2. beta\n3. gamma\n\npara\n\n5. kept\n7. as is\n'
const command = (key: string) => `${process.platform === 'darwin' ? 'Meta' : 'Control'}+${key}`

const saved = async(app: ElectronApplication, filePath: string): Promise<string> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await new Promise(resolve => setTimeout(resolve, 400))
  return readFileSync(filePath, 'utf8')
}
const expectSaved = async(app: ElectronApplication, filePath: string, expected: string): Promise<void> => {
  await expect.poll(async() => {
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    return readFileSync(filePath, 'utf8')
  }).toBe(expected)
}

interface Scenario {
  readonly name: string
  readonly gesture: (app: ElectronApplication, page: Page) => Promise<void>
  /** Upstream's bytes, where the comparison against an upstream build pinned them. */
  readonly upstream?: string
}

const scenarios: readonly Scenario[] = [
  {
    name: 'Enter in the middle of the list',
    gesture: async(_app, page) => {
      await clickText(page, 'alpha', 'end')
      await page.keyboard.press('Enter')
      await page.keyboard.type('n')
    },
    upstream: '1. alpha\n2. n\n3. beta\n4. gamma\n\npara\n\n5. kept\n7. as is\n'
  },
  {
    name: 'typing over a selection across items',
    gesture: async(_app, page) => {
      await clickText(page, 'alpha', 'end')
      await page.keyboard.press('Shift+ArrowDown')
      await page.keyboard.type('X')
    },
    upstream: '1. alphaX\n2. gamma\n\npara\n\n5. kept\n7. as is\n'
  },
  {
    name: 'Backspace at the start of an item',
    gesture: async(_app, page) => {
      await clickText(page, 'beta', 'start')
      await page.keyboard.press('Backspace')
    }
  },
  {
    name: 'Delete at the end of an item',
    gesture: async(_app, page) => {
      await clickText(page, 'alpha', 'end')
      await page.keyboard.press('Delete')
    }
  },
  {
    name: 'cutting across items',
    gesture: async(_app, page) => {
      await clickText(page, 'alpha', 'end')
      await page.keyboard.press('Shift+ArrowDown')
      await page.keyboard.press(command('X'))
    }
  },
  {
    name: 'pasting a list item',
    gesture: async(app, page) => {
      await app.evaluate(({ clipboard }) => clipboard.writeText('p\n2. q'))
      await clickText(page, 'alpha', 'end')
      await page.keyboard.press(command('V'))
    }
  },
  {
    name: 'Tab nesting an item',
    gesture: async(_app, page) => {
      await clickText(page, 'beta', 'start')
      await page.keyboard.press('Tab')
    }
  }
]

for (const scenario of scenarios) {
  test(`${scenario.name} renumbers its list alike untracked and tracked`, async() => {
    let untracked: string
    {
      const { app, page, filePath } = await launchWithReviewMarkdown(source, { suppressErrorDialog: true, env })
      try {
        await scenario.gesture(app, page)
        untracked = await saved(app, filePath)
        expect(untracked).not.toBe(source)
        // Lists the edit did not touch keep their bytes.
        expect(untracked.endsWith('\n\npara\n\n5. kept\n7. as is\n')).toBe(true)
        if (scenario.upstream !== undefined) expect(untracked).toBe(scenario.upstream)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await expectSaved(app, filePath, source)
        await expectNoRendererErrors(app)
      } finally {
        await app.close()
      }
    }
    {
      const { app, page, filePath } = await launchWithReviewMarkdown(source, { suppressErrorDialog: true, env })
      try {
        await page.getByTestId('critic-review-track-changes').click()
        await scenario.gesture(app, page)
        const tracked = await saved(app, filePath)
        expect(tracked).not.toBe(source)
        await page.getByTestId('critic-review-entry').first().locator(':scope > button').click()
        await page.getByTestId('critic-review-accept-all').click()
        await expectSaved(app, filePath, untracked)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await expectSaved(app, filePath, tracked)
        await page.getByTestId('critic-review-entry').first().locator(':scope > button').click()
        await page.getByTestId('critic-review-reject-all').click()
        await expectSaved(app, filePath, source)
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
        await expectNoRendererErrors(app)
      } finally {
        await app.close()
      }
    }
  })
}

test('an unedited save keeps every list\'s ordinals', async() => {
  const { app, filePath } = await launchWithReviewMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await expectSaved(app, filePath, source)
  } finally {
    await app.close()
  }
})

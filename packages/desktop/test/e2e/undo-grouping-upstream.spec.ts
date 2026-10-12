import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithReviewMarkdown, sendIpcToRenderer } from './helpers'
import { hiddenCoreEnv as env } from './reviewGestures'

// Which gestures start a new undo step, as an upstream c054632f build groups
// them, driven with the same real keys side by side: one step lasts one second
// from its first edit, and a switch between inserting and deleting or a typed
// space or Enter starts the next. A click, an arrow key, a selection, a save
// or a move to another block does not. Tracked typing groups the same way.
// The caret after the last undo is where the first command began (owner
// decision), not upstream's.

const source = 'first para here\n\nsecond para here\n'
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const clickEnd = async(page: Page, text: string) => {
  const line = page.locator('.editor-component .mu-paragraph-content', { hasText: text }).first()
  const box = await line.boundingBox()
  await line.click({ position: { x: (box?.width ?? 2) - 2, y: (box?.height ?? 2) / 2 } })
}
const clickStart = async(page: Page, text: string) => {
  const line = page.locator('.editor-component .mu-paragraph-content', { hasText: text }).first()
  const box = await line.boundingBox()
  await line.click({ position: { x: 20, y: (box?.height ?? 2) / 2 } })
}
const saved = async(app: ElectronApplication, filePath: string): Promise<string> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await wait(250)
  return readFileSync(filePath, 'utf8')
}

const scenarios: ReadonlyArray<{
  readonly name: string
  readonly gesture: (app: ElectronApplication, page: Page) => Promise<void>
  /** The first line of the source after each undo, upstream's. */
  readonly steps: readonly string[]
}> = [
  {
    name: 'typing within a second',
    gesture: async(_app, page) => { await clickEnd(page, 'first'); await page.keyboard.type('ab'); await wait(200); await page.keyboard.type('cd') },
    steps: ['first para here']
  },
  {
    name: 'typing after a pause of more than a second',
    gesture: async(_app, page) => { await clickEnd(page, 'first'); await page.keyboard.type('ab'); await wait(1500); await page.keyboard.type('cd') },
    steps: ['first para hereab', 'first para here']
  },
  {
    name: 'a click in the same block',
    gesture: async(_app, page) => { await clickEnd(page, 'first'); await page.keyboard.type('ab'); await clickStart(page, 'first'); await page.keyboard.type('cd') },
    steps: ['first para here']
  },
  {
    name: 'an arrow key',
    gesture: async(_app, page) => { await clickEnd(page, 'first'); await page.keyboard.type('ab'); await page.keyboard.press('ArrowLeft'); await page.keyboard.type('cd') },
    steps: ['first para here']
  },
  {
    name: 'deleting after typing',
    gesture: async(_app, page) => { await clickEnd(page, 'first'); await page.keyboard.type('ab'); await page.keyboard.press('Backspace') },
    steps: ['first para hereab', 'first para here']
  },
  {
    name: 'typing after deleting',
    gesture: async(_app, page) => { await clickEnd(page, 'first'); await page.keyboard.press('Backspace'); await page.keyboard.type('x') },
    steps: ['first para her', 'first para here']
  },
  {
    name: 'a typed space',
    gesture: async(_app, page) => { await clickEnd(page, 'first'); await page.keyboard.type('ab cd', { delay: 50 }) },
    steps: ['first para hereab', 'first para here']
  },
  {
    name: 'Enter',
    gesture: async(_app, page) => { await clickEnd(page, 'first'); await page.keyboard.type('ab'); await page.keyboard.press('Enter'); await page.keyboard.type('cd') },
    steps: ['first para hereab', 'first para here']
  },
  {
    name: 'a paste',
    gesture: async(app, page) => {
      await app.evaluate(({ clipboard }) => clipboard.writeText('PP'))
      await clickEnd(page, 'first')
      await page.keyboard.type('ab')
      await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+V`)
      await page.keyboard.type('cd')
    },
    steps: ['first para here']
  },
  {
    name: 'a move to another block',
    gesture: async(_app, page) => { await clickEnd(page, 'first'); await page.keyboard.type('ab'); await clickEnd(page, 'second'); await page.keyboard.type('cd') },
    steps: ['first para here']
  },
  {
    name: 'a save',
    gesture: async(app, page) => { await clickEnd(page, 'first'); await page.keyboard.type('ab'); await sendIpcToRenderer(app, 'mt::editor-ask-file-save'); await page.keyboard.type('cd') },
    steps: ['first para here']
  },
  {
    name: 'a selection typed over',
    gesture: async(_app, page) => { await clickEnd(page, 'first'); await page.keyboard.type('ab'); await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.type('Z') },
    steps: ['first para here']
  }
]

for (const scenario of scenarios) {
  for (const tracked of [false, true]) {
    test(`${scenario.name} undoes in upstream's steps${tracked ? ' (tracked)' : ''}`, async() => {
      const { app, page, filePath } = await launchWithReviewMarkdown(source, { suppressErrorDialog: true, env })
      try {
        if (tracked) await page.getByTestId('critic-review-track-changes').click()
        await wait(300)
        await scenario.gesture(app, page)
        await wait(300)
        expect(await saved(app, filePath)).not.toBe(source)
        const firstLines: string[] = []
        for (let index = 0; index < scenario.steps.length + 2; index += 1) {
          await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
          await wait(250)
          const text = await saved(app, filePath)
          // A tracked step's Revised view is what upstream shows for it.
          const line = (tracked ? text.replace(/\{\+\+(.*?)\+\+\}/gsu, '$1').replace(/\{--.*?--\}/gsu, '') : text).split('\n')[0] ?? ''
          firstLines.push(line)
          if (text === source) break
        }
        expect(firstLines).toEqual(scenario.steps)
        await expectNoRendererErrors(app)
      } finally {
        await app.close()
      }
    })
  }
}

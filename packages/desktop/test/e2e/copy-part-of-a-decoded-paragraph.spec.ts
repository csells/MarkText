import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'
import { clickText, drag, hiddenCoreEnv as env, nextFrame, textPoint } from './reviewGestures'

// Copying or cutting part of a paragraph whose text reads differently from its
// source (a trailing space still being typed, a backslash escape, an entity)
// once took the document down into draft recovery and dropped the keystrokes
// in flight. The clipboard reads the selection's own text, and the document
// keeps every edit.

const command = (key: string) => `${process.platform === 'darwin' ? 'Meta' : 'Control'}+${key}`

const expectSaved = async(app: ElectronApplication, filePath: string, expected: string): Promise<void> => {
  await expect.poll(async() => {
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    return readFileSync(filePath, 'utf8')
  }).toBe(expected)
}

const clipboardText = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ clipboard }) => clipboard.readText())

const selectWord = async(page: Page, word: string): Promise<void> => {
  await drag(page, await textPoint(page, word, 'start'), await textPoint(page, word, 'end'))
  await nextFrame(page)
}

const expectNoRecovery = async(page: Page): Promise<void> => {
  await expect(page.getByRole('textbox', { name: 'Recovered draft text' })).toHaveCount(0)
}

test('copying part of a paragraph that ends in a just-typed space keeps the document', async() => {
  const source = 'a pain to track down and fix, not\n\nNext paragraph.\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await app.evaluate(({ clipboard }) => clipboard.clear())
    await clickText(page, 'not', 'end')
    await page.keyboard.type(' just ')
    await selectWord(page, 'track')
    await page.keyboard.press(command('C'))
    await expect.poll(() => clipboardText(app)).toBe('track')
    await clickText(page, 'just', 'end')
    await page.keyboard.type(' that')
    await expectNoRecovery(page)
    await expectSaved(app, filePath, 'a pain to track down and fix, not just that \n\nNext paragraph.\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('cutting part of a paragraph that ends in a just-typed space keeps the document', async() => {
  const source = 'a pain to track down and fix, not\n\nNext paragraph.\n'
  const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await clickText(page, 'not', 'end')
    await page.keyboard.type(' just ')
    await selectWord(page, 'track')
    await page.keyboard.press(command('X'))
    await expect.poll(() => clipboardText(app)).toBe('track')
    await expectNoRecovery(page)
    await expectSaved(app, filePath, 'a pain to  down and fix, not just \n\nNext paragraph.\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

for (const [name, source, word, edited] of [
  ['only plain text', 'Cost and more\n', 'more', 'Cost and more!\n'],
  ['a backslash escape', 'Cost \\* and more\n', 'more', 'Cost \\* and more!\n'],
  ['an entity', 'Tom &amp; Jerry run\n', 'run', 'Tom &amp; Jerry run!\n']
] as const) {
  test(`copying part of a paragraph with ${name} keeps the document`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
    try {
      await app.evaluate(({ clipboard }) => clipboard.clear())
      await selectWord(page, word)
      await page.keyboard.press(command('C'))
      await expect.poll(() => clipboardText(app)).toBe(word)
      await clickText(page, word, 'end')
      await page.keyboard.type('!')
      await expectNoRecovery(page)
      await expectSaved(app, filePath, edited)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

for (const [name, source, word, edited] of [
  ['a backslash escape', 'Cost \\* and more\n', 'and', 'Cost \\*  more\n'],
  ['an entity', 'Tom &amp; Jerry run\n', 'Jerry', 'Tom &amp;  run\n']
] as const) {
  test(`cutting part of a paragraph with ${name} keeps the document`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
    try {
      await app.evaluate(({ clipboard }) => clipboard.clear())
      await selectWord(page, word)
      await page.keyboard.press(command('X'))
      await expect.poll(() => clipboardText(app)).toBe(word)
      await expectNoRecovery(page)
      await expectSaved(app, filePath, edited)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

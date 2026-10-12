import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'
import { preserveSystemClipboard } from './helpers/systemClipboardFixture'
import { drag, hiddenCoreEnv as env, nativeKey, nextFrame, textPoint } from './reviewGestures'

// A selection that starts inside a block showing inline syntax (code, a link)
// and ends in another block blurs the first block, which redraws without its
// markers. The selection must keep its start where the user put it through
// that redraw: it once moved to the block's start, so a cut took text the user
// never selected, or vanished, so the next keystroke or paste went to the top
// of the document.

const command = (key: string) => `${process.platform === 'darwin' ? 'Meta' : 'Control'}+${key}`

const settle = (page: Page) => page.evaluate(() => window.__marktextDocumentCore?.settled())

const expectSaved = async(app: ElectronApplication, filePath: string, expected: string): Promise<void> => {
  await expect.poll(async() => {
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    return readFileSync(filePath, 'utf8')
  }).toBe(expected)
}

const selected = (page: Page) => page.evaluate(() => window.getSelection()?.toString())

const documents = [
  {
    name: 'paragraphs',
    source: 'Third para with `code` words\n\nOrdered one para\n',
    kept: 'Third para wi one para\n',
    clicked: true
  },
  {
    name: 'a heading',
    source: '## Third heading with words\n\nOrdered one para\n',
    kept: '## Third heading wi one para\n',
    clicked: false
  },
  {
    name: 'list items',
    source: '- Second item\n- Third item with `code`\n\n1. Ordered one\n2. Ordered two\n',
    kept: '- Third item wi one',
    clicked: true
  }
]

for (const { name, source, kept, clicked } of documents) {
  test(`a drag from inside ${name} with inline code into the next block keeps its start`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
    try {
      await drag(page, await textPoint(page, 'with', 2), await textPoint(page, 'Ordered', 'end'))
      await nextFrame(page)
      expect(await selected(page)).toMatch(/^th /)
      await page.keyboard.press(command('X'))
      await settle(page)
      await expect.poll(async() => {
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        return readFileSync(filePath, 'utf8')
      }).toContain(kept)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })

  test(`Shift+Down from inside ${name} with inline code keeps the selection's start`, async() => {
    const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
    try {
      const point = await textPoint(page, 'with', 2)
      await page.mouse.click(point.x, point.y)
      await nextFrame(page)
      await page.keyboard.press('Shift+ArrowDown')
      await nextFrame(page)
      expect(await selected(page)).toMatch(/^th /)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })

  for (const finish of clicked ? ['type', 'paste'] as const : []) {
    test(`clicking where an undone cut across ${name} began, then ${finish === 'type' ? 'typing' : 'pasting'}, edits there`, async() => {
      const { app, page, filePath } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
      const pageErrors: string[] = []
      page.on('pageerror', error => pageErrors.push(error.message))
      const clipboard = preserveSystemClipboard()
      try {
        const start = await textPoint(page, 'Third', 'start')
        await drag(page, start, await textPoint(page, 'Ordered', 'end'))
        await nextFrame(page)
        await page.keyboard.press(command('X'))
        await settle(page)
        await nativeKey(app, 'Z', ['meta'])
        await settle(page)
        await expectSaved(app, filePath, source)
        await page.mouse.click(start.x, start.y)
        await nextFrame(page)
        if (finish === 'type') {
          await page.keyboard.type('Z')
        } else {
          await app.evaluate(({ clipboard }) => clipboard.writeText('Z'))
          clipboard.rememberOwnedWrite('Z')
          await page.keyboard.press(command('V'))
        }
        await settle(page)
        await expectSaved(app, filePath, source.replace('Third', 'ZThird'))
        expect(pageErrors).toEqual([])
        await expectNoRendererErrors(app)
      } finally {
        await app.close()
        clipboard.restore()
      }
    })
  }
}

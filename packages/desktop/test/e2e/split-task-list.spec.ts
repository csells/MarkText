import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

// Upstream #5597 renders a list that mixes tasks and plain items as one list
// per run, each numbered from its first item's place. Real keys and clicks
// edit each run, cross the split with a selection, and save one Core list.

const lists = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('.editor-component .mu-container > ol, .editor-component .mu-container > ul')]
    .map(list => ({
      task: list.classList.contains('mu-task-list'),
      start: list.getAttribute('start'),
      items: list.querySelectorAll(':scope > li').length
    })))

const paragraph = (page: Page, text: string) =>
  page.locator('.editor-component span.mu-paragraph-content', { hasText: new RegExp(`^${text}$`, 'u') }).first()

const endOf = async(page: Page, text: string) => {
  await paragraph(page, text).click()
  await page.keyboard.press('Meta+ArrowRight')
}

test('a mixed list renders a list per run and edits as one list', async() => {
  const { app, page, filePath } = await launchWithMarkdown('1. [x] a\n2. b\n3. [ ] c\n')
  try {
    await expect.poll(() => lists(page)).toEqual([
      { task: true, start: '1', items: 1 },
      { task: false, start: '2', items: 1 },
      { task: true, start: '3', items: 1 }
    ])
    await endOf(page, 'a')
    await page.keyboard.type('q', { delay: 0 })
    await page.keyboard.press('Enter')
    await page.keyboard.type('n', { delay: 0 })
    await endOf(page, 'b')
    await page.keyboard.type('x', { delay: 0 })
    await page.keyboard.press('Enter')
    await page.keyboard.type('y', { delay: 0 })
    await endOf(page, 'c')
    await page.keyboard.type('w', { delay: 0 })
    await expect.poll(() => lists(page)).toEqual([
      { task: true, start: '1', items: 2 },
      { task: false, start: '3', items: 2 },
      { task: true, start: '5', items: 1 }
    ])
    await page.locator('.editor-component .mu-task-list-checkbox').nth(2).click()
    await expect(page.locator('.editor-component .mu-checkbox-checked')).toHaveCount(2)
    // A selection from the end of the task run's last item into the plain run.
    await endOf(page, 'n')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.type('Z', { delay: 0 })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('1. [x] aq\n2. [ ] nZx\n3. y\n3. [x] cw\n')
    await expect.poll(() => lists(page)).toEqual([
      { task: true, start: '1', items: 2 },
      { task: false, start: '3', items: 1 },
      { task: true, start: '4', items: 1 }
    ])
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

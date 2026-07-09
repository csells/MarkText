// Successor to the hidden-metadata caret-invariant suite: under the anchor
// runtime (specs/architecture/comment-anchors.md) the metadata appendix never
// enters the document at all, so there is no hidden block for a caret to
// enter or corrupt. What remains pinned: metadata is invisible everywhere in
// the rendered document, navigation to the document bottom stays in visible
// content, and typing at the bottom cannot touch the serialized appendix.
import { expect, test, type Page } from '@playwright/test'
import { focusEditor, getMarkdownContent, launchWithMarkdown, readSettled } from './helpers'

const HEAD = '[MC:a]: {"version":2,"status":"open"}'

const readState = (page: Page) => page.evaluate(() => {
  const paras = [...document.querySelectorAll('.mu-paragraph')].map(p => p.textContent ?? '')
  return {
    documentText: paras.join('\n'),
  }
})

test('metadata never renders, and bottom navigation stays in visible content', async() => {
  const md = `hello world\n\n<!--MC:a-->commented<!--MC:~a--> tail\n\n${HEAD}\n`
  const { app, page } = await launchWithMarkdown(md)
  try {
    await focusEditor(page)
    const before = await readState(page)
    // The appendix is not part of the document: no paragraph carries it.
    expect(before.documentText).not.toContain('[MC:')
    expect(before.documentText).not.toContain('<!--MC:')

    // Hammer ArrowDown well past the last visible paragraph — there is no
    // hidden block below for the caret to enter — then type at the bottom.
    await page.locator('.mu-paragraph', { hasText: 'tail' }).first().click()
    await page.keyboard.press('End')
    for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowDown') }
    await page.locator('.mu-paragraph', { hasText: 'tail' }).first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('Z')
    const after = await readSettled(() => readState(page), { requiredStreak: 3, interval: 40 })
    expect(after.documentText).toContain('Z')
    expect(after.documentText).not.toContain('[MC:')
    const markdown = await getMarkdownContent(page)
    expect(markdown).toContain(HEAD)
    expect(markdown).toContain('<!--MC:a-->commented<!--MC:~a-->')
  } finally {
    await app.close()
  }
})

test('select-all and collapse stay within visible content', async() => {
  const md = `hello\n\n<!--MC:a-->x<!--MC:~a--> y\n\n${HEAD}\n`
  const { app, page } = await launchWithMarkdown(md)
  try {
    await focusEditor(page)
    await page.locator('.mu-paragraph', { hasText: 'hello' }).first().click()
    // Two presses span the whole document whichever select-all handler wins
    // (progressive block-first or whole-document).
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('ControlOrMeta+a')
    await expect
      .poll(async() => page.evaluate(() => document.getSelection()?.toString() ?? ''), {
        timeout: 5000
      })
      .toContain('y')
    const selectionText = await page.evaluate(() => document.getSelection()?.toString() ?? '')
    expect(selectionText).toContain('hello')
    expect(selectionText).not.toContain('[MC:')

    // Collapse to the document end and type — the appendix stays intact.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.type('Z')
    await expect.poll(() => getMarkdownContent(page), { timeout: 5000 }).toContain('Z')
    expect(await getMarkdownContent(page)).toContain(HEAD)
  } finally {
    await app.close()
  }
})

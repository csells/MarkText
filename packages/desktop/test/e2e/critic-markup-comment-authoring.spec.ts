import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  clearRendererErrors,
  clickMenuById,
  expectNoRendererErrors,
  focusEditor,
  launchWithMarkdown,
  readCanonicalMarkdown
} from './helpers'

const menuEnabled = (app: ElectronApplication, id: string): Promise<boolean | null> =>
  app.evaluate(({ Menu }, menuId) =>
    Menu.getApplicationMenu()?.getMenuItemById(menuId)?.enabled ?? null, id)

// Select `needle` in the editor via a DOM range (reliable, unlike scripted
// mouse mechanics). Like a same-block mouse drag, this never calls muya's
// setSelection, so it exercises the real authoring path where the model is not
// pre-committed — exactly the case that dropped the user's selection.
const selectText = async(page: Page, needle: string): Promise<void> => {
  const ok = await page.evaluate((text) => {
    const root = document.querySelector('.editor-component')
    if (!root) return false
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const index = node.textContent?.indexOf(text) ?? -1
      if (index >= 0) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + text.length)
        const selection = window.getSelection()
        if (!selection) return false
        selection.removeAllRanges()
        selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        return true
      }
    }
    return false
  }, needle)

  if (!ok) throw new TypeError(`Could not select ${JSON.stringify(needle)} in the editor.`)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(needle)
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

// Select `needle` by driving muya's own mouse handlers over a real DOM Range —
// the deterministic stand-in for a same-block mouse drag (a hardware/CDP drag is
// flaky in this harness). This exercises the mouseup commit into muya's model
// (the root fix), unlike selectText which leans on the belt-and-suspenders
// commitAuthoringSelection.
const mouseSelect = async(page: Page, needle: string): Promise<void> => {
  const ok = await page.evaluate((text) => {
    const contents = Array.from(
      document.querySelectorAll('.editor-component .mu-content')
    ) as HTMLElement[]
    const content = contents.find((el) => (el.textContent ?? '').includes(text))
    if (!content) return false
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const index = node.textContent?.indexOf(text) ?? -1
      if (index >= 0) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + text.length)
        const selection = window.getSelection()
        if (!selection) return false
        selection.removeAllRanges()
        selection.addRange(range)
        content.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        content.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
        content.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        return true
      }
    }
    return false
  }, needle)

  if (!ok) throw new TypeError(`Could not mouse-select ${JSON.stringify(needle)} in the editor.`)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(needle)
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

const addCommentViaSidebar = async(
  page: Page,
  app: ElectronApplication,
  text: string,
  submit: 'button' | 'enter' | 'mod-enter' = 'button'
): Promise<void> => {
  await expect.poll(() => menuEnabled(app, 'reviewAddCommentMenuItem')).toBe(true)
  await clickMenuById(app, 'reviewAddCommentMenuItem')
  const box = page.locator('.comment-compose-input')
  await expect(box).toBeVisible()
  await box.fill(text)
  if (submit === 'mod-enter') await box.press('Meta+Enter')
  else if (submit === 'enter') await box.press('Enter')
  else await page.locator('.comment-compose-actions .submit').click()
}

test.describe('CriticMarkup comment authoring (sidebar compose)', () => {
  let app: ElectronApplication
  let page: Page

  test.afterEach(async() => {
    if (app) await app.close()
  })

  test('a comment wraps the selected text, not a stale range', async() => {
    const launched = await launchWithMarkdown('hello my honey hello my baby\n')
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)

    await selectText(page, 'honey')
    await addCommentViaSidebar(page, app, 'a note')

    await expect.poll(() => readCanonicalMarkdown(page))
      .toContain('{==honey==}{>>a note<<}')
    await expectNoRendererErrors(app)
  })

  test('a mouse-drag selection (mouseup commit) wraps the right text', async() => {
    const launched = await launchWithMarkdown('hello my honey hello my baby\n')
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)

    await mouseSelect(page, 'honey')
    await addCommentViaSidebar(page, app, 'drag note')

    await expect.poll(() => readCanonicalMarkdown(page))
      .toContain('{==honey==}{>>drag note<<}')
    await expectNoRendererErrors(app)
  })

  test('Cmd+Enter submits the comment instead of discarding it', async() => {
    const launched = await launchWithMarkdown('hello my honey hello my baby\n')
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)

    await selectText(page, 'honey')
    await addCommentViaSidebar(page, app, 'via mod enter', 'mod-enter')

    await expect.poll(() => readCanonicalMarkdown(page)).toContain('{>>via mod enter<<}')
    await expectNoRendererErrors(app)
  })

  test('commenting a word inside a header does not crash', async() => {
    const launched = await launchWithMarkdown('# hello my honey hello\n')
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)

    await selectText(page, 'honey')
    await addCommentViaSidebar(page, app, 'header note')

    await expect.poll(() => readCanonicalMarkdown(page))
      .toContain('{==honey==}{>>header note<<}')
    await expectNoRendererErrors(app)
  })

  test('removing the leading # from a commented header does not crash', async() => {
    const launched = await launchWithMarkdown('# hello my honey hello\n')
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)

    await selectText(page, 'honey')
    await addCommentViaSidebar(page, app, 'header note')
    await expect.poll(() => readCanonicalMarkdown(page)).toContain('{>>header note<<}')

    // Put the caret at the very start of the line, then delete forward twice to
    // strip the '# ' — demoting the commented header to a paragraph.
    await page.evaluate(() => {
      const root = document.querySelector('.editor-component')
      if (!root) return
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const node = walker.nextNode() as Text | null
      if (!node) return
      const range = document.createRange()
      range.setStart(node, 0)
      range.setEnd(node, 0)
      const selection = window.getSelection()
      if (!selection) return
      selection.removeAllRanges()
      selection.addRange(range)
    })
    await page.keyboard.press('Delete')
    await page.keyboard.press('Delete')

    // No crash, the comment survives, AND the block actually demotes: the
    // canonical markdown must no longer start with a heading marker.
    await expectNoRendererErrors(app)
    await expect.poll(() => readCanonicalMarkdown(page)).toContain('{>>header note<<}')
    expect(await readCanonicalMarkdown(page)).not.toMatch(/^#\s/m)
  })
})

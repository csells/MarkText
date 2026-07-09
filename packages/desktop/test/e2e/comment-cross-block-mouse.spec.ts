// Reproduce the real cross-block flow: drag-select across two paragraphs with
// the mouse (muya's mousedown/mousemove/mouseup path), then add a comment.
import { expect, test } from '@playwright/test'
import { clickMenuById, focusEditor, getMarkdownContent, launchWithMarkdown } from './helpers'
import { waitForMenuItemEnabled } from './portable-comments-fixtures'

test('mouse-dragging a selection across two paragraphs then commenting wraps it', async() => {
  const md = 'hello world\n\nsecond line\n'
  const { app, page } = await launchWithMarkdown(md)
  try {
    await focusEditor(page)
    const p1 = page.locator('.mu-paragraph', { hasText: 'hello' }).first()
    const p2 = page.locator('.mu-paragraph', { hasText: 'second' }).first()
    const b1 = await p1.boundingBox()
    const b2 = await p2.boundingBox()
    if (!b1 || !b2) throw new Error('no bounding boxes')
    // Drag from mid-"hello world" down to mid-"second line".
    await page.mouse.move(b1.x + b1.width * 0.5, b1.y + b1.height / 2)
    await page.mouse.down()
    await page.mouse.move(b1.x + b1.width * 0.5, b1.y + b1.height / 2 + 4, { steps: 3 })
    await page.mouse.move(b2.x + b2.width * 0.5, b2.y + b2.height / 2, { steps: 8 })
    await page.mouse.up()

    const readSelInfo = () => page.evaluate(() => {
      const s = document.getSelection()
      return {
        isCollapsed: s?.isCollapsed ?? true,
        anchor: s?.anchorNode?.textContent?.slice(0, 15) ?? null,
        focus: s?.focusNode?.textContent?.slice(0, 15) ?? null,
      }
    })
    // The drag landing is observable as a non-collapsed DOM selection.
    await expect
      .poll(async() => (await readSelInfo()).isCollapsed, { timeout: 5000 })
      .toBe(false)
    const selInfo = await readSelInfo()
    // eslint-disable-next-line no-console
    console.log('DOM selection after drag:', JSON.stringify(selInfo))

    // The REAL bug is the menu item being disabled — the shortcut/menu respect
    // `.enabled`, unlike clickMenuById which calls .click() directly.
    const menuEnabled = await waitForMenuItemEnabled(app, 'review.add-comment', true)
    // eslint-disable-next-line no-console
    console.log('Add Comment menu enabled after cross-block drag:', menuEnabled)
    expect(menuEnabled, 'Add Comment menu should be enabled for a cross-block selection').toBe(true)

    await clickMenuById(app, 'review.add-comment')
    // Markers exist only in the SERIALIZED document (the runtime is clean).
    await expect
      .poll(() => getMarkdownContent(page), { timeout: 5000 })
      .toMatch(/<!--MC:[^>]+-->/)
    const markdown = await getMarkdownContent(page)
    // The open marker lands in the first paragraph and the close in the
    // second (the exact offsets depend on where the drag ray hits the text).
    expect(markdown).toMatch(/^hello .*<!--MC:(?!~)[^>]*-->/mu)
    expect(markdown).toMatch(/^second .*<!--MC:~[^>]*-->/mu)
  } finally {
    await app.close()
  }
})

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  clearRendererErrors,
  clickMenuById,
  closeElectron,
  expectNoRendererErrors,
  focusEditor,
  launchWithMarkdown,
  readCanonicalMarkdown
} from './helpers'

const menuEnabled = (app: ElectronApplication, id: string): Promise<boolean | null> =>
  app.evaluate(({ Menu }, menuId) =>
    Menu.getApplicationMenu()?.getMenuItemById(menuId)?.enabled ?? null, id)

// ---------------------------------------------------------------------------
// Selection helpers. The user's bug only reproduces with REAL gestures (native
// keyboard shift-selection and hardware-style mouse drags), because those carry
// a browser selection base and go through the document view's live event path. Pre-built DOM
// Ranges (selectText/mouseSelect) exercise a different, model-committed path and
// hid the defect — so the real-gesture helpers below are the ones that matter.
// ---------------------------------------------------------------------------

// Pre-build a DOM Range over `needle`. Model-committed path (not a real gesture).
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

// Place a collapsed caret at character `offset` of the first non-empty
// paragraph. The document view wraps paragraph text in inline spans, so walk to the text
// node that owns the offset rather than trusting the content span's firstChild.
const placeCaret = async(page: Page, offset: number): Promise<void> => {
  const placed = await page.evaluate((target) => {
    const root = document.querySelector('.editor-component') as HTMLElement | null
    if (!root) return false
    root.focus()
    const span = Array.from(root.querySelectorAll('span.document-view-run')).find(
      (candidate) => (candidate.textContent ?? '').trim().length > 0
    )
    if (!span) return false
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
    let remaining = target
    let node = walker.nextNode() as Text | null
    while (node) {
      const len = node.textContent?.length ?? 0
      if (remaining <= len) break
      remaining -= len
      node = walker.nextNode() as Text | null
    }
    if (!node) return false
    const range = document.createRange()
    range.setStart(node, remaining)
    range.setEnd(node, remaining)
    const selection = window.getSelection()
    if (!selection) return false
    selection.removeAllRanges()
    selection.addRange(range)
    // The document view derives its active block from key events on the root, not a bare
    // selectionchange — nudge it so the caret registers before we extend.
    root.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    return true
  }, offset)
  if (!placed) throw new TypeError(`Could not place the caret at offset ${offset}.`)
  await page.waitForTimeout(150)
}

// Select `count` characters from `startOffset` using REAL Shift+ArrowRight
// keystrokes — a native same-paragraph keyboard selection.
const keyboardSelect = async(
  page: Page,
  startOffset: number,
  count: number
): Promise<void> => {
  await placeCaret(page, startOffset)
  for (let index = 0; index < count; index++) {
    await page.keyboard.press('Shift+ArrowRight')
  }
  await page.waitForTimeout(200)
}

// Select via a REAL hardware-style mouse drag: compute the pixel span of
// `needle` from client rects, then press-move-release with intermediate steps.
const mouseDragSelect = async(page: Page, needle: string): Promise<void> => {
  const rects = await page.evaluate((text) => {
    const contents = Array.from(
      document.querySelectorAll('.editor-component .document-view-block')
    ) as HTMLElement[]
    const content = contents.find((el) => (el.textContent ?? '').includes(text))
    if (!content) return null
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const index = node.textContent?.indexOf(text) ?? -1
      if (index >= 0) {
        const head = document.createRange()
        head.setStart(node, index)
        head.setEnd(node, index + 1)
        const tail = document.createRange()
        tail.setStart(node, index + text.length - 1)
        tail.setEnd(node, index + text.length)
        const h = head.getBoundingClientRect()
        const t = tail.getBoundingClientRect()
        return { sx: h.left, sy: h.top + h.height / 2, ex: t.right, ey: t.top + t.height / 2 }
      }
    }
    return null
  }, needle)
  if (!rects) throw new TypeError(`Could not locate ${JSON.stringify(needle)} for a mouse drag.`)
  await page.mouse.move(rects.sx, rects.sy)
  await page.mouse.down()
  await page.mouse.move((rects.sx + rects.ex) / 2, (rects.sy + rects.ey) / 2, { steps: 6 })
  await page.mouse.move(rects.ex, rects.ey, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(200)
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

// ===========================================================================
// Same-paragraph authoring — every input path must land the note on exactly
// the selected span. These are the cases the app supports today.
// ===========================================================================
test.describe('CriticMarkup comment authoring — same paragraph', () => {
  let app: ElectronApplication
  let page: Page

  test.afterEach(async() => {
    if (app) await closeElectron(app)
  })

  test('programmatic range → menu wraps the selection', async() => {
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

  test('real keyboard shift-selection → menu wraps the selection', async() => {
    const launched = await launchWithMarkdown('now is the time for all good men\n')
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)

    // Shift+ArrowRight x3 from offset 0 selects "now".
    await keyboardSelect(page, 0, 3)
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('now')
    await addCommentViaSidebar(page, app, 'kbd note')

    await expect.poll(() => readCanonicalMarkdown(page))
      .toContain('{==now==}{>>kbd note<<}')
    await expectNoRendererErrors(app)
  })

  test('real keyboard shift-selection with human-timed pauses', async() => {
    const launched = await launchWithMarkdown('now is the time for all good men\n')
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)

    // Extend one char at a time with a >120ms pause so the debounced
    // mid-gesture commit fires DURING the selection (the human-timing case).
    await placeCaret(page, 0)
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Shift+ArrowRight')
      await page.waitForTimeout(150)
    }
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('now is the')
    await addCommentViaSidebar(page, app, 'paused')

    await expect.poll(() => readCanonicalMarkdown(page))
      .toContain('{==now is the==}{>>paused<<}')
    await expectNoRendererErrors(app)
  })

  test('real mouse drag → menu wraps the selection', async() => {
    const launched = await launchWithMarkdown('hello my honey hello my baby\n')
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)

    await mouseDragSelect(page, 'honey')
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('honey')
    await addCommentViaSidebar(page, app, 'drag note')

    await expect.poll(() => readCanonicalMarkdown(page))
      .toContain('{==honey==}{>>drag note<<}')
    await expectNoRendererErrors(app)
  })

  test('Cmd+Enter submits the comment instead of discarding it', async() => {
    const launched = await launchWithMarkdown('now is the time for all good men\n')
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)

    await keyboardSelect(page, 0, 3)
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

    // Caret at the very start of the line, then delete forward twice to strip
    // the '# ' — demoting the commented header to a paragraph.
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

    await expectNoRendererErrors(app)
    await expect.poll(() => readCanonicalMarkdown(page)).toContain('{>>header note<<}')
    expect(await readCanonicalMarkdown(page)).not.toMatch(/^#\s/m)
  })
})

// ===========================================================================
// Cross-paragraph. The CriticMarkup engine fully supports a span that crosses a
// paragraph break: an already-authored one renders and round-trips byte-exact,
// and authoring one from a live cross-block selection now wraps the whole span.
// The host restores both parser-owned range endpoints after focus returns from
// the compose box or menu.
// ===========================================================================
test.describe('CriticMarkup comment authoring — cross paragraph', () => {
  let app: ElectronApplication
  let page: Page

  test.afterEach(async() => {
    if (app) await closeElectron(app)
  })

  test('an authored cross-paragraph span renders and round-trips', async() => {
    const source = 'now is the {==time for all good men\n\nI wish I were==}{>>note<<} here\n'
    const launched = await launchWithMarkdown(source)
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)
    await page.waitForTimeout(300)

    expect(await readCanonicalMarkdown(page)).toBe(source)
    const highlights = page.locator('.editor-component mark')
    await expect(highlights).toHaveCount(2)
    expect(await highlights.allTextContents()).toEqual([
      'time for all good men',
      'I wish I were'
    ])
    await expect(page.locator(
      '.editor-component [data-critic-type="comment"]'
    )).toHaveCount(1)
    await expectNoRendererErrors(app)
  })

  test('real keyboard cross-paragraph selection wraps the whole span', async() => {
    const source =
      'now is the time for all good men\n\nI wish I were in the land of cotton!\n'
    const launched = await launchWithMarkdown(source)
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)

    await keyboardSelect(page, 11, 28)
    await expect.poll(() => page.evaluate(() =>
      window.getSelection()?.toString()
    )).toBe('time for all good men\n\nI wish')
    await addCommentViaSidebar(page, app, 'xnote')

    await expect.poll(() => readCanonicalMarkdown(page)).toBe(
      'now is the {==time for all good men\n\nI wish==}{>>xnote<<}' +
      ' I were in the land of cotton!\n'
    )
    await expectNoRendererErrors(app)
  })

  // Cross-block mouse selection is its own public gesture. This must prove the
  // exact browser selection before opening the compose UI and the exact source
  // afterward; same-paragraph and keyboard tests are not substitutes.
  test('real mouse cross-paragraph drag wraps the whole span', async() => {
    const source =
      'now is the time for all good men\n\nI wish I were in the land of cotton!\n'
    const launched = await launchWithMarkdown(source)
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)
    await placeCaret(page, 0)

    // Drag from "time" on line 1 down into "wish" on line 2.
    const rects = await page.evaluate(() => {
      const contents = Array.from(
        document.querySelectorAll('.editor-component .document-view-block')
      ) as HTMLElement[]
      const find = (needle: string, edge: 'start' | 'end') => {
        const content = contents.find((el) => (el.textContent ?? '').includes(needle))
        if (!content) return null
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          const node = walker.currentNode as Text
          const index = node.textContent?.indexOf(needle) ?? -1
          if (index >= 0) {
            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, index + needle.length)
            const r = range.getBoundingClientRect()
            return {
              x: edge === 'start' ? r.left + 1 : r.right - 1,
              y: r.top + r.height / 2
            }
          }
        }
        return null
      }
      const start = find('time', 'start')
      const end = find('wish', 'end')
      return start && end ? { start, end } : null
    })
    if (!rects) throw new TypeError('Could not locate drag endpoints.')
    await page.mouse.move(rects.start.x, rects.start.y)
    await page.mouse.down()
    await page.mouse.move(rects.end.x, rects.end.y, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    await expect.poll(() => page.evaluate(() =>
      window.getSelection()?.toString()
    )).toBe('time for all good men\n\nI wish')
    await addCommentViaSidebar(page, app, 'dnote')

    await expect.poll(() => readCanonicalMarkdown(page)).toBe(
      'now is the {==time for all good men\n\nI wish==}{>>dnote<<}' +
      ' I were in the land of cotton!\n'
    )
    await expectNoRendererErrors(app)
  })
})

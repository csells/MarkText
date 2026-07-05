// Arrowing across a hidden comment marker within a single line must never park
// the caret inside the marker's zero-size `<!--MC:id-->` text (an invisible,
// zero-height caret). muya jumps the whole marker in one keydown step. Guards
// the same-line case from both travel directions ("hello [world]" commented).
import { expect, test, type Page } from '@playwright/test'
import { focusEditor, launchWithMarkdown } from './helpers'

const META = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119'

const readSel = (page: Page) => page.evaluate(() => {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return { inMarker: true, h: 0, txt: null }
  const node = sel.anchorNode
  const el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null)
  const range = sel.getRangeAt(0).cloneRange()
  range.collapse(true)
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  return {
    inMarker: !!el?.closest('.mu-comment-marker'),
    h: rect ? Math.round(rect.height) : 0,
    txt: node?.textContent ?? null,
  }
})

test('caret stays visible arrowing right across a same-line comment marker', async() => {
  const md = `hello <!--MC:a-->world<!--MC:~a-->\n\n[MC:a]: ${META}\n`
  const { app, page } = await launchWithMarkdown(md, { suppressErrorDialog: true })
  try {
    await focusEditor(page)
    await page.locator('.mu-paragraph', { hasText: 'hello' }).first().click()
    await page.keyboard.press('Home')
    // Walk to the marker boundary (end of "hello "), then cross it.
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(120)
    const sel = await readSel(page)
    expect(sel.inMarker, 'caret must not land inside the hidden marker').toBe(false)
    expect(sel.h, `caret must stay visible (h>0), got ${sel.h}`).toBeGreaterThan(0)
    expect(sel.txt).toContain('world')
  } finally {
    await app.close()
  }
})

test('caret stays visible arrowing left across a same-line comment marker', async() => {
  const md = `hello <!--MC:a-->world<!--MC:~a--> end\n\n[MC:a]: ${META}\n`
  const { app, page } = await launchWithMarkdown(md, { suppressErrorDialog: true })
  try {
    await focusEditor(page)
    // Start at the start of " end" (just past the closing marker) and arrow
    // left back across the commented word.
    await page.locator('.mu-paragraph', { hasText: 'hello' }).first().click()
    await page.keyboard.press('End')
    // "world end" → walk left to the space before "end", then across the word.
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(120)
    const sel = await readSel(page)
    expect(sel.inMarker, 'caret must not land inside the hidden marker').toBe(false)
    expect(sel.h, `caret must stay visible (h>0), got ${sel.h}`).toBeGreaterThan(0)
  } finally {
    await app.close()
  }
})

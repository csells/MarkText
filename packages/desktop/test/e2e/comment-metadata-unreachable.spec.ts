// The hidden comment metadata definition block (`[MC:id]: data:...`, rendered
// all-hidden and typically the last block) must be UNREACHABLE by the caret in
// WYSIWYG: no arrow/Cmd-Down into it, and no way to add content below it. Typing
// after navigating to the document bottom must never corrupt the metadata line.
import { expect, test, type Page } from '@playwright/test'
import { focusEditor, launchWithMarkdown } from './helpers'

const META = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119'

const readState = (page: Page) => page.evaluate(() => {
  const sel = document.getSelection()
  const node = sel?.anchorNode ?? null
  const el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null)
  const paras = [...document.querySelectorAll('.mu-paragraph')].map(p => p.textContent ?? '')
  return {
    inMetadata: !!el?.closest('.mu-comment-metadata'),
    anchorText: (node?.textContent ?? '').slice(0, 30),
    // Whether the anchor block is (or is inside) a paragraph whose text is a
    // metadata definition.
    anchorIsMetaLine: /^\s*\[MC:[^\]]+\]:/.test(el?.closest('.mu-paragraph')?.textContent ?? ''),
    paragraphCount: paras.length,
    hasIntactMeta: paras.some(t => /\[MC:a\]: data:application\/json;base64,/.test(t)),
  }
})

test('caret cannot enter or pass the hidden metadata block via keyboard', async() => {
  const md = `hello world\n\n<!--MC:a-->commented<!--MC:~a--> tail\n\n[MC:a]: ${META}\n`
  const { app, page } = await launchWithMarkdown(md, { suppressErrorDialog: true })
  try {
    await focusEditor(page)
    const before = await readState(page)
    const paraCountBefore = before.paragraphCount

    // Go to the last VISIBLE paragraph, then hammer ArrowDown well past it.
    await page.locator('.mu-paragraph', { hasText: 'tail' }).first().click()
    await page.keyboard.press('End')
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(40)
      const s = await readState(page)
      expect(s.inMetadata, `ArrowDown #${i + 1} entered metadata`).toBe(false)
      expect(s.anchorIsMetaLine, `ArrowDown #${i + 1} landed on the metadata line`).toBe(false)
    }

    // Cmd+Down (document end) must also stay out of the metadata block.
    await page.keyboard.press('Meta+ArrowDown')
    await page.waitForTimeout(60)
    const atEnd = await readState(page)
    expect(atEnd.inMetadata, 'Cmd+Down entered metadata').toBe(false)
    expect(atEnd.anchorIsMetaLine, 'Cmd+Down landed on the metadata line').toBe(false)

    // Typing at the document bottom must not corrupt the metadata or add a
    // paragraph below it.
    await page.keyboard.type('Z')
    await page.waitForTimeout(80)
    const after = await readState(page)
    expect(after.hasIntactMeta, 'metadata line must remain intact after typing').toBe(true)
    expect(after.paragraphCount, 'no new paragraph created below the metadata').toBe(paraCountBefore)
  } finally {
    await app.close()
  }
})

test('caret cannot enter the hidden metadata block via click or ArrowRight-at-end', async() => {
  const md = `hello world\n\n<!--MC:a-->commented<!--MC:~a--> tail\n\n[MC:a]: ${META}\n`
  const { app, page } = await launchWithMarkdown(md, { suppressErrorDialog: true })
  try {
    await focusEditor(page)

    // Click in the empty editor space BELOW the last visible content.
    const editor = page.locator('.mu-editor, [contenteditable]').first()
    const box = await editor.boundingBox()
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height - 20)
      await page.waitForTimeout(80)
      const clicked = await readState(page)
      expect(clicked.inMetadata, 'click at editor bottom entered metadata').toBe(false)
      expect(clicked.anchorIsMetaLine, 'click at editor bottom landed on the metadata line').toBe(false)
    }

    // ArrowRight repeatedly from the last visible paragraph must not cross into
    // the metadata block either.
    await page.locator('.mu-paragraph', { hasText: 'tail' }).first().click()
    await page.keyboard.press('End')
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(40)
      const s = await readState(page)
      expect(s.inMetadata, `ArrowRight #${i + 1} entered metadata`).toBe(false)
      expect(s.anchorIsMetaLine, `ArrowRight #${i + 1} landed on the metadata line`).toBe(false)
    }
    const end = await readState(page)
    expect(end.hasIntactMeta, 'metadata intact after click/arrow navigation').toBe(true)
  } finally {
    await app.close()
  }
})

test('Cmd+A then collapse does not rest the caret in the metadata block', async() => {
  const md = `hello\n\n<!--MC:a-->x<!--MC:~a--> y\n\n[MC:a]: ${META}\n`
  const { app, page } = await launchWithMarkdown(md, { suppressErrorDialog: true })
  try {
    await focusEditor(page)
    await page.locator('.mu-paragraph', { hasText: 'hello' }).first().click()
    await page.keyboard.press('Meta+a')
    await page.waitForTimeout(60)
    // Collapse the select-all range to its focus (document end).
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(60)
    const s = await readState(page)
    expect(s.inMetadata, 'Cmd+A collapse rested caret in metadata').toBe(false)
    expect(s.anchorIsMetaLine, 'Cmd+A collapse rested caret on the metadata line').toBe(false)
    await page.keyboard.type('Z')
    await page.waitForTimeout(60)
    expect((await readState(page)).hasIntactMeta, 'metadata intact after Cmd+A collapse + type').toBe(true)
  } finally {
    await app.close()
  }
})

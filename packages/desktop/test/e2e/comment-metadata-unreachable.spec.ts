// The hidden comment metadata definition block (`[MC:id]: data:...`, rendered
// all-hidden and typically the last block) must be UNREACHABLE by the caret in
// WYSIWYG: no arrow/Cmd-Down into it, and no way to add content below it. Typing
// after navigating to the document bottom must never corrupt the metadata line.
import { expect, test, type Page } from '@playwright/test'
import { focusEditor, launchWithMarkdown, readSettled } from './helpers'

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
    // The anchor's own paragraph text — asserted on after navigation jumps so
    // a keystroke that is a platform no-op fails loudly instead of leaving
    // every "did not enter metadata" check trivially green.
    anchorParaText: (el?.closest('.mu-paragraph')?.textContent ?? '').slice(0, 60),
    selectionCollapsed: sel ? sel.isCollapsed : true,
    selectionText: (sel?.toString() ?? '').slice(0, 80),
    paragraphCount: paras.length,
    hasIntactMeta: paras.some(t => /\[MC:a\]: data:application\/json;base64,/.test(t)),
  }
})

// Document-end jump: ⌘↓ is macOS-only; Linux/Windows use Ctrl+End. CI runs
// this suite on ubuntu, where a Meta-modified key is a no-op.
const DOCUMENT_END = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'

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
      const s = await readSettled(() => readState(page), { requiredStreak: 2, interval: 40 })
      expect(s.inMetadata, `ArrowDown #${i + 1} entered metadata`).toBe(false)
      expect(s.anchorIsMetaLine, `ArrowDown #${i + 1} landed on the metadata line`).toBe(false)
    }

    // Document-end jump must also stay out of the metadata block. Assert it
    // actually reached the last VISIBLE paragraph — a platform no-op keystroke
    // would otherwise leave the metadata checks trivially green.
    await page.keyboard.press(DOCUMENT_END)
    // The jump reaching the last visible paragraph is the positive observable.
    await expect
      .poll(async() => (await readState(page)).anchorParaText, { timeout: 5000 })
      .toContain('tail')
    const atEnd = await readSettled(() => readState(page), { requiredStreak: 2, interval: 40 })
    expect(atEnd.anchorParaText, 'document-end jump must reach the last visible paragraph').toContain('tail')
    expect(atEnd.inMetadata, 'document-end jump entered metadata').toBe(false)
    expect(atEnd.anchorIsMetaLine, 'document-end jump landed on the metadata line').toBe(false)

    // Typing at the document bottom must not corrupt the metadata or add a
    // paragraph below it.
    await page.keyboard.type('Z')
    const after = await readSettled(() => readState(page), { requiredStreak: 3, interval: 40 })
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
      const clicked = await readSettled(() => readState(page), { requiredStreak: 2, interval: 40 })
      expect(clicked.inMetadata, 'click at editor bottom entered metadata').toBe(false)
      expect(clicked.anchorIsMetaLine, 'click at editor bottom landed on the metadata line').toBe(false)
    }

    // ArrowRight repeatedly from the last visible paragraph must not cross into
    // the metadata block either.
    await page.locator('.mu-paragraph', { hasText: 'tail' }).first().click()
    await page.keyboard.press('End')
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight')
      const s = await readSettled(() => readState(page), { requiredStreak: 2, interval: 40 })
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
    // The desktop accelerator drives the progressive select-all (block first,
    // whole document on the next press), so press twice; muya's own keyboard
    // handling selects the whole document on the first press. Either way two
    // presses span the document — assert it, so a platform where the keystroke
    // is a no-op fails here instead of passing the metadata checks vacuously.
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('ControlOrMeta+a')
    // The whole-document span is the positive observable for the keystrokes.
    await expect
      .poll(
        async() => {
          const s = await readState(page)
          return s.selectionText.includes('hello') && s.selectionText.includes('y')
        },
        { timeout: 5000 }
      )
      .toBe(true)
    const selected = await readState(page)
    expect(selected.selectionCollapsed, 'select-all must produce a real selection').toBe(false)
    expect(selected.selectionText, 'select-all must span the whole document').toContain('hello')
    expect(selected.selectionText, 'select-all must span the whole document').toContain('y')
    // Collapse the select-all range to its focus (document end).
    await page.keyboard.press('ArrowRight')
    const s = await readSettled(() => readState(page), { requiredStreak: 2, interval: 40 })
    expect(s.inMetadata, 'select-all collapse rested caret in metadata').toBe(false)
    expect(s.anchorIsMetaLine, 'select-all collapse rested caret on the metadata line').toBe(false)
    await page.keyboard.type('Z')
    const typed = await readSettled(() => readState(page), { requiredStreak: 3, interval: 40 })
    expect(typed.hasIntactMeta, 'metadata intact after Cmd+A collapse + type').toBe(true)
  } finally {
    await app.close()
  }
})

// Typing at the trailing edge of a comment must keep the character. Regression
// for the "first char dropped" bug: inputHandler validated the post-insert
// cursor offset against the PRE-insert text, so a char typed at the end of a
// comment landed (in the DOM) at an offset that fell inside the closing marker
// of the stale text — the unsafe-marker guard then reverted it.
import { expect, test } from '@playwright/test'
import { focusEditor, getMarkdownContent, launchWithMarkdown } from './helpers'

const META = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119'

test('typing at the end of a comment keeps the character (inside the comment)', async() => {
  const md = `<!--MC:a-->commented<!--MC:~a--> tail\n\n[MC:a]: ${META}\n`
  const { app, page } = await launchWithMarkdown(md)
  try {
    await focusEditor(page)
    // Put the caret at the END of the visible commented word "commented"
    // (i.e. immediately before the hidden closing marker).
    await page.evaluate(() => {
      const hl = document.querySelector('.mu-comment-highlight, .mu-comment-highlight-active')
      const textNode = hl?.firstChild
      if (!textNode) throw new Error('no comment highlight text node')
      const sel = document.getSelection()!
      const range = document.createRange()
      range.setStart(textNode, textNode.textContent!.length)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    })
    // Wait for the engine to COMMIT the caret (bridge read) — the debounced
    // selectionchange pipeline is async, and typing before the commit would
    // land the keystroke at the previous caret.
    await page.waitForFunction(() => {
      const selection = window.__marktextTest?.getEngineSelection() as {
        anchor?: { offset: number } | null
        focus?: { offset: number } | null
        anchorPath?: Array<string | number>
        focusPath?: Array<string | number>
      } | null
      if (!selection?.anchorPath?.length || !selection?.focusPath?.length) return false
      return (
        selection.anchorPath.join('/') === selection.focusPath.join('/') &&
        selection.anchor?.offset === 'commented'.length &&
        selection.focus?.offset === 'commented'.length
      )
    })
    await page.keyboard.type('Z')

    // The rendered text is clean; the char's position relative to the range
    // is only visible in the SERIALIZED bytes (close anchors absorb
    // insertions at their offset, so end-typing lands inside).
    await expect
      .poll(() => getMarkdownContent(page), { timeout: 5000 })
      .toContain('Z')
    expect(await getMarkdownContent(page)).toContain('<!--MC:a-->commentedZ<!--MC:~a-->')
  } finally {
    await app.close()
  }
})

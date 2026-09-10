import { expect, test } from '../fixtures/muya'
import { floats, quickInsertItem } from '../helpers/selectors'

for (const { bound, tracked, comment } of [
  { bound: false, tracked: false, comment: false },
  { bound: true, tracked: false, comment: false },
  { bound: true, tracked: true, comment: false },
  { bound: true, tracked: false, comment: true },
  { bound: true, tracked: true, comment: true }
]) {
  for (const activation of ['click', 'keyboard'] as const) {
    test(`quick-insert heading consumes its exact annotated trigger (${activation}, Core=${bound}, Track=${tracked}, comment=${comment})`, async({ page }) => {
      const source = comment ? '/h{>>inside<<}ea\n\noutside{>>keep<<}\n' : bound ? '/h{++e++}a\n\noutside{>>keep<<}\n' : '/hea\n\noutside\n'
      const query = comment ? '/h{>>inside<<}ea' : bound ? '/h{++e++}a' : '/hea'
      const typedQuery = query + (tracked ? '{++d++}' : 'd')
      const tail = bound ? '\n\noutside{>>keep<<}\n' : '\n\noutside\n'
      const querySource = typedQuery + tail
      const heading = (tracked ? `{~~${typedQuery}~>## ~~}` : '## ') + tail
      const typed = (tracked ? `{~~${typedQuery}~>## X~~}` : '## X') + tail
      await page.evaluate(async({ source, bound, tracked }) => {
        const muya = window.muya!
        if (bound) {
          const modulePath = '/coreBoundaryControl.ts'
          const control = await import(/* @vite-ignore */ modulePath)
          window.coreBoundary = control.bootCoreBoundary(muya, source, tracked)
        } else {
          muya.setContent(source)
        }
        muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(4, 4, true)
        muya.focus()
        muya.flush()
      }, { source, bound, tracked })
      let failed = false
      try {
        await page.keyboard.type('d')
        await expect(page.locator(floats.quickInsert)).toBeVisible()
        if (bound) {
          expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: querySource }, legacyCalls: [] })
        } else {
          expect(await page.evaluate(() => { window.muya!.flush(); return window.muya!.getMarkdown() })).toBe(querySource)
        }
        if (activation === 'click') {
          await page.locator(quickInsertItem('atx-heading 2')).click({ timeout: 5000 })
        } else {
          await expect(page.locator(`${quickInsertItem('atx-heading 1')}.active`)).toBeVisible()
          await page.keyboard.press('ArrowDown')
          await expect(page.locator(`${quickInsertItem('atx-heading 2')}.active`)).toBeVisible()
          await page.keyboard.press('Enter')
        }
        if (bound) {
          expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading }, anchor: 3, caret: 3, legacyCalls: [] })
        } else {
          expect(await page.evaluate(() => { window.muya!.flush(); return window.muya!.getMarkdown() })).toBe(heading)
        }
        await expect(page.locator('h2.mu-atx-heading')).toHaveCount(1)
        await page.keyboard.type('X')
        if (bound) {
          expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: typed }, legacyCalls: [] })
          await page.evaluate(() => window.coreBoundary.history('undo'))
          expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: heading } })
          await page.evaluate(() => window.coreBoundary.history('undo'))
          expect(await page.evaluate(() => window.coreBoundary.read())).toMatchObject({ source: { source: querySource } })
          await page.evaluate(() => window.coreBoundary.history('redo'))
          expect(await page.evaluate(() => window.coreBoundary.reopen())).toMatchObject({ source: heading })
        } else {
          expect(await page.evaluate(() => { window.muya!.flush(); return window.muya!.getMarkdown() })).toBe(typed)
          await page.evaluate(() => window.muya!.undo())
          expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(heading)
          await page.evaluate(() => window.muya!.undo())
          expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(querySource)
          await page.evaluate(() => window.muya!.redo())
          expect(await page.evaluate(() => window.muya!.getMarkdown())).toBe(heading)
        }
      } catch (error) {
        failed = true
        throw error
      } finally {
        if (bound && !failed) { await page.evaluate(() => window.coreBoundary.dispose()) }
      }
    })
  }
}

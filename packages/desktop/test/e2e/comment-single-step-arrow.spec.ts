// Arrowing across a comment boundary must advance one VISIBLE column per press.
// A zero-width marker has two caret offsets at the same x; without single-step
// handling one arrow press "freezes" (same x twice). Measures caret x per press.
import { expect, test, type Page } from '@playwright/test'
import { focusEditor, launchWithMarkdown, readSettled } from './helpers'

const META = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119'

const readCaret = (page: Page) => page.evaluate(() => {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return { x: -1, h: 0 }
  const r = sel.getRangeAt(0).cloneRange(); r.collapse(true)
  const rect = r.getClientRects()[0] ?? r.getBoundingClientRect()
  return { x: rect ? Math.round(rect.left) : -1, h: rect ? Math.round(rect.height) : 0 }
})

// Each sample must settle (hold across consecutive reads) — the engine's
// caret snap is async, so a clocked read could sample mid-flight.
const settledCaret = (page: Page) =>
  readSettled(() => readCaret(page), { requiredStreak: 2, interval: 40, timeout: 2000 })

async function walk(page: Page, key: string, presses: number) {
  const xs: number[] = []
  const hs: number[] = []
  const first = await settledCaret(page); xs.push(first.x); hs.push(first.h)
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key)
    const r = await settledCaret(page); xs.push(r.x); hs.push(r.h)
  }
  return { xs, hs }
}

test('arrowing right across a comment advances one column per press (no frozen step)', async() => {
  const md = `ab <!--MC:a-->word<!--MC:~a--> cd\n\n[MC:a]: ${META}\n`
  const { app, page } = await launchWithMarkdown(md, { suppressErrorDialog: true })
  try {
    await focusEditor(page)
    const countFrozen = (xs: number[]) => {
      let frozen = 0
      // Ignore the final two saturating presses at the line's far end.
      for (let i = 1; i < xs.length - 2; i++) {
        if (xs[i] >= 0 && xs[i] === xs[i - 1]) frozen++
      }
      return frozen
    }

    await page.locator('.mu-paragraph', { hasText: 'word' }).first().click()
    await page.keyboard.press('Home')
    await settledCaret(page)
    // Walk right through "ab word cd", then back left to the start.
    const fwd = await walk(page, 'ArrowRight', 10)
    const back = await walk(page, 'ArrowLeft', 10)
    // eslint-disable-next-line no-console
    console.log('ArrowRight x:', JSON.stringify(fwd.xs), 'ArrowLeft x:', JSON.stringify(back.xs))
    expect(countFrozen(fwd.xs), `frozen ArrowRight presses: ${countFrozen(fwd.xs)}`).toBe(0)
    expect(countFrozen(back.xs), `frozen ArrowLeft presses: ${countFrozen(back.xs)}`).toBe(0)
    // Caret must stay visible the whole walk (never lands in a zero-height marker).
    const invisible = [...fwd.hs, ...back.hs].filter(h => h === 0).length
    expect(invisible, `invisible caret samples: ${invisible}`).toBe(0)
  } finally {
    await app.close()
  }
})

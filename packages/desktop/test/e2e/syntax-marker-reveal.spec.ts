import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import type { Locator, Page } from 'playwright'
import { launchWithMarkdown, sendIpcToRenderer } from './helpers'

// Upstream MarkText hides a syntax's markers and shows them in gray while the
// caret is in that syntax. These gestures run unchanged against an upstream
// build, whose results the expectations below record.
const SOURCE = '# Heading text\n\nBody **bold** and [link](https://example.com) end.\n'
const lineEnd = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'
const lineStart = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'

/**
 * The content's syntax markers as runs of text sharing one marker class, in
 * document order. Runs, not elements: how a hidden run splits into elements
 * is not visible.
 */
const markers = (content: Locator): Promise<string[]> =>
  content.evaluate((element) => {
    const names = ['mu-hide', 'mu-gray', 'mu-header-tight-space', 'mu-link-in-bracket']
    const runs: Array<{ key: string, text: string }> = []
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      let owner = node.parentElement
      while (owner !== null && owner !== element && !names.some((name) => owner!.classList.contains(name))) {
        owner = owner.parentElement
      }
      const key = owner === null || owner === element ? '' : owner.className
      const last = runs.at(-1)
      if (last !== undefined && last.key === key) last.text += node.textContent ?? ''
      else runs.push({ key, text: node.textContent ?? '' })
    }
    return runs.filter((run) => run.key !== '').map((run) => `${run.key}|${run.text}`)
  })

const markerWidth = (content: Locator, selector: string): Promise<number> =>
  content.evaluate(
    (element, query) => element.querySelector(query)?.getBoundingClientRect().width ?? -1,
    selector
  )

const press = async(page: Page, key: string, times: number): Promise<void> => {
  for (let index = 0; index < times; index += 1) await page.keyboard.press(key)
}

test('syntax markers follow real caret gestures as upstream shows them', async() => {
  const { app, page, filePath } = await launchWithMarkdown(SOURCE, {
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  const heading = page.locator('.editor-component .mu-atxheading-content').first()
  const body = page.locator('.editor-component span.mu-paragraph-content').first()
  const hiddenHeading = ['mu-hide mu-remove|#', 'mu-header-tight-space mu-remove| ']
  const grayHeading = ['mu-gray mu-remove|# ']
  const hiddenBody = [
    'mu-hide mu-remove|**',
    'mu-hide mu-remove|**',
    'mu-hide mu-remove|[',
    'mu-hide mu-remove|](https://example.com)'
  ]
  try {
    // The caret at the end of the body leaves every marker hidden.
    await body.click()
    await page.keyboard.press(lineEnd)
    await expect.poll(() => markers(heading)).toEqual(hiddenHeading)
    await expect.poll(() => markers(body)).toEqual(hiddenBody)
    expect(await markerWidth(heading, '.mu-hide')).toBe(0)

    // On the heading's text, the marker stays hidden.
    await heading.click()
    await expect.poll(() => markers(heading)).toEqual(hiddenHeading)
    // From the line's start, the caret is on the `#` and shows it in gray,
    // then on the space after it, and then on the text, which hides it.
    await page.keyboard.press(lineStart)
    await expect.poll(() => markers(heading)).toEqual(grayHeading)
    expect(await markerWidth(heading, '.mu-gray')).toBeGreaterThan(0)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => markers(heading)).toEqual(grayHeading)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => markers(heading)).toEqual(hiddenHeading)

    // Typing at the heading's end keeps its marker hidden and its text exact.
    await press(page, 'ArrowRight', 'Heading text'.length)
    await page.keyboard.type(' more')
    await expect(heading).toHaveText('# Heading text more')
    await expect.poll(() => markers(heading)).toEqual(hiddenHeading)

    // Clicking into bold text shows its markers; the heading's hide again.
    await body.locator('strong').click()
    await expect.poll(() => markers(heading)).toEqual(hiddenHeading)
    await expect.poll(async() => (await markers(body)).slice(0, 2)).toEqual([
      'mu-gray mu-remove|**',
      'mu-gray mu-remove|**'
    ])
    // Typing there keeps them shown once the document has taken the edit.
    await page.keyboard.type('X')
    await expect(body.locator('strong')).toContainText('X')
    await expect.poll(async() => (await markers(body)).slice(0, 2)).toEqual([
      'mu-gray mu-remove|**',
      'mu-gray mu-remove|**'
    ])
    // Arrowing out of the bold text hides them, and back in shows them.
    await press(page, 'ArrowRight', 7)
    await expect.poll(() => markers(body)).toEqual(hiddenBody)
    // From the line's start, the caret reaches the bold text's first `**`.
    await page.keyboard.press(lineStart)
    await press(page, 'ArrowRight', 'Body'.length)
    await expect.poll(() => markers(body)).toEqual(hiddenBody)
    await page.keyboard.press('ArrowRight')
    await expect.poll(async() => (await markers(body)).slice(0, 2)).toEqual([
      'mu-gray mu-remove|**',
      'mu-gray mu-remove|**'
    ])

    // Clicking into link text shows its brackets and destination.
    await body.locator('.mu-link').click()
    await expect.poll(async() => (await markers(body)).slice(2)).toEqual([
      'mu-gray mu-remove|[',
      'mu-gray mu-remove|](',
      'mu-link-in-bracket mu-remove|https://example.com',
      'mu-gray mu-remove|)'
    ])
    await expect.poll(async() => (await markers(body)).slice(0, 2)).toEqual([
      'mu-hide mu-remove|**',
      'mu-hide mu-remove|**'
    ])
    // The caret stays in the link text it shows, so typing lands there.
    await page.keyboard.type('Z')
    await expect(body.locator('.mu-link')).toContainText('Z')
    await expect.poll(async() => (await markers(body)).slice(2)).toEqual([
      'mu-gray mu-remove|[',
      'mu-gray mu-remove|](',
      'mu-link-in-bracket mu-remove|https://example.com',
      'mu-gray mu-remove|)'
    ])

    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toContain('more')
    // The clicks land somewhere in the bold and link text; only those places vary.
    expect(fs.readFileSync(filePath, 'utf8')).toMatch(/\*\*[bold]*X[bold]*\*\*/u)
    expect(fs.readFileSync(filePath, 'utf8')).toMatch(/\[[link]*Z[link]*\]/u)
    expect(fs.readFileSync(filePath, 'utf8').replace('X', '').replace('Z', '')).toBe(
      SOURCE.replace('# Heading text', '# Heading text more')
    )
  } finally {
    await app.close()
  }
})

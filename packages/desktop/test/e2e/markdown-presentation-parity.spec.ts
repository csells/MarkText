import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import type { Locator } from 'playwright'
import { launchWithMarkdown, sendIpcToRenderer } from './helpers'

// Upstream MarkText's presentation of definitions, character references and
// the editor's first block. These gestures run unchanged against an upstream
// build, whose results the expectations record.
const SOURCE = [
  '# Heading text',
  '',
  'See [the note][^1], [the guide][guide] and a &#35; or &amp; sign.',
  '',
  '[^1]: https://example.com/note',
  '',
  '[guide]: https://example.com/guide "The guide"',
  ''
].join('\n')

/** Each reference-definition part's class and text, in document order. */
const definitionParts = (content: Locator): Promise<string[]> =>
  content.evaluate((element) =>
    [...element.querySelectorAll('span')]
      // Upstream also renders empty title and closing parts; they show nothing.
      .filter((span) => span.textContent !== '' && [...span.classList].some((name) => name.startsWith('mu-reference-')))
      .map((span) => `${span.className}|${span.textContent}`)
  )

for (const footnote of [false, true]) {
  test(`definitions, references and the first block as upstream shows them, footnotes ${footnote ? 'on' : 'off'}`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(SOURCE, {
      env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' },
      preferences: { footnote }
    })
    try {
      const paragraphs = page.locator('.editor-component span.mu-paragraph-content')
      const body = paragraphs.filter({ hasText: 'See ' }).first()
      const guide = paragraphs.filter({ hasText: '[guide]:' }).first()
      await expect(body).toBeVisible()

      // The first block sits below the column's 20 px top padding.
      const offset = await page.evaluate(() => {
        const container = document.querySelector('.editor-component .mu-container')!
        const heading = container.querySelector('h1')!
        return {
          padding: getComputedStyle(container).paddingTop,
          headingTop: heading.getBoundingClientRect().top - container.getBoundingClientRect().top
        }
      })
      expect(offset.padding).toBe('20px')
      expect(offset.headingTop).toBeGreaterThanOrEqual(20)

      expect(await definitionParts(guide)).toEqual([
        'mu-reference-marker|[',
        'mu-reference-label|guide',
        'mu-reference-marker|]: https://example.com/guide "',
        'mu-reference-title|The guide',
        'mu-reference-marker|"'
      ])
      await expect(body.locator('a.mu-reference-link', { hasText: 'the guide' })).toHaveAttribute(
        'href',
        'https://example.com/guide'
      )
      // Only `&amp;` is drawn as its character; `&#35;` stays text.
      await expect(body.locator('.mu-html-escape')).toHaveCount(1)
      await expect(body.locator('.mu-html-escape')).toHaveAttribute('data-character', '&')

      if (footnote) {
        await expect(page.locator('.editor-component .mu-footnote')).toHaveCount(1)
        await expect(body.locator('.mu-inline-footnote-identifier')).toHaveCount(1)
      } else {
        // Without footnotes, `[^1]: ...` is an ordinary reference definition.
        const note = paragraphs.filter({ hasText: '[^1]:' }).first()
        expect(await definitionParts(note)).toEqual([
          'mu-reference-marker|[',
          'mu-reference-label|^1',
          'mu-reference-marker|]: https://example.com/note'
        ])
        await expect(body.locator('a.mu-reference-link', { hasText: 'the note' })).toHaveAttribute(
          'href',
          'https://example.com/note'
        )
        // Typing in the definition's destination keeps it a definition.
        // Click past the line's end, which places the caret there in both.
        const line = (await note.boundingBox())!
        await page.mouse.click(line.x + line.width - 2, line.y + line.height / 2)
        await page.keyboard.type('s')
        await expect.poll(() => definitionParts(note)).toEqual([
          'mu-reference-marker|[',
          'mu-reference-label|^1',
          'mu-reference-marker|]: https://example.com/notes'
        ])
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect
          .poll(() => fs.readFileSync(filePath, 'utf8'))
          .toBe(SOURCE.replace('example.com/note', 'example.com/notes'))
      }
    } finally {
      await app.close()
    }
  })
}

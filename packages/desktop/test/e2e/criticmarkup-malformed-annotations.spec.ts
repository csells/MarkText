import { expect, test } from '@playwright/test'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown
} from './helpers'
import { clickText, expectSaved, hiddenCoreEnv as env } from './reviewGestures'

// Plan 0012 G44, Profile 1 CM2/R2/R4/T2: empty payloads form annotations;
// unpaired, mismatched or dividerless markers are literal text that affects
// nothing after them. Opening, editing near or inside them and saving changes
// only the typed bytes.

const cases: ReadonlyArray<{
  name: string
  line: string
  /** Rendered paragraph text; literal markers stay visible. */
  rendered: string
  annotations: number
  /** Text to click before, and what typing `!` there saves. */
  anchor: string
  edited: string
}> = [
  { name: 'empty Addition', line: 'A {++++} B', rendered: 'A  B', annotations: 1, anchor: 'B', edited: 'A {++++} !B' },
  { name: 'empty Deletion', line: 'A {----} B', rendered: 'A  B', annotations: 1, anchor: 'B', edited: 'A {----} !B' },
  { name: 'empty Substitution', line: 'A {~~~>~~} B', rendered: 'A  B', annotations: 1, anchor: 'B', edited: 'A {~~~>~~} !B' },
  { name: 'empty Highlight', line: 'A {====} B', rendered: 'A  B', annotations: 1, anchor: 'B', edited: 'A {====} !B' },
  { name: 'empty Comment', line: 'A {>><<} B', rendered: 'A  B', annotations: 1, anchor: 'B', edited: 'A {>><<} !B' },
  { name: 'unclosed opener', line: 'A {++abc B', rendered: 'A {++abc B', annotations: 0, anchor: 'bc B', edited: 'A {++a!bc B' },
  { name: 'stray closer', line: 'A abc++} B', rendered: 'A abc++} B', annotations: 0, anchor: 'c++}', edited: 'A ab!c++} B' },
  { name: 'mismatched closer', line: 'A {++a--} B', rendered: 'A {++a--} B', annotations: 0, anchor: '--} B', edited: 'A {++a!--} B' },
  // `~~a~~` inside the literal braces is GFM strikethrough, as upstream renders it.
  { name: 'Substitution without a divider', line: 'A {~~a~~} B', rendered: 'A {~~a~~} B', annotations: 0, anchor: 'B', edited: 'A {~~a~~} !B' },
  { name: 'opener with interior whitespace', line: 'A { ++a++} B', rendered: 'A { ++a++} B', annotations: 0, anchor: '++} B', edited: 'A { ++a!++} B' }
]

test.describe('Malformed and empty CriticMarkup', () => {
  for (const testCase of cases) {
    test(`${testCase.name} opens, renders, edits and saves exactly`, async() => {
      const source = `${testCase.line}\n\nAfter **bold** text.\n`
      const { app, page, filePath } = await launchWithReviewMarkdown(source, {
        suppressErrorDialog: true,
        env
      })
      try {
        const paragraph = page.locator('.editor-component .mu-paragraph-content').first()
        await expect(paragraph).toHaveText(testCase.rendered)
        if (testCase.annotations === 0) {
          await expect(paragraph.locator('[data-critic-kind]')).toHaveCount(0)
        }
        // Markers never swallow the rest of the document.
        await expect(page.locator('.editor-component strong').filter({ hasText: 'bold' })).toHaveCount(1)
        await expectSaved(app, filePath, source)

        await clickText(page, testCase.anchor, 'start')
        await page.keyboard.type('!')
        await expectSaved(app, filePath, `${testCase.edited}\n\nAfter **bold** text.\n`)
        await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
        await expectNoRendererErrors(app)
      } finally {
        await app.close()
      }
    })
  }
})

import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown as launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

// Plan 0012 G42: macOS text-system bindings reach the bound document as
// beforeinput types beyond plain typing (Ctrl+T insertTranspose, Ctrl+K
// deleteHardLineForward, Ctrl+Y insertFromYank). Each is pressed as a real
// key. Plain documents must end as Chromium's own editing leaves the same
// text (upstream MarkText lets the browser edit and reads the result back);
// the saved source and undo are the independent oracles.

const lineStart = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'

const settle = (page: Page) => page.evaluate(() => window.__marktextDocumentCore?.settled())

const press = async(page: Page, key: string, times = 1): Promise<void> => {
  for (let index = 0; index < times; index += 1) {
    await page.keyboard.press(key)
    await settle(page)
  }
}

/** Chromium's result for the same keys in an ordinary contenteditable. */
const chromiumReference = async(
  page: Page,
  text: string,
  caret: number,
  keys: readonly string[]
): Promise<string> => {
  await page.evaluate(
    ({ text, caret }) => {
      const reference = document.createElement('div')
      reference.id = 'cocoa-input-reference'
      reference.contentEditable = 'true'
      // As in Muya's paragraphs; collapsing white space would make Chromium
      // keep an edited space visible as U+00A0.
      reference.style.whiteSpace = 'pre-wrap'
      reference.textContent = text
      document.body.appendChild(reference)
      reference.focus()
      const node = reference.firstChild!
      document.getSelection()!.setBaseAndExtent(node, caret, node, caret)
    },
    { text, caret }
  )
  for (const key of keys) await page.keyboard.press(key)
  return page.evaluate(() => {
    const reference = document.getElementById('cocoa-input-reference')!
    const result = reference.textContent ?? ''
    reference.remove()
    return result
  })
}

const scenarios: ReadonlyArray<{
  name: string
  source: string
  tracked?: boolean
  caret: number
  keys: readonly string[]
  expected: string
  /** Visible paragraph text that Chromium's own editing must reproduce. */
  reference?: { text: string; result: (edited: string) => string }
}> = [
  {
    name: 'Ctrl+T swaps the characters around the caret',
    source: 'abc def\n',
    caret: 3,
    keys: ['Control+t'],
    expected: 'ab cdef\n',
    reference: { text: 'abc def', result: (edited) => `${edited}\n` }
  },
  {
    name: 'Ctrl+T at the paragraph end swaps the last two characters',
    source: 'abc\n',
    caret: 3,
    keys: ['Control+t'],
    expected: 'acb\n',
    reference: { text: 'abc', result: (edited) => `${edited}\n` }
  },
  {
    name: 'Ctrl+K then Ctrl+Y kills to the paragraph end and yanks as Chromium does',
    source: 'abc def\n',
    caret: 3,
    keys: ['Control+k', 'ArrowLeft', 'Control+y'],
    expected: '',
    reference: { text: 'abc def', result: (edited) => `${edited}\n` }
  },
  {
    name: 'Ctrl+T inside an Addition keeps the transposed text proposed',
    source: 'x {++abc++} y\n',
    caret: 4,
    keys: ['Control+t'],
    expected: 'x {++acb++} y\n'
  },
  {
    name: 'tracked Ctrl+T proposes the transposition as a Substitution',
    source: 'abc def\n',
    tracked: true,
    caret: 3,
    keys: ['Control+t'],
    expected: 'ab{~~c ~> c~~}def\n'
  }
]

for (const scenario of scenarios) {
  test(`native Cocoa input: ${scenario.name}`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(scenario.source, {
      suppressErrorDialog: true,
      env: {
        MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
        MARKTEXT_E2E_HIDDEN_WINDOW: '1'
      }
    })
    try {
      const expected =
        scenario.reference === undefined
          ? scenario.expected
          : scenario.reference.result(
            await chromiumReference(page, scenario.reference.text, scenario.caret, scenario.keys)
          )
      if (scenario.reference !== undefined && scenario.expected !== '') {
        expect(expected).toBe(scenario.expected)
      }
      if (scenario.tracked === true) {
        await page.getByTestId('critic-review-track-changes').click()
      }
      await page
        .locator('.editor-component span.mu-paragraph-content[contenteditable="true"]')
        .first()
        .click()
      await press(page, lineStart)
      await press(page, 'ArrowRight', scenario.caret)
      for (const key of scenario.keys) await press(page, key)
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)

      for (let step = 0; step < scenario.keys.length; step += 1) {
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await settle(page)
      }
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(scenario.source)
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

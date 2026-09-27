import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown as launchWithMarkdown,
  placeCaretInEditor,
  sendIpcToRenderer
} from './helpers'

// Plan 0012 G34: with Track Changes on, editing over existing suggestions
// follows Google Docs (observed hands-on 27 Sep). Every step is a real key
// gesture in the live editor; the saved source is the independent oracle.

const lineStart = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'
const bold = process.platform === 'darwin' ? 'Meta+B' : 'Control+B'

const press = async(page: Page, key: string, times = 1): Promise<void> => {
  for (let index = 0; index < times; index += 1) {
    await page.keyboard.press(key)
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
  }
}

const scenarios: ReadonlyArray<{
  name: string
  source: string
  gestures: (page: Page) => Promise<void>
  expected: string
}> = [
  {
    name: 'repeated Backspace strikes leftward and keeps one deletion',
    source: 'hello world\n',
    gestures: async page => {
      await press(page, 'ArrowRight', 5)
      await press(page, 'Backspace', 3)
    },
    expected: 'he{--llo--} world\n'
  },
  {
    name: 'typing before the struck text merges into one Substitution',
    source: 'hello world\n',
    gestures: async page => {
      await press(page, 'ArrowRight', 5)
      await press(page, 'Backspace', 3)
      await page.keyboard.type('ZY')
    },
    expected: 'he{~~llo~>ZY~~} world\n'
  },
  {
    name: 'Backspace over struck text only moves the caret, then extends the deletion',
    source: 'hello world\n',
    gestures: async page => {
      await press(page, 'ArrowRight', 5)
      await press(page, 'Backspace', 2)
      await press(page, 'ArrowRight', 2)
      await press(page, 'Backspace', 3)
    },
    expected: 'he{--llo--} world\n'
  },
  {
    name: 'repeated Delete strikes rightward, moves over struck text and extends the deletion',
    source: 'hello world\n',
    gestures: async page => {
      await press(page, 'Delete', 3)
      await press(page, 'ArrowLeft', 2)
      await press(page, 'Delete', 3)
    },
    expected: '{--hell--}o world\n'
  },
  {
    name: 'typing inside struck text splits the deletion',
    source: 'hello world\n',
    gestures: async page => {
      await press(page, 'ArrowRight', 5)
      await press(page, 'Backspace', 3)
      await press(page, 'ArrowRight', 1)
      await page.keyboard.type('X')
    },
    expected: 'he{--l--}{++X++}{--lo--} world\n'
  },
  {
    name: 'typing at a Substitution\'s edge extends its proposed text',
    source: 'hello world\n',
    gestures: async page => {
      await press(page, 'ArrowRight', 5)
      await press(page, 'Backspace', 3)
      await page.keyboard.type('Z')
      await press(page, 'ArrowLeft', 1)
      await page.keyboard.type('Y')
    },
    expected: 'he{~~llo~>YZ~~} world\n'
  },
  {
    name: 'replacing a selection that contains struck text proposes the rest',
    source: 'hello world\n',
    gestures: async page => {
      await press(page, 'ArrowRight', 5)
      await press(page, 'Backspace', 2)
      await press(page, 'Shift+ArrowRight', 4)
      await page.keyboard.type('Q')
    },
    expected: 'hel{--lo--}{~~ w~>Q~~}orld\n'
  },
  {
    name: 'Enter then typing is one Addition',
    source: 'Warm editing\n',
    gestures: async page => {
      await press(page, 'ArrowRight', 5)
      await press(page, 'Enter')
      await page.keyboard.type('ab')
      await press(page, 'Enter')
      await page.keyboard.type('c')
    },
    expected: 'Warm {++\n\nab\n\nc++}editing\n'
  },
  {
    name: 'bold over struck text changes nothing',
    source: 'hello world\n',
    gestures: async page => {
      await press(page, 'ArrowRight', 5)
      await press(page, 'Backspace', 3)
      await press(page, 'Shift+ArrowRight', 3)
      await press(page, bold)
    },
    expected: 'he{--llo--} world\n'
  }
]

for (const scenario of scenarios) {
  test(`tracked editing: ${scenario.name}`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(scenario.source, {
      suppressErrorDialog: true,
      env: {
        MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
        MARKTEXT_E2E_HIDDEN_WINDOW: '1'
      }
    })
    try {
      await page.getByTestId('critic-review-track-changes').click()
      await placeCaretInEditor(page)
      await page.keyboard.press(lineStart)
      await scenario.gestures(page)
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(scenario.expected)
      // No tracked edit faults the session into recovery.
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
}

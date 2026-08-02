import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeElectron,
  launchWithMarkdown,
  setSourceMarkdown,
  placeCaretInEditor,
} from './helpers'
import {
  expectCanonicalOnDisk,
  applicationMenuAccelerator,
  pressApplicationMenuAccelerator,
  pressUserKeybinding,
  redo,
  undo
} from './documentCoreReviewE2e'

// Paragraph accelerators are owned by Desktop's platform/user keybinding
// authority. Slash-query choices are owned by the target view. Both surfaces
// converge on one authenticated document-core intent and one history step.

test.describe('Quick-insert accelerators (item 49)', () => {
  // The conversion and diagram walks make a dozen menu round-trips each;
  // a full-surface sweep at ambient load ~5 measured one walk dying at
  // exactly the 30s default ceiling. Hang guard only — every assertion
  // inside is exact.
  test.describe.configure({ timeout: 90_000 })
  let app: ElectronApplication
  let page: Page
  let documentPath = ''

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('seed paragraph\n')
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test.beforeEach(async() => {
    // Reset to one empty paragraph with a collapsed caret.
    await setSourceMarkdown(page, app, '\n')
    await placeCaretInEditor(page)
    await page.click('.editor-component', { timeout: 5000 })
    await placeCaretInEditor(page)
  })

  test('⌥⌘C converts the empty paragraph into a code block', async() => {
    await pressApplicationMenuAccelerator(page, app, 'codeFencesMenuItem')

    const codeBlock = page.locator('.editor-component pre.document-view-code-block').first()
    await expect(codeBlock).toBeAttached({ timeout: 5000 })
    await expect(codeBlock.locator('code').first()).toBeAttached()

    const expected = '```\n\n```\n'
    await expectCanonicalOnDisk(page, app, documentPath, expected)

    // The blockquote accelerator must NOT have also fired.
    await expect(page.locator('.editor-component blockquote.document-view-blockquote')).toHaveCount(0)

    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath, '\n')
    await redo(app)
    await expectCanonicalOnDisk(page, app, documentPath, expected)
  })

  test('⌥⌘Q converts the empty paragraph into a blockquote', async() => {
    await pressApplicationMenuAccelerator(page, app, 'quoteBlockMenuItem')

    const quote = page.locator('.editor-component blockquote.document-view-blockquote').first()
    await expect(quote).toBeAttached({ timeout: 5000 })

    const expected = '> \n'
    await expectCanonicalOnDisk(page, app, documentPath, expected)

    // The code-block accelerator must NOT have also fired.
    await expect(page.locator('.editor-component pre.document-view-code-block')).toHaveCount(0)

    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath, '\n')
    await redo(app)
    await expectCanonicalOnDisk(page, app, documentPath, expected)
  })

  test('Quick Insert requests a 1×1 table shape and preserves exact history', async() => {
    await page.keyboard.type('/table')
    await page.locator(
      '.document-view-quick-insert-item[data-label="table"]'
    ).click()

    const dialog = page.getByRole('dialog', { name: 'Insert Table' })
    await expect(dialog).toBeVisible()
    const rows = dialog.getByRole('spinbutton', { name: 'Rows' })
    const columns = dialog.getByRole('spinbutton', { name: 'Columns' })
    await expect(rows).toBeFocused()
    await rows.fill('1')
    await columns.fill('1')
    await dialog.getByRole('button', { name: 'OK' }).click()
    await expect(dialog).toBeHidden()

    const table = '|   |\n| --- |\n'
    await expectCanonicalOnDisk(page, app, documentPath, table)
    await expect(page.locator('.editor-component table tr')).toHaveCount(1)
    await expect(
      page.locator('.editor-component table .document-view-table-cell')
    ).toHaveCount(1)

    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath, '/table\n')
    await redo(app)
    await expectCanonicalOnDisk(page, app, documentPath, table)
  })

  test('every conversion choice commits exact source with exact history', async() => {
    const cases = [
      ['paragraph', '\n'],
      ['thematic-break', '---\n'],
      ['frontmatter', '---\n\n---\n'],
      ['atx-heading 1', '# \n'],
      ['atx-heading 2', '## \n'],
      ['atx-heading 3', '### \n'],
      ['atx-heading 4', '#### \n'],
      ['atx-heading 5', '##### \n'],
      ['atx-heading 6', '###### \n'],
      ['math-block', '$$\n\n$$\n'],
      ['html-block', '<div>\n\n</div>\n'],
      ['code-block', '```\n\n```\n'],
      ['block-quote', '> \n'],
      ['order-list', '1. \n'],
      ['bullet-list', '- \n'],
      ['task-list', '- [ ] \n']
    ] as const

    for (const [label, expected] of cases) {
      await setSourceMarkdown(page, app, '\n')
      await placeCaretInEditor(page)
      await page.keyboard.type('/')
      await page.locator(
        `.document-view-quick-insert-item[data-label="${label}"]`
      ).click()

      await expectCanonicalOnDisk(page, app, documentPath, expected)
      await undo(app)
      await expectCanonicalOnDisk(page, app, documentPath, '/\n')
      await redo(app)
      await expectCanonicalOnDisk(page, app, documentPath, expected)
    }
  })

  test('all five diagram choices commit exact fences with exact history', async() => {
    for (const language of [
      'vega-lite',
      'mermaid',
      'plantuml',
      'flowchart',
      'sequence'
    ] as const) {
      await setSourceMarkdown(page, app, '\n')
      await placeCaretInEditor(page)
      await page.keyboard.type('/')
      await page.locator(
        `.document-view-quick-insert-item[data-label="${language}"]`
      ).click()

      const diagram = `\`\`\`${language}\n\n\`\`\`\n`
      await expectCanonicalOnDisk(page, app, documentPath, diagram)
      await undo(app)
      await expectCanonicalOnDisk(page, app, documentPath, '/\n')
      await redo(app)
      await expectCanonicalOnDisk(page, app, documentPath, diagram)
    }
  })
})

test.describe('user paragraph-keybinding authority', () => {
  test('an unbound command has no hidden fallback for its former physical stroke', async() => {
    const launched = await launchWithMarkdown('\n', {
      userKeybindings: { 'paragraph.code-fence': '' }
    })
    try {
      await placeCaretInEditor(launched.page)
      const accelerator = await launched.app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()?.getMenuItemById('codeFencesMenuItem')
          ?.accelerator ?? null)
      expect(accelerator).toBeNull()

      await pressUserKeybinding(
        launched.page,
        launched.app,
        'CmdOrCtrl+Alt+C'
      )
      await expectCanonicalOnDisk(launched.page, launched.app, launched.filePath, '\n')
    } finally {
      await closeElectron(launched.app)
    }
  })

  test('one rebound physical stroke executes one command and one history step', async() => {
    const rebound = 'CmdOrCtrl+Alt+Shift+K'
    const launched = await launchWithMarkdown('\n', {
      userKeybindings: { 'paragraph.code-fence': rebound }
    })
    try {
      await placeCaretInEditor(launched.page)
      await expect(
        applicationMenuAccelerator(launched.app, 'codeFencesMenuItem')
      ).resolves.toBe(rebound)

      await pressUserKeybinding(launched.page, launched.app, rebound)
      const expected = '```\n\n```\n'
      await expectCanonicalOnDisk(launched.page, launched.app, launched.filePath, expected)
      await undo(launched.app)
      await expectCanonicalOnDisk(launched.page, launched.app, launched.filePath, '\n')
      await redo(launched.app)
      await expectCanonicalOnDisk(launched.page, launched.app, launched.filePath, expected)
    } finally {
      await closeElectron(launched.app)
    }
  })
})

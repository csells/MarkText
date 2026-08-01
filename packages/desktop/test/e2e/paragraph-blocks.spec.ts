import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeElectron,
  launchWithMarkdown,
  launchWithFixtureCopy,
  clickMenuById,
  setSourceMarkdown,
  placeCaretInEditor,
  enterSourceMode,
  exitSourceMode,
  getMarkdownContent,
} from './helpers'
import {
  expectCanonicalOnDisk,
  saveCanonicalSnapshot
} from './documentCoreReviewE2e'
import {
  placeCaretAfter,
  pointForText,
  prepareApplicationMenuAccelerator,
  pressApplicationMenuAccelerator,
  redo,
  undo
} from './documentCoreReviewE2e'

const resetTo = async(page: Page, app: ElectronApplication, text: string) => {
  await setSourceMarkdown(page, app, text + '\n')
  await placeCaretInEditor(page)
}

test.describe('Paragraph block transforms', () => {
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
    await resetTo(page, app, 'sample text')
  })

  test('Heading 1', async() => {
    await clickMenuById(app, 'heading1MenuItem')
    await page.waitForSelector('.editor-component h1', { state: 'attached', timeout: 5000 })
  })

  test('Heading 2', async() => {
    await clickMenuById(app, 'heading2MenuItem')
    await page.waitForSelector('.editor-component h2', { state: 'attached', timeout: 5000 })
  })

  test('Heading 3', async() => {
    await clickMenuById(app, 'heading3MenuItem')
    await page.waitForSelector('.editor-component h3', { state: 'attached', timeout: 5000 })
  })

  test('Bullet list', async() => {
    await clickMenuById(app, 'bulletListMenuItem')
    await page.waitForSelector('.editor-component ul li', { state: 'attached', timeout: 5000 })
  })

  test('Ordered list', async() => {
    await clickMenuById(app, 'orderListMenuItem')
    await page.waitForSelector('.editor-component ol li', { state: 'attached', timeout: 5000 })
  })

  test('Task list', async() => {
    await clickMenuById(app, 'taskListMenuItem')
    await page.waitForSelector('.editor-component input[type="checkbox"]', {
      state: 'attached',
      timeout: 5000
    })
  })

  test('Block quote', async() => {
    await clickMenuById(app, 'quoteBlockMenuItem')
    await page.waitForSelector('.editor-component blockquote', { state: 'attached', timeout: 5000 })
  })

  test('Code fence', async() => {
    await clickMenuById(app, 'codeFencesMenuItem')
    const present = await page
      .locator('.editor-component pre, .editor-component .document-view-code-block')
      .first()
      .waitFor({ state: 'attached', timeout: 5000 })
      .then(() => true)
      .catch(() => false)
    expect(present).toBe(true)
  })

  test('Horizontal rule', async() => {
    await resetTo(page, app, '')
    await clickMenuById(app, 'horizontalLineMenuItem')
    await expectCanonicalOnDisk(page, app, documentPath, '---\n')
    const present = await page
      .locator('.editor-component hr, .editor-component figure[data-role="HR"]')
      .first()
      .waitFor({ state: 'attached', timeout: 5000 })
      .then(() => true)
      .catch(() => false)
    expect(present).toBe(true)
  })

  test('Math block', async() => {
    await clickMenuById(app, 'mathBlockMenuItem')
    const ok = await page
      .locator('.editor-component .document-view-math-block, .editor-component figure.document-view-math-block')
      .first()
      .waitFor({ state: 'attached', timeout: 5000 })
      .then(() => true)
      .catch(() => false)
    expect(ok).toBe(true)
  })

  test('HTML block', async() => {
    await clickMenuById(app, 'htmlBlockMenuItem')
    const ok = await page
      .locator('.editor-component .document-view-html-block, .editor-component figure.document-view-html-block')
      .first()
      .waitFor({ state: 'attached', timeout: 5000 })
      .then(() => true)
      .catch(() => false)
    expect(ok).toBe(true)
  })

  test('every configured non-Table paragraph accelerator has exact source and history', async() => {
    const cases = [
      ['heading1MenuItem', 'sample text\n', '# sample text\n'],
      ['heading2MenuItem', 'sample text\n', '## sample text\n'],
      ['heading3MenuItem', 'sample text\n', '### sample text\n'],
      ['heading4MenuItem', 'sample text\n', '#### sample text\n'],
      ['heading5MenuItem', 'sample text\n', '##### sample text\n'],
      ['heading6MenuItem', 'sample text\n', '###### sample text\n'],
      ['upgradeHeadingMenuItem', '## sample text\n', '# sample text\n'],
      ['degradeHeadingMenuItem', '## sample text\n', '### sample text\n'],
      ['codeFencesMenuItem', 'sample text\n', '```\nsample text\n```\n'],
      ['quoteBlockMenuItem', 'sample text\n', '> sample text\n'],
      ['mathBlockMenuItem', 'sample text\n', '$$\nsample text\n$$\n'],
      ['htmlBlockMenuItem', 'sample text\n', '<div>\nsample text\n</div>\n'],
      ['orderListMenuItem', 'sample text\n', '1. sample text\n'],
      ['bulletListMenuItem', 'sample text\n', '- sample text\n'],
      ['taskListMenuItem', 'sample text\n', '- [ ] sample text\n'],
      ['looseListItemMenuItem', '- one\n- two\n', '- one\n\n- two\n'],
      ['paragraphMenuItem', '## sample text\n', 'sample text\n'],
      ['horizontalLineMenuItem', 'sample text\n', '---\n'],
      ['frontMatterMenuItem', 'sample text\n', '---\nsample text\n---\n']
    ] as const

    for (const [menuId, source, expected] of cases) {
      await setSourceMarkdown(page, app, source)
      await placeCaretInEditor(page)
      const accelerator = await app.evaluate(({ Menu }, id) =>
        Menu.getApplicationMenu()?.getMenuItemById(id)?.accelerator ?? null,
      menuId)

      if (accelerator === null) {
        expect(process.platform).toBe('win32')
        expect(menuId).toMatch(/^heading[1-6]MenuItem$/)
        continue
      }

      await pressApplicationMenuAccelerator(page, app, menuId)
      await expectCanonicalOnDisk(page, app, documentPath, expected)
      await undo(app)
      await expectCanonicalOnDisk(page, app, documentPath, source)
      await redo(app)
      await expectCanonicalOnDisk(page, app, documentPath, expected)
    }
  })
})

// Paragraph › Table owns the desktop creation path. This proof drives the
// actual menu and dialog, then checks the session's exact source and history.
test.describe('Insert table dialog', () => {
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

  test('opens the picker dialog, confirms, and inserts the 4x3 default table', async() => {
    // Start from an empty paragraph with a live engine cursor in it.
    await setSourceMarkdown(page, app, '\n')
    await placeCaretInEditor(page)

    // The registered Table accelerator executes the one Desktop-owned command
    // and opens the dimensions-only dialog with its 4×3 defaults.
    await pressApplicationMenuAccelerator(page, app, 'tableMenuItem')

    const dialog = page.locator('.ag-insert-table-dialog')
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    await expect(dialog).toBeVisible()

    // The seeded default shape is 4 rows x 3 columns.
    const rows = await dialog.locator('.el-input-number input').first().inputValue()
    expect(rows).toBe('4')

    // Confirm through the dimensions-only adapter. The view retained the
    // original target and owns the single authenticated table intent.
    await dialog.locator('.el-button--primary').click()
    await dialog.waitFor({ state: 'hidden', timeout: 5000 })
    await expect(page.locator('.editor-component')).toBeFocused()

    const expected = [
      '|   |   |   |',
      '| --- | --- | --- |',
      '|   |   |   |',
      '|   |   |   |',
      '|   |   |   |',
      ''
    ].join('\n')
    await expectCanonicalOnDisk(page, app, documentPath, expected)

    // The 4x3 default yields 4 rendered rows x 3 cells.
    await page.waitForSelector('.editor-component table', { state: 'attached', timeout: 5000 })
    await expect
      .poll(() => page.locator(
        '.editor-component table .document-view-table-cell'
      ).count(), { timeout: 5000 })
      .toBe(12)
    const rowCount = await page.locator('.editor-component table tr').count()
    expect(rowCount).toBe(4)

    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath, '\n')
    await redo(app)
    await expectCanonicalOnDisk(page, app, documentPath, expected)
  })

  test('Escape and Cancel restore focus without mutating the document', async() => {
    for (const cancel of ['Escape', 'Cancel'] as const) {
      await setSourceMarkdown(page, app, '\n')
      await placeCaretInEditor(page)
      await pressApplicationMenuAccelerator(page, app, 'tableMenuItem')
      const dialog = page.getByRole('dialog', { name: 'Insert Table' })
      await expect(dialog).toBeVisible()
      if (cancel === 'Escape') {
        await page.keyboard.press('Escape')
      } else {
        await dialog.getByRole('button', { name: 'Cancel' }).click()
      }
      await expect(dialog).toBeHidden()
      await expect(page.locator('.editor-component')).toBeFocused()
      await expectCanonicalOnDisk(page, app, documentPath, '\n')
    }
  })

  test('captures a no-delay pointer selection that differs from the model cursor', async() => {
    await setSourceMarkdown(page, app, 'First\n\nSecond\n')
    await expect(page.locator('.editor-component')).toContainText('Second')
    await placeCaretAfter(page, 'Second')
    const point = await pointForText(page, 'First')
    const pressTable = await prepareApplicationMenuAccelerator(
      page,
      app,
      'tableMenuItem'
    )
    await page.evaluate(() => {
      delete document.documentElement.dataset.tablePointerSelection
      const capture = (): void => {
        const selection = window.getSelection()
        if (
          selection === null ||
          selection.rangeCount !== 1 ||
          selection.toString() !== 'First'
        ) return
        const range = selection.getRangeAt(0)
        const modelOffset = (node: Node, offset: number): number | null => {
          const origin = node instanceof Element ? node : node.parentElement
          const carrier = origin?.closest<HTMLElement>('[data-model-start]')
          if (
            carrier === null ||
            carrier === undefined ||
            node.nodeType !== Node.TEXT_NODE
          ) return null
          return Number(carrier.dataset.modelStart) + offset
        }
        document.documentElement.dataset.tablePointerSelection = JSON.stringify({
          text: selection.toString(),
          start: modelOffset(range.startContainer, range.startOffset),
          end: modelOffset(range.endContainer, range.endOffset)
        })
        document.removeEventListener('selectionchange', capture)
      }
      document.addEventListener('selectionchange', capture)
    })

    await page.mouse.dblclick(point.x, point.y)
    await pressTable()

    const dialog = page.getByRole('dialog', { name: 'Insert Table' })
    await expect.poll(() => page.evaluate(() => {
      const value = document.documentElement.dataset.tablePointerSelection
      return value === undefined ? null : JSON.parse(value)
    })).toEqual({ text: 'First', start: 0, end: 5 })
    await dialog.getByRole('spinbutton', { name: 'Rows' }).fill('1')
    await dialog.getByRole('spinbutton', { name: 'Columns' }).fill('1')
    await dialog.getByRole('button', { name: 'OK' }).click()

    const expected = 'First\n\n|   |\n| --- |\n\nSecond\n'
    await expectCanonicalOnDisk(page, app, documentPath, expected)
    await undo(app)
    await expectCanonicalOnDisk(page, app, documentPath,
      'First\n\nSecond\n'
    )
  })
})

// Item 89 — desktop source-mode round-trip for a GFM table with mixed column
// alignment. No prior desktop spec consumed a mixed-alignment table fixture;
// fixture-render.spec.ts only asserts the table RENDERS (cell count), never the
// source-mode round-trip or that the :--- / :--: / ---: alignment markers
// survive the WYSIWYG → source toggle. We assert that the alignment markers
// survive and then edit a cell to prove the tab becomes dirty.
test.describe('Table source-mode round-trip + modified indicator (item 89)', () => {
  let app: ElectronApplication
  let page: Page
  let documentPath = ''

  test.beforeAll(async() => {
    const launched = await launchWithFixtureCopy('test/e2e/data/table.md')
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
    // Let the live view finish rendering the table blocks.
    await page.waitForSelector('.editor-component table', { state: 'attached', timeout: 10000 })
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test('source mode preserves the left/center/right alignment markers', async() => {
    await enterSourceMode(page, app)
    const md = await page.evaluate(() => {
      const input = document.querySelector(
        '.source-code-input'
      ) as HTMLTextAreaElement | null
      return input?.value ?? ''
    })
    await exitSourceMode(page, app)

    // The delimiter row is the table's second line. The fixture declares
    // :--- (left), :--: (center), ----: (right). Desktop source mode shows the
    // document markdown, so all three alignment markers must round-trip.
    const delimiterRow = md.split('\n').find((line) => /^\s*\|\s*:?-+/.test(line)) ?? ''
    expect(delimiterRow).not.toBe('')

    // Match each alignment marker as a standalone delimiter cell (tolerant of
    // the surrounding pipes/whitespace and of any serializer column-width
    // normalisation): left → :---, center → :--:, right → ---:.
    expect(delimiterRow).toMatch(/\|\s*:-+\s*\|/) // left: leading colon only
    expect(delimiterRow).toMatch(/\|\s*:-+:\s*\|/) // center: both colons
    expect(delimiterRow).toMatch(/\|\s*-+:\s*\|/) // right: trailing colon only

    // The header/body content also round-trips intact.
    expect(md).toContain('Name')
    expect(md).toContain('Score')
    expect(md).toContain('Ada')
  })

  test('editing a table cell marks the tab as unsaved', async() => {
    // Sanity: a freshly loaded file starts clean.
    expect(
      await page.evaluate(() => !!document.querySelector('.tabs-container > li.active.unsaved'))
    ).toBe(false)

    // Click into the first table cell so the engine's active block is a cell,
    // then type into it.
    const firstCell = page.locator('.editor-component table td.document-view-table-cell').first()
    await firstCell.click()
    await page.waitForTimeout(150)
    await page.keyboard.type('X', { delay: 0 })

    // The edit dirties the tab; poll because the indicator flips on the
    // asynchronous verified publication. Asserted before the canonical read:
    // observing canonical bytes presses Save, which cleans the tab.
    await expect
      .poll(
        () => page.evaluate(() => !!document.querySelector('.tabs-container > li.active.unsaved')),
        { timeout: 5000 }
      )
      .toBe(true)

    await expect
      .poll(() => saveCanonicalSnapshot(page, app, documentPath), { timeout: 5000 })
      .toContain('X')

    // The modified content is observable through the source-mode round-trip.
    const md = await getMarkdownContent(page, app)
    expect(md).toContain('X')
  })
})

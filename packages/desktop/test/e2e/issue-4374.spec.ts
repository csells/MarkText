import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import {
  closeElectron,
  clearRendererErrors,
  clickMenuById,
  expectNoRendererErrors,
  launchWithMarkdown
} from './helpers'
import {
  expectCanonicalOnDisk,
  placeCaretByPointer
} from './documentCoreReviewE2e'
import { reviewMenuEnabled } from './documentCoreReviewE2e'

interface ParagraphBreakCase {
  readonly name: string
  readonly source: string
  readonly needle: string
  readonly caretOffset: number
  readonly expected: string
  readonly expectedCaretText: string
  readonly expectedCaretOffset: number
}

const CASES: readonly ParagraphBreakCase[] = Object.freeze([
  {
    name: 'second paragraph in a loose item',
    source:
      '# Doc\n\n' +
      '- first paragraph\n\n' +
      '  second paragraph\n\n' +
      '- another item\n',
    needle: 'second paragraph',
    caretOffset: 'second paragraph'.length,
    expected:
      '# Doc\n\n' +
      '- first paragraph\n\n' +
      '  second paragraph\n\n\n\n' +
      '- another item\n',
    expectedCaretText: 'another item',
    expectedCaretOffset: 0
  },
  {
    name: 'trailing paragraph in a task item',
    source:
      '# Doc\n\n' +
      '- [ ] task line\n\n' +
      '  trailing paragraph\n',
    needle: 'trailing paragraph',
    caretOffset: 'trailing paragraph'.length,
    expected:
      '# Doc\n\n' +
      '- [ ] task line\n\n' +
      '  trailing paragraph\n\n\n',
    expectedCaretText: 'trailing paragraph',
    expectedCaretOffset: 'trailing paragraph'.length
  },
  {
    name: 'paragraph after a nested list',
    source:
      '# Doc\n\n' +
      '- main paragraph\n\n' +
      '  - sub one\n' +
      '  - sub two\n\n' +
      '  tail paragraph\n',
    needle: 'tail paragraph',
    caretOffset: 'tail paragraph'.length,
    expected:
      '# Doc\n\n' +
      '- main paragraph\n\n' +
      '  - sub one\n' +
      '  - sub two\n\n' +
      '  tail paragraph\n\n\n',
    expectedCaretText: 'tail paragraph',
    expectedCaretOffset: 'tail paragraph'.length
  },
  {
    name: 'middle of a loose-item paragraph',
    source:
      '# Doc\n\n' +
      '- alpha\n\n' +
      '  beta gamma delta\n',
    needle: 'beta gamma delta',
    caretOffset: 'beta'.length,
    expected:
      '# Doc\n\n' +
      '- alpha\n\n' +
      '  beta\n\n gamma delta\n',
    expectedCaretText: 'gamma delta',
    expectedCaretOffset: 0
  },
  {
    name: 'end of an ordinary list item',
    source:
      '# Doc\n\n' +
      '- one\n' +
      '- two\n',
    needle: 'one',
    caretOffset: 'one'.length,
    expected:
      '# Doc\n\n' +
      '- one\n\n\n' +
      '- two\n',
    expectedCaretText: 'two',
    expectedCaretOffset: 0
  }
])

interface PublicSelection {
  readonly text: string
  readonly collapsed: boolean
  readonly anchorText: string | null
  readonly anchorOffset: number
  readonly focusText: string | null
  readonly focusOffset: number
  readonly editorFocused: boolean
}

const readPublicSelection = (page: Page): Promise<PublicSelection | null> =>
  page.evaluate(() => {
    const root = document.querySelector('.editor-component')
    const selection = window.getSelection()
    if (
      root === null ||
      selection === null ||
      selection.anchorNode === null ||
      selection.focusNode === null
    ) {
      return null
    }
    const active = document.activeElement
    return {
      text: selection.toString(),
      collapsed: selection.isCollapsed,
      anchorText: selection.anchorNode.textContent,
      anchorOffset: selection.anchorOffset,
      focusText: selection.focusNode.textContent,
      focusOffset: selection.focusOffset,
      editorFocused: active === root || (active !== null && root.contains(active))
    }
  })

const placeCaret = async(
  page: Page,
  needle: string,
  offset: number
): Promise<void> => {
  await placeCaretByPointer(page, needle, offset)
}

const expectCaret = async(
  page: Page,
  text: string,
  offset: number
): Promise<void> => {
  await expect.poll(() => readPublicSelection(page)).toMatchObject({
    text: '',
    collapsed: true,
    anchorText: text,
    anchorOffset: offset,
    focusText: text,
    focusOffset: offset,
    editorFocused: true
  })
}

test.describe('parser-owned paragraph breaks in nested list content', () => {
  test.describe.configure({ timeout: 120000 })

  for (const row of CASES) {
    test(`commits and undoes one exact break: ${row.name}`, async() => {
      const launched = await launchWithMarkdown(row.source)
      const { app, page } = launched
      try {
        await placeCaret(page, row.needle, row.caretOffset)
        await expectCaret(page, row.needle, row.caretOffset)
        await clearRendererErrors(app)

        await page.keyboard.press('Enter')
        await expectCanonicalOnDisk(page, app, launched.filePath, row.expected)
        await expectCaret(
          page,
          row.expectedCaretText,
          row.expectedCaretOffset
        )
        await expect.poll(() =>
          reviewMenuEnabled(app, 'editUndoMenuItem')
        ).toBe(true)

        await clickMenuById(app, 'editUndoMenuItem')
        await expectCanonicalOnDisk(page, app, launched.filePath, row.source)
        await expectCaret(page, row.needle, row.caretOffset)
        await expect.poll(() =>
          reviewMenuEnabled(app, 'editUndoMenuItem')
        ).toBe(false)
        await expectNoRendererErrors(app)
      } finally {
        await closeElectron(app)
      }
    })
  }
})

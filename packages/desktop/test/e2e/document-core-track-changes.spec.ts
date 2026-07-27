import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  clickMenuById,
  readCanonicalMarkdown
} from './helpers'
import {
  closeDocumentCore,
  launchDocumentCore,
  openReviewSidebar,
  placeCaretAfter,
  reviewMenuEnabled,
  selectDomText
} from './documentCoreReviewE2e'

const SOURCE = [
  'Typing target.',
  '',
  'Paste target.',
  '',
  'Compose target.',
  '',
  'Format target.',
  '',
  'Structure target.',
  '',
  'Nested {~~old {++inner++} arm~>new arm~~} target.',
  ''
].join('\n')

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

const expectSource = async(page: Page, source: string): Promise<void> => {
  await expect.poll(() => readCanonicalMarkdown(page)).toBe(source)
}

const expectPublicSelection = async(
  page: Page,
  expected: Partial<PublicSelection>
): Promise<void> => {
  await expect.poll(() => readPublicSelection(page)).toMatchObject({
    ...expected,
    editorFocused: true
  })
}

const undoThroughApplicationMenu = async(
  app: ElectronApplication
): Promise<void> => {
  await expect.poll(() => reviewMenuEnabled(app, 'editUndoMenuItem')).toBe(true)
  await clickMenuById(app, 'editUndoMenuItem')
}

const commitComposition = async(page: Page, text: string): Promise<void> => {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length
    })
    await cdp.send('Input.insertText', { text })
  } finally {
    await cdp.detach()
  }
}

test.describe('document-core Track Changes through Electron', () => {
  test.describe.configure({ timeout: 120000 })
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchDocumentCore(SOURCE)
    app = launched.app
    page = launched.page
    await clickMenuById(app, 'reviewTrackChangesMenuItem')
    await openReviewSidebar(page, app)
    await expect(
      page.locator('.side-bar-review').getByRole('switch')
    ).toHaveAttribute('aria-checked', 'true')
  })

  test.afterAll(async() => {
    if (app) await closeDocumentCore(app)
  })

  test('tracks every frozen interaction with exact undo', async() => {
    await selectDomText(page, 'Typing')
    await page.keyboard.type('W')
    await expectSource(
      page,
      SOURCE.replace('Typing', '{~~Typing~>W~~}')
    )
    await expectPublicSelection(page, {
      text: '',
      collapsed: true,
      anchorText: ' target.',
      anchorOffset: 0,
      focusText: ' target.',
      focusOffset: 0
    })
    await undoThroughApplicationMenu(app)
    await expectSource(page, SOURCE)
    await expectPublicSelection(page, {
      text: 'Typing',
      collapsed: false,
      anchorText: 'Typing target.',
      anchorOffset: 0,
      focusText: 'Typing target.',
      focusOffset: 'Typing'.length
    })

    await app.evaluate(({ clipboard }) => clipboard.writeText('Pasted'))
    await selectDomText(page, 'Paste')
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+V' : 'Control+V'
    )
    await expectSource(
      page,
      SOURCE.replace('Paste', '{~~Paste~>Pasted~~}')
    )
    await expectPublicSelection(page, {
      text: '',
      collapsed: true,
      anchorText: ' target.',
      anchorOffset: 0,
      focusText: ' target.',
      focusOffset: 0
    })
    await undoThroughApplicationMenu(app)
    await expectSource(page, SOURCE)
    await expectPublicSelection(page, {
      text: 'Paste',
      collapsed: false,
      anchorText: 'Paste target.',
      anchorOffset: 0,
      focusText: 'Paste target.',
      focusOffset: 'Paste'.length
    })

    await selectDomText(page, 'Compose')
    await commitComposition(page, '文')
    await expectSource(
      page,
      SOURCE.replace('Compose', '{~~Compose~>文~~}')
    )
    await expectPublicSelection(page, {
      text: '',
      collapsed: true,
      anchorText: ' target.',
      anchorOffset: 0,
      focusText: ' target.',
      focusOffset: 0
    })
    await undoThroughApplicationMenu(app)
    await expectSource(page, SOURCE)
    await expectPublicSelection(page, {
      text: 'Compose',
      collapsed: false,
      anchorText: 'Compose target.',
      anchorOffset: 0,
      focusText: 'Compose target.',
      focusOffset: 'Compose'.length
    })

    await selectDomText(page, 'Format')
    await expect.poll(() => reviewMenuEnabled(app, 'strongMenuItem')).toBe(true)
    await clickMenuById(app, 'strongMenuItem')
    await expectSource(
      page,
      SOURCE.replace('Format', '{++**++}Format{++**++}')
    )
    await expectPublicSelection(page, {
      text: 'Format',
      collapsed: false,
      anchorText: 'Format',
      anchorOffset: 0,
      focusText: 'Format',
      focusOffset: 'Format'.length
    })
    await undoThroughApplicationMenu(app)
    await expectSource(page, SOURCE)
    await expectPublicSelection(page, {
      text: 'Format',
      collapsed: false,
      anchorText: 'Format target.',
      anchorOffset: 0,
      focusText: 'Format target.',
      focusOffset: 'Format'.length
    })

    await placeCaretAfter(page, 'Structure')
    await expect.poll(() => reviewMenuEnabled(app, 'heading2MenuItem')).toBe(true)
    await clickMenuById(app, 'heading2MenuItem')
    await expectSource(
      page,
      SOURCE.replace(
        'Structure target.',
        '{--Structure target.--}{++## Structure target.++}'
      )
    )
    await expect.poll(() => readPublicSelection(page)).toMatchObject({
      text: '',
      collapsed: true,
      anchorText: '## Structure target.',
      anchorOffset: '## Structure target.'.length,
      focusText: '## Structure target.',
      focusOffset: '## Structure target.'.length,
      editorFocused: true
    })
    await undoThroughApplicationMenu(app)
    await expectSource(page, SOURCE)
    await expect.poll(() => readPublicSelection(page)).toMatchObject({
      text: 'Structure target.',
      collapsed: false,
      anchorText: 'Structure target.',
      anchorOffset: 0,
      focusText: 'Structure target.',
      focusOffset: 'Structure target.'.length,
      editorFocused: true
    })

    await selectDomText(page, 'old')
    await page.keyboard.type('X')
    await expectSource(page, SOURCE)
    await expect(page.locator('.editor-notifications')).toContainText(
      'read-only-change-arm'
    )
    await expectPublicSelection(page, {
      text: 'old',
      collapsed: false,
      anchorText: 'old ',
      anchorOffset: 0,
      focusText: 'old ',
      focusOffset: 'old'.length
    })
    await expect.poll(() => reviewMenuEnabled(app, 'editUndoMenuItem')).toBe(false)
    await expectSource(page, SOURCE)
  })
})

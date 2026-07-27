import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readCanonicalMarkdown } from './helpers'
import {
  closeDocumentCore,
  launchDocumentCoreWithKeybindings,
  openReviewSidebar,
  pointForText,
  pressApplicationMenuAccelerator,
  reviewMenuEnabled
} from './documentCoreReviewE2e'

const SOURCE = [
  'mouseword same paragraph end',
  '',
  'keyboardword same paragraph end',
  '',
  'mousecrossstart first mouse paragraph',
  '',
  'mousecrossend second mouse paragraph',
  '',
  'keyboardcrossstart first keyboard paragraph',
  '',
  'keyboardcrossend second keyboard paragraph',
  '',
  'complete {++nestedowner++} outside',
  '',
  'literal `literalowner` outside',
  '',
  'partial {++criticpartial++} outside',
  '',
  'cross {~~oldarm~>newarm~~} outside',
  '',
  'hiddenleft {>>secret<<} hiddenright',
  '',
  'literalbefore `partialliteral` after',
  '',
  'zero revised {--deletedonly--} end',
  '',
  'zero original {++addedonly++} end',
  '',
  '[sourceonly]: /destination',
  ''
].join('\n')

type TextEdge = 'start' | 'end'

const selectionText = (page: Page): Promise<string> =>
  page.evaluate(() => window.getSelection()?.toString() ?? '')

const settleSelection = async(page: Page): Promise<void> => {
  await page.waitForTimeout(220)
}

/**
 * Uses a DOM Range only as a read-only layout ruler. Selection itself is made
 * exclusively by Playwright's hardware-style mouse events.
 */
const textEdgePoint = async(
  page: Page,
  needle: string,
  edge: TextEdge
): Promise<Readonly<{ x: number; y: number }>> => {
  const point = await page.evaluate(({ text, requestedEdge }) => {
    const root = document.querySelector('.editor-component')
    if (root === null) return null
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const start = node.data.indexOf(text)
      if (start < 0) continue
      const character = requestedEdge === 'start'
        ? start
        : start + text.length - 1
      const ruler = document.createRange()
      ruler.setStart(node, character)
      ruler.setEnd(node, character + 1)
      const rect = ruler.getBoundingClientRect()
      return {
        x: requestedEdge === 'start' ? rect.left + 1 : rect.right - 1,
        y: rect.top + rect.height / 2
      }
    }
    return null
  }, { text: needle, requestedEdge: edge })
  if (point === null) {
    throw new Error(`Could not locate ${JSON.stringify(needle)} in the editor`)
  }
  return point
}

const doubleClickWord = async(page: Page, needle: string): Promise<string> => {
  const point = await pointForText(page, needle)
  await page.mouse.dblclick(point.x, point.y)
  await settleSelection(page)
  const selected = await selectionText(page)
  expect(selected).toBe(needle)
  return selected
}

const dragSelect = async(
  page: Page,
  startNeedle: string,
  endNeedle: string
): Promise<string> => {
  const start = await textEdgePoint(page, startNeedle, 'start')
  const end = await textEdgePoint(page, endNeedle, 'end')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 16 })
  await page.mouse.up()
  await settleSelection(page)
  const selected = await selectionText(page)
  expect(selected.startsWith(startNeedle)).toBe(true)
  expect(selected.endsWith(endNeedle)).toBe(true)
  return selected
}

const keyboardSelectFromLineStart = async(
  page: Page,
  lineNeedle: string,
  endNeedle: string,
  maximumUnits = 160
): Promise<string> => {
  const point = await pointForText(page, lineNeedle)
  await page.mouse.click(point.x, point.y)
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'
  )
  await expect.poll(() => selectionText(page)).toBe('')
  for (let unit = 0; unit < maximumUnits; unit += 1) {
    await page.keyboard.press('Shift+ArrowRight')
    const selected = await selectionText(page)
    if (selected.startsWith(lineNeedle) && selected.endsWith(endNeedle)) {
      await settleSelection(page)
      return selected
    }
  }
  throw new Error(
    `Keyboard selection from ${JSON.stringify(lineNeedle)} never reached ` +
    JSON.stringify(endNeedle)
  )
}

const expectMenu = async(
  app: ElectronApplication,
  id: string,
  enabled: boolean
): Promise<void> => {
  await expect.poll(() => reviewMenuEnabled(app, id)).toBe(enabled)
}

const addComment = async(
  page: Page,
  app: ElectronApplication,
  comment: string
): Promise<void> => {
  await expectMenu(app, 'reviewAddCommentMenuItem', true)
  await pressApplicationMenuAccelerator(
    page,
    app,
    'reviewAddCommentMenuItem'
  )
  const input = page.locator('.comment-compose-input')
  await expect(input).toBeVisible()
  await expect(input).toBeFocused()
  await input.fill(comment)
  await page.locator('.comment-compose-actions .submit').click()
  await expect(input).toBeHidden()
}

const undoThroughApplicationMenu = async(
  page: Page,
  app: ElectronApplication
): Promise<void> => {
  await expectMenu(app, 'editUndoMenuItem', true)
  await pressApplicationMenuAccelerator(page, app, 'editUndoMenuItem')
}

const expectOneStepUndo = async(
  page: Page,
  app: ElectronApplication,
  selected: string
): Promise<void> => {
  await undoThroughApplicationMenu(page, app)
  await expect.poll(() => readCanonicalMarkdown(page)).toBe(SOURCE)
  await expect.poll(() => selectionText(page)).toBe(selected)
  await expectMenu(app, 'editUndoMenuItem', false)
}

const commentCycle = async(
  page: Page,
  app: ElectronApplication,
  select: () => Promise<string>,
  selectedSource: string,
  comment: string
): Promise<void> => {
  const selected = await select()
  await addComment(page, app, comment)
  await expect.poll(() => readCanonicalMarkdown(page)).toBe(
    SOURCE.replace(
      selectedSource,
      `{==${selectedSource}==}{>>${comment}<<}`
    )
  )
  await expectOneStepUndo(page, app, selected)
}

const highlightCycle = async(
  page: Page,
  app: ElectronApplication,
  select: () => Promise<string>,
  selectedSource: string
): Promise<void> => {
  const selected = await select()
  await expectMenu(app, 'reviewHighlightMenuItem', true)
  await pressApplicationMenuAccelerator(
    page,
    app,
    'reviewHighlightMenuItem'
  )
  await expect.poll(() => readCanonicalMarkdown(page)).toBe(
    SOURCE.replace(selectedSource, `{==${selectedSource}==}`)
  )
  await expectOneStepUndo(page, app, selected)
}

const expectInvalidSelection = async(
  page: Page,
  app: ElectronApplication,
  select: () => Promise<string>,
  disabledMenuIds: readonly string[]
): Promise<void> => {
  await select()
  for (const menuId of disabledMenuIds) {
    await expectMenu(app, menuId, false)
  }
  await expect.poll(() => readCanonicalMarkdown(page)).toBe(SOURCE)
  await expectMenu(app, 'editUndoMenuItem', false)
}

test.describe('document-core Comment gesture validity', () => {
  test.describe.configure({ timeout: 120000 })
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchDocumentCoreWithKeybindings(SOURCE, {
      'review.add-comment': 'CmdOrCtrl+Alt+Shift+C',
      'review.highlight': 'CmdOrCtrl+Alt+Shift+H'
    })
    app = launched.app
    page = launched.page
    await openReviewSidebar(page, app)
  })

  test.afterAll(async() => {
    if (app) await closeDocumentCore(app)
  })

  test('accepts complete targets and rejects every invalid target', async() => {
    // Same paragraph × mouse.
    await commentCycle(
      page,
      app,
      () => doubleClickWord(page, 'mouseword'),
      'mouseword',
      'same mouse'
    )

    // Same paragraph × keyboard.
    await commentCycle(
      page,
      app,
      () => keyboardSelectFromLineStart(
        page,
        'keyboardword',
        'keyboardword'
      ),
      'keyboardword',
      'same keyboard'
    )

    // Cross paragraph × mouse.
    const mouseCrossSource = [
      'mousecrossstart first mouse paragraph',
      '',
      'mousecrossend'
    ].join('\n')
    await commentCycle(
      page,
      app,
      () => dragSelect(page, 'mousecrossstart', 'mousecrossend'),
      mouseCrossSource,
      'cross mouse'
    )

    // Cross paragraph × keyboard.
    const keyboardCrossSource = [
      'keyboardcrossstart first keyboard paragraph',
      '',
      'keyboardcrossend'
    ].join('\n')
    await commentCycle(
      page,
      app,
      () => keyboardSelectFromLineStart(
        page,
        'keyboardcrossstart',
        'keyboardcrossend'
      ),
      keyboardCrossSource,
      'cross keyboard'
    )

    // A complete visible CriticMarkup owner widens to its delimiters for both
    // Comment and Highlight authoring.
    await commentCycle(
      page,
      app,
      () => doubleClickWord(page, 'nestedowner'),
      '{++nestedowner++}',
      'nested note'
    )
    await highlightCycle(
      page,
      app,
      () => doubleClickWord(page, 'nestedowner'),
      '{++nestedowner++}'
    )

    // A complete visible Markdown-literal contribution likewise widens to the
    // parser-owned literal, retaining its delimiters as opaque source.
    await commentCycle(
      page,
      app,
      () => doubleClickWord(page, 'literalowner'),
      '`literalowner`',
      'literal note'
    )
    await highlightCycle(
      page,
      app,
      () => doubleClickWord(page, 'literalowner'),
      '`literalowner`'
    )

    // Collapsed target.
    await expectInvalidSelection(
      page,
      app,
      async() => {
        const point = await pointForText(page, 'mouseword')
        await page.mouse.click(point.x, point.y)
        await settleSelection(page)
        await expect.poll(() => selectionText(page)).toBe('')
        return ''
      },
      [
        'reviewMarkAdditionMenuItem',
        'reviewMarkDeletionMenuItem',
        'reviewSuggestReplacementMenuItem',
        'reviewHighlightMenuItem',
        'reviewAddCommentMenuItem'
      ]
    )

    // A visible range spanning an elided Comment is invalid even though both
    // endpoints themselves are editable.
    await expectInvalidSelection(
      page,
      app,
      () => dragSelect(page, 'hiddenleft', 'hiddenright'),
      ['reviewAddCommentMenuItem', 'reviewHighlightMenuItem']
    )

    // Partial CriticMarkup owner.
    await expectInvalidSelection(
      page,
      app,
      () => dragSelect(page, 'riticpartial', 'outside'),
      ['reviewAddCommentMenuItem', 'reviewHighlightMenuItem']
    )

    // Crossing the old/new arms of a Substitution without selecting the
    // complete owner.
    await expectInvalidSelection(
      page,
      app,
      () => dragSelect(page, 'ldarm', 'newa'),
      ['reviewAddCommentMenuItem', 'reviewHighlightMenuItem']
    )

    // Strictly inside a literal.
    await expectInvalidSelection(
      page,
      app,
      async() => {
        await doubleClickWord(page, 'partialliteral')
        await page.keyboard.press('ArrowRight')
        for (let unit = 0; unit < 4; unit += 1) {
          await page.keyboard.press('Shift+ArrowLeft')
        }
        await settleSelection(page)
        const selected = await selectionText(page)
        expect(selected).toBe('eral')
        return selected
      },
      ['reviewAddCommentMenuItem', 'reviewHighlightMenuItem']
    )

    // Partly outside and partly inside a literal.
    await expectInvalidSelection(
      page,
      app,
      () => dragSelect(page, 'literalbefore', 'part'),
      ['reviewAddCommentMenuItem', 'reviewHighlightMenuItem']
    )

    // The selected Deletion has no root-Revised contribution, so Comment and
    // Addition are disabled while Highlight remains a legal carrier.
    await expectInvalidSelection(
      page,
      app,
      () => doubleClickWord(page, 'deletedonly'),
      ['reviewAddCommentMenuItem', 'reviewMarkAdditionMenuItem']
    )
    await expectMenu(app, 'reviewHighlightMenuItem', true)

    // The selected Addition has no root-Original contribution, so Deletion and
    // Substitution are disabled while Comment remains legal.
    await expectInvalidSelection(
      page,
      app,
      () => doubleClickWord(page, 'addedonly'),
      ['reviewMarkDeletionMenuItem', 'reviewSuggestReplacementMenuItem']
    )
    await expectMenu(app, 'reviewAddCommentMenuItem', true)

    // Source-only Definition ownership produces no selectable markup target.
    // A real click cannot expose or authorize its hidden destination.
    await expect(
      page.locator('.editor-component')
    ).not.toContainText('/destination')
    await expect.poll(() => readCanonicalMarkdown(page)).toBe(SOURCE)
    await expectMenu(app, 'editUndoMenuItem', false)
  })
})

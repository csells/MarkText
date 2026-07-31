import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeDocumentCore,
  expectCanonicalOnDisk as expectCanonicalOnDiskShared,
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

// Selection settlement is observed, never slept for: the DOM selection is
// polled to the expected text, and the menu-state polls that follow every
// gesture observe the session's capability snapshot settling.
const settleSelection = async(
  page: Page,
  expected: string
): Promise<void> => {
  await expect.poll(() => selectionText(page)).toBe(expected)
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
  // A previous step's publication repaint can reflow the word between point
  // computation and the click — a pre-click hit-test cannot close that gap
  // (the layout can shift after any check). The observable condition is the
  // click's outcome: recompute and re-click until the selection reads the
  // word, exactly as a user re-aims after the page moves under them.
  await expect.poll(async() => {
    const point = await pointForText(page, needle)
    await page.mouse.dblclick(point.x, point.y)
    return selectionText(page)
  }).toBe(needle)
  return needle
}

const dragEdgePoints = async(
  page: Page,
  startNeedle: string,
  endNeedle: string
): Promise<Readonly<{
  start: Readonly<{ x: number; y: number }>
  end: Readonly<{ x: number; y: number }>
}>> => {
  const points = await page.evaluate(({ startText, endText }) => {
    const root = document.querySelector('.editor-component')
    if (root === null) return null
    const edgePoint = (
      node: Text,
      index: number,
      requestedEdge: 'start' | 'end'
    ): Readonly<{ x: number; y: number }> => {
      const ruler = document.createRange()
      ruler.setStart(node, index)
      ruler.setEnd(node, index + 1)
      const rect = ruler.getBoundingClientRect()
      return {
        x: requestedEdge === 'start' ? rect.left + 1 : rect.right - 1,
        y: rect.top + rect.height / 2
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const startIndex = node.data.indexOf(startText)
      if (startIndex < 0) continue
      const start = edgePoint(node, startIndex, 'start')
      // Continue the same walk: the end needle is at or after the start node.
      const sameNode = node.data.indexOf(endText, startIndex)
      if (sameNode >= 0) {
        return { start, end: edgePoint(node, sameNode + endText.length - 1, 'end') }
      }
      while (walker.nextNode()) {
        const later = walker.currentNode as Text
        const endIndex = later.data.indexOf(endText)
        if (endIndex < 0) continue
        return { start, end: edgePoint(later, endIndex + endText.length - 1, 'end') }
      }
      return null
    }
    return null
  }, { startText: startNeedle, endText: endNeedle })
  if (points === null) {
    throw new Error(
      `Could not locate ${JSON.stringify(startNeedle)} followed by ` +
        `${JSON.stringify(endNeedle)} in the editor`
    )
  }
  return points
}

const dragSelect = async(
  page: Page,
  startNeedle: string,
  endNeedle: string
): Promise<string> => {
  // A drag is forward by construction, so the end needle is resolved from the
  // start needle's node onward. Resolving it globally picks the document's
  // first occurrence, which may precede the start and invert the gesture.
  const { start, end } = await dragEdgePoints(page, startNeedle, endNeedle)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 16 })
  await page.mouse.up()
  await expect.poll(async() => {
    const selected = await selectionText(page)
    return selected.startsWith(startNeedle) && selected.endsWith(endNeedle)
  }).toBe(true)
  return selectionText(page)
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
      await settleSelection(page, selected)
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

let activeDocumentPath = ''

const expectCanonicalOnDisk = (
  page: Page,
  app: ElectronApplication,
  expected: string
): Promise<void> =>
  expectCanonicalOnDiskShared(page, app, activeDocumentPath, expected)

const expectOneStepUndo = async(
  page: Page,
  app: ElectronApplication,
  selected: string
): Promise<void> => {
  await undoThroughApplicationMenu(page, app)
  await expectCanonicalOnDisk(page, app, SOURCE)
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
  await expectCanonicalOnDisk(
    page,
    app,
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
  await expectCanonicalOnDisk(
    page,
    app,
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
  await expectCanonicalOnDisk(page, app, SOURCE)
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
    activeDocumentPath = launched.filePath
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
    console.log(`[test] collapsed case begins t=${Date.now()}`)
    await expectInvalidSelection(
      page,
      app,
      async() => {
        const point = await pointForText(page, 'mouseword')
        await page.mouse.click(point.x, point.y)
        await settleSelection(page, '')
        return ''
      },
      [
        'reviewMarkAdditionMenuItem',
        'reviewMarkDeletionMenuItem',
        'reviewSuggestReplacementMenuItem',
        'reviewHighlightMenuItem'
      ]
    )
    // A collapsed caret authors the standalone Comment (G36): Add Comment
    // stays available while every range-authoring command is rejected.
    await expectMenu(app, 'reviewAddCommentMenuItem', true)

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
        // The prior case's range selection floats the inline critic tool over
        // this word's geometry; a real collapsing click elsewhere dismisses
        // it before the double-click, exactly as a user would.
        const neutral = await pointForText(page, 'mouseword')
        await page.mouse.click(neutral.x, neutral.y)
        await settleSelection(page, '')
        await doubleClickWord(page, 'partialliteral')
        await page.keyboard.press('ArrowRight')
        for (let unit = 0; unit < 4; unit += 1) {
          await page.keyboard.press('Shift+ArrowLeft')
        }
        await settleSelection(page, 'eral')
        return 'eral'
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
    await expectCanonicalOnDisk(page, app, SOURCE)
    await expectMenu(app, 'editUndoMenuItem', false)
  })
})

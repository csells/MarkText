import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import { CRITIC_MARKUP_CORPUS } from '../../../muya/src/criticMarkup/__tests__/sharedCorpus'
import {
  clearCapturedErrors,
  clearRendererErrors,
  clickMenuById,
  enterSourceMode,
  exitSourceMode,
  expectNoCapturedErrors,
  expectNoRendererErrors,
  focusEditor,
  launchWithDoc,
  launchWithMarkdown,
  readCanonicalMarkdown,
  sendIpcToRenderer
} from './helpers'

const selectWord = async(page: Page, word: string): Promise<void> => {
  const point = await page.evaluate((needle) => {
    const root = document.querySelector('.editor-component')
    if (!root) return null
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const text = walker.currentNode as Text
      const index = text.textContent?.indexOf(needle) ?? -1
      if (index >= 0) {
        const range = document.createRange()
        range.setStart(text, index)
        range.setEnd(text, index + needle.length)
        const rect = range.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      }
    }
    return null
  }, word)

  if (!point) throw new TypeError(`Could not locate ${JSON.stringify(word)} in the editor.`)
  await page.mouse.dblclick(point.x, point.y)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(word)
  // Muya commits the browser selection into its model on requestAnimationFrame.
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

const placeCaretInWord = async(
  page: Page,
  needle: string,
  offset: number
): Promise<void> => {
  const placed = await page.evaluate(({ text: target, characterOffset }) => {
    const root = document.querySelector('.editor-component') as HTMLElement | null
    if (!root) return false
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const text = walker.currentNode as Text
      const index = text.textContent?.indexOf(target) ?? -1
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(text, index + characterOffset)
      range.collapse(true)
      const selection = window.getSelection()
      if (!selection) return false
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      root.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true
      }))
      return true
    }
    return false
  }, { text: needle, characterOffset: offset })
  if (!placed) {
    throw new TypeError(`Could not place a caret in ${JSON.stringify(needle)}.`)
  }
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

const selectionIsInsideHiddenComment = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const selection = window.getSelection()
    const selector = [
      '.mu-critic-comment',
      '[hidden][data-critic-type~="comment"]'
    ].join(', ')
    const inside = (node: Node | null): boolean => {
      const element = node?.nodeType === Node.ELEMENT_NODE
        ? node as Element
        : node?.parentElement
      return Boolean(element?.closest(selector))
    }
    return inside(selection?.anchorNode ?? null) || inside(selection?.focusNode ?? null)
  })

const sourceMarkdown = (page: Page): Promise<string> => page.evaluate(() => {
  const element = document.querySelector('.source-code .CodeMirror') as
    | (Element & { CodeMirror?: { getValue: () => string } })
    | null
  if (!element?.CodeMirror) throw new TypeError('Source CodeMirror instance is unavailable.')
  return element.CodeMirror.getValue()
})

const menuEnabled = (app: ElectronApplication, id: string): Promise<boolean | null> =>
  app.evaluate(({ Menu }, menuId) => Menu.getApplicationMenu()?.getMenuItemById(menuId)?.enabled ?? null, id)

const menuChecked = (app: ElectronApplication, id: string): Promise<boolean | null> =>
  app.evaluate(({ Menu }, menuId) => Menu.getApplicationMenu()?.getMenuItemById(menuId)?.checked ?? null, id)

const readClipboard = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ clipboard }) => clipboard.readText())

const writeClipboard = (app: ElectronApplication, text: string): Promise<void> =>
  app.evaluate(({ clipboard }, value) => {
    clipboard.writeText(value)
  }, text)

const copySelection = async(app: ElectronApplication, expected: string): Promise<void> => {
  const sentinel = `critic-copy-sentinel-${Date.now()}`
  await writeClipboard(app, sentinel)
  await expect.poll(() => readClipboard(app)).toBe(sentinel)

  // Exercise Electron's real native copy command without focusing or presenting
  // the hidden background-test window. Muya owns the resulting DOM copy event
  // and writes the active Critic projection into the OS clipboard.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new TypeError('No editor window is available for native copy.')
    win.webContents.copy()
  })

  await expect.poll(() => readClipboard(app), { timeout: 8000 }).toBe(expected)
}

const undo = (app: ElectronApplication): Promise<void> =>
  sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')

const redo = (app: ElectronApplication): Promise<void> =>
  sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')

const WORD_COUNT_TEXT = '.word-count .text-center-vertical'

const wordCounterValue = async(page: Page): Promise<number> => {
  const text = await page.locator(WORD_COUNT_TEXT).innerText()
  const match = text.trim().match(/(\d+)\s*$/)
  return match ? Number(match[1]) : NaN
}

const canonicalWordCount = (markdown: string): number => {
  const removedChinese = markdown.replace(/[\u4E00-\u9FA5]/g, '')
  const tokens = removedChinese.split(/\s+/).filter((token) => token)
  return markdown.length - removedChinese.length + tokens.length
}

const selectParagraphContaining = async(page: Page, needle: string): Promise<string> => {
  const selected = await page.evaluate((text) => {
    const root = document.querySelector('.editor-component') as HTMLElement | null
    if (!root) return null
    const paragraph = [...root.querySelectorAll<HTMLElement>('.mu-paragraph-content')]
      .find((candidate) => candidate.textContent?.includes(text))
    if (!paragraph) return null

    root.focus()
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()
    if (!selection) return null
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    root.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true
    }))
    return selection.toString()
  }, needle)

  if (selected === null) {
    throw new TypeError(`Could not select the paragraph containing ${JSON.stringify(needle)}.`)
  }
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  return selected
}

const callEditorStoreAction = (page: Page, action: string): Promise<boolean> =>
  page.evaluate((actionName) => {
    const root = document.querySelector('#app') as
      | (Element & { __vue_app__?: { config?: { globalProperties?: Record<string, unknown> } } })
      | null
    const pinia = root?.__vue_app__?.config?.globalProperties?.$pinia as
      | { _s?: Map<string, Record<string, (...args: unknown[]) => unknown>> }
      | undefined
    const store = pinia?._s?.get('editor')
    if (!store || typeof store[actionName] !== 'function') return false
    store[actionName]()
    return true
  }, action)

const openReviewSidebar = async(page: Page, app: ElectronApplication): Promise<void> => {
  const sideBar = page.locator('.side-bar')
  if (!(await sideBar.isVisible())) {
    await clickMenuById(app, 'sideBarMenuItem')
    await expect(sideBar).toBeVisible()
  }
  await page.locator('.side-bar .left-column li[title="Review"]').click()
  await expect(page.locator('.side-bar-review')).toBeVisible()
}

test.describe('native CriticMarkup Review workflow', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('alpha plain omega\n')
    app = launched.app
    page = launched.page
    await focusEditor(page)
    await clearRendererErrors(app)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('authors pure markers, projects them, and restores Review after source mode', async() => {
    await selectWord(page, 'plain')
    await expect.poll(() => menuEnabled(app, 'reviewMarkDeletionMenuItem')).toBe(true)
    await clickMenuById(app, 'reviewMarkDeletionMenuItem')
    const deletion = page.locator('.mu-critic-deletion del')
    await expect(deletion).toContainText('plain')

    await clickMenuById(app, 'reviewShowRevisedMenuItem')
    await expect(deletion).toHaveCount(0)
    await expect(page.locator('.editor-component')).not.toContainText('plain')
    await expect.poll(() => menuEnabled(app, 'reviewNextMenuItem')).toBe(false)
    await expect.poll(() => menuEnabled(app, 'reviewAcceptAllMenuItem')).toBe(true)

    await enterSourceMode(page, app)
    await expect.poll(() => sourceMarkdown(page)).toContain('{--plain--}')
    await expect.poll(() => menuEnabled(app, 'reviewDisplayMenuItem')).toBe(false)

    await exitSourceMode(page, app)
    await expect.poll(() => menuEnabled(app, 'reviewDisplayMenuItem')).toBe(true)
    await clickMenuById(app, 'reviewShowMarkedMenuItem')

    await selectWord(page, 'omega')
    await expect.poll(() => menuEnabled(app, 'reviewAddCommentMenuItem')).toBe(true)
    await clickMenuById(app, 'reviewAddCommentMenuItem')
    const composeBox = page.locator('.comment-compose-input')
    await expect(composeBox).toBeVisible()
    await composeBox.fill('review note')
    await page.locator('.comment-compose-actions .submit').click()
    await expect(composeBox).toBeHidden()
    await expect.poll(() => page.evaluate(() =>
      document.activeElement?.classList.contains('editor-component') ?? false)).toBe(true)

    await enterSourceMode(page, app)
    await expect.poll(() => sourceMarkdown(page)).toContain('{==omega==}{>>review note<<}')
    await expectNoRendererErrors(app)
  })
})

test.describe('CriticMarkup Review lifecycle isolation', () => {
  test('cancels a pending prompt instead of applying it to a newly selected tab', async() => {
    const { app, page } = await launchWithMarkdown('alpha target zone\n')
    try {
      await focusEditor(page)
      await clearRendererErrors(app)
      await selectWord(page, 'target')
      await expect.poll(() => menuEnabled(app, 'reviewAddCommentMenuItem')).toBe(true)
      await clickMenuById(app, 'reviewAddCommentMenuItem')
      const composeBox = page.locator('.comment-compose-input')
      await expect(composeBox).toBeVisible()
      await composeBox.fill('cross tab note')

      await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'beta landing zone\n')
      await expect(page.locator('.tabs-container > li')).toHaveCount(2)
      await expect(page.locator('.editor-component')).toContainText('beta landing zone')
      await expect(composeBox).toBeHidden()

      await enterSourceMode(page, app)
      await expect.poll(async() => (await sourceMarkdown(page)).trim()).toBe('beta landing zone')
      await exitSourceMode(page, app)
      await sendIpcToRenderer(app, 'mt::switch-tab-by-index', 0)
      await expect(page.locator('.editor-component')).toContainText('alpha target zone')
      await enterSourceMode(page, app)
      await expect.poll(async() => (await sourceMarkdown(page)).trim()).toBe('alpha target zone')
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })

  test('disables Review after the final document closes', async() => {
    const { app, page } = await launchWithMarkdown('only document\n')
    try {
      await expect.poll(() => menuEnabled(app, 'reviewDisplayMenuItem')).toBe(true)
      expect(await callEditorStoreAction(page, 'CLOSE_ALL_TABS')).toBe(true)
      await expect(page.locator('.editor-component')).toHaveCount(0)

      for (const id of [
        'reviewMarkAdditionMenuItem',
        'reviewNextMenuItem',
        'reviewAcceptAllMenuItem',
        'reviewDisplayMenuItem'
      ]) {
        await expect.poll(() => menuEnabled(app, id)).toBe(false)
      }
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
})

test.describe('CriticMarkup Review sidebar', () => {
  test('lists native items and routes projection, focus, resolution, and source-mode state', async() => {
    const markdown = [
      '{++new++}',
      '{--old--}',
      '{~~before~>after~~}',
      '{==spot==}',
      '{>>note<<}'
    ].join(' ')
    const { app, page } = await launchWithMarkdown(`${markdown}\n`)

    try {
      await openReviewSidebar(page, app)
      const cards = page.locator('.review-card')
      await expect(cards).toHaveCount(5)
      await expect(cards.locator('.type-label')).toHaveText([
        'Addition',
        'Deletion',
        'Substitution',
        'Highlight',
        'Comment'
      ])

      await page.locator('.projection-picker button').filter({ hasText: 'Revised' }).click()
      await expect(page.locator('.editor-component')).toHaveAttribute(
        'data-critic-projection',
        'revised'
      )

      await page.locator('.review-card.type-addition .card-actions .accept').click()
      await expect(cards).toHaveCount(4)
      await expect(page.locator('.editor-component')).toHaveAttribute(
        'data-critic-projection',
        'marked'
      )

      await page.locator('.review-card.type-deletion .card-head').click()
      await expect(page.locator('.review-card.type-deletion')).toHaveClass(/active/)

      await enterSourceMode(page, app)
      await expect(page.locator('.side-bar-review .empty')).toContainText(
        'Review is unavailable'
      )
      await expect.poll(() => sourceMarkdown(page)).not.toContain('{++new++}')
      await expect.poll(() => sourceMarkdown(page)).toContain('new')

      await exitSourceMode(page, app)
      await expect(cards).toHaveCount(4)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })

  test('folds, edits, rejects, saves, and removes an anchored comment', async() => {
    const opaqueLiteral = '`<<\\}`'
    const preface = Array.from(
      { length: 24 },
      (_, index) => `{++preface ${index}++}`
    ).join('\n\n')
    const original = `${preface}\n\n{==reviewed==}{>>outer ${opaqueLiteral} tail<<}\n`
    const edited = original.replace(
      `{>>outer ${opaqueLiteral} tail<<}`,
      `{>>edited ${opaqueLiteral} note<<}`
    )
    const removed = `${preface}\n\nreviewed\n`
    const { app, page } = await launchWithMarkdown(original)

    try {
      await focusEditor(page)
      await clearRendererErrors(app)
      await openReviewSidebar(page, app)

      const commentCard = page.locator('.review-card.type-comment')
      await expect(commentCard).toHaveCount(1)
      await expect(page.locator('.review-card.type-highlight')).toHaveCount(0)
      await expect(commentCard.locator('.comment-anchor')).toHaveText('reviewed')
      await expect(page.locator('.mu-critic-comment-text')).toBeHidden()
      await expect(page.locator('.mu-critic-comment-indicator')).toBeVisible()

      const sideBar = page.locator('.side-bar-review')
      const scrollTop = await sideBar.evaluate((element) => {
        element.scrollTop = 120
        return element.scrollTop
      })
      expect(scrollTop).toBeGreaterThan(0)
      await placeCaretInWord(page, 'reviewed', 3)
      await expect(commentCard).toHaveClass(/active/)
      await expect(commentCard.locator('.comment-edit')).toHaveCount(0)
      expect(await sideBar.evaluate((element) => element.scrollTop)).toBe(scrollTop)

      await commentCard.locator('.review-card-focus').click()
      const editor = commentCard.locator('.comment-edit textarea')
      await expect(editor).toHaveValue(`outer ${opaqueLiteral} tail`)
      const rejected = `outer ${opaqueLiteral} ${opaqueLiteral} tail`
      await editor.fill(rejected)
      await commentCard.locator('.comment-edit .submit').click()
      await expect(commentCard.locator('.comment-edit-failure')).toBeVisible()
      await expect(editor).toHaveValue(rejected)
      expect(await readCanonicalMarkdown(page)).toBe(original)

      await editor.fill(`edited ${opaqueLiteral} note`)
      await commentCard.locator('.comment-edit .submit').click()
      await expect(commentCard.locator('.comment-edit')).toHaveCount(0)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(edited)
      await expect(commentCard.locator('.comment-anchor')).toHaveText('reviewed')

      await undo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(original)
      await redo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(edited)

      await commentCard.getByRole('button', { name: 'Remove comment' }).click()
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(removed)
      await undo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(edited)
      await redo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(removed)
      await expectNoCapturedErrors(app)
    } finally {
      await app.close()
    }
  })

  test('escapes a hidden caret and preserves a deleted anchor as a point comment', async() => {
    const original = 'before {==target==}{>>note<<} after\n'
    const point = 'before {>>note<<} after\n'
    const { app, page } = await launchWithMarkdown(original)

    try {
      await focusEditor(page)
      await clearRendererErrors(app)
      const placed = await page.evaluate(() => {
        const hidden = document.querySelector('.mu-critic-comment-text')
        const text = hidden?.firstChild
        if (!text || text.nodeType !== Node.TEXT_NODE) return false
        const selection = window.getSelection()
        if (!selection) return false
        const range = document.createRange()
        range.setStart(text, Math.min(1, text.textContent?.length ?? 0))
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        return true
      })
      expect(placed).toBe(true)
      await expect.poll(() => selectionIsInsideHiddenComment(page)).toBe(false)
      expect(await readCanonicalMarkdown(page)).toBe(original)

      await selectWord(page, 'target')
      await page.keyboard.press('Backspace')
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(point)

      await openReviewSidebar(page, app)
      const commentCard = page.locator('.review-card.type-comment')
      await expect(commentCard).toHaveCount(1)
      await expect(commentCard.locator('.comment-anchor')).toHaveCount(0)

      await undo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(original)
      await redo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(point)
      await commentCard.getByRole('button', { name: 'Remove comment' }).click()
      await expect.poll(() => readCanonicalMarkdown(page)).toBe('before  after\n')
      await expectNoCapturedErrors(app)
    } finally {
      await app.close()
    }
  })
})

const FILE_CORPUS_ROW_IDS = [
  'all-five-canonical-forms',
  'mixed-nested-forms',
  'escaped-opener-and-closer-like-payload',
  'block-spanning-addition',
  'inline-fenced-and-indented-code-contexts',
  'nested-block-spanning-addition-and-deletion'
] as const

// The concatenated document below can only host rows that are byte-canonical
// under the desktop's boot profile: a BOM/front-matter row must sit at the
// exact start of a file, an options row would change the parse of its
// neighbours, and a malformed dangling opener would capture `++}` closers
// from later rows. Those plan-minimum rows are file-backed one row per real
// file in the `CriticMarkup file-backed corpus rows` suite further down.
const fileCorpusRows = FILE_CORPUS_ROW_IDS.map((id) => {
  const row = CRITIC_MARKUP_CORPUS.find((candidate) => candidate.id === id)
  if (!row) throw new TypeError(`Shared CriticMarkup corpus row is missing: ${id}`)
  if (row.normalization.kind !== 'exact' || Object.keys(row.options).length > 0) {
    throw new TypeError(`File-backed corpus row must be exact with default options: ${id}`)
  }
  return row
})

const FILE_LOSSLESS_CORPUS = [
  '# Critic persistence',
  '',
  fileCorpusRows.map((row) => row.source).join('\n').trimEnd(),
  '',
  'Alpha {++added++}, {--removed--}, and {~~before~>after~~}.',
  '',
  '{==focus==}{>>note<<}',
  '',
  'Review target: reviewable token.',
  '',
  '`{++literal-code++}` and [link](https://example.test/{--literal-url--}).',
  '',
  'Astral 😀 tail.',
  ''
].join('\n')

const saveFileExactly = async(
  app: ElectronApplication,
  page: Page,
  filePath: string,
  expected: string
): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => fs.readFileSync(filePath, 'utf-8'), { timeout: 5000 }).toBe(expected)
  await expect.poll(() => readCanonicalMarkdown(page), { timeout: 5000 }).toBe(expected)
}

test.describe('CriticMarkup file-backed losslessness', () => {
  test('survives exact source handoff, projected copy, undo/redo, repeated save, and reopen', async() => {
    const initial = await launchWithMarkdown(FILE_LOSSLESS_CORPUS)
    let app = initial.app
    let page = initial.page
    const { filePath } = initial

    const reopen = async(): Promise<void> => {
      await expectNoCapturedErrors(app)
      await app.close()
      const next = await launchWithDoc(filePath)
      app = next.app
      page = next.page
      await clearCapturedErrors(app)
    }

    try {
      await clearCapturedErrors(app)
      expect(await page.evaluate(() => ({
        frozen: Object.isFrozen(window.__marktextE2EReadOnly),
        surface: Object.keys(window.__marktextE2EReadOnly ?? {})
      }))).toEqual({ frozen: true, surface: ['readCanonicalMarkdown'] })

      // This corpus is already in the desktop serializer's canonical form, so
      // its allowed-normalization set is empty: every comparison below is an
      // exact UTF-8 string comparison, including the final newline and astral
      // character. The bridge reads Muya directly and fails if source mode is
      // present before or after the call.
      expect(await readCanonicalMarkdown(page)).toBe(FILE_LOSSLESS_CORPUS)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(FILE_LOSSLESS_CORPUS)

      // A no-op WYSIWYG -> source -> WYSIWYG handoff must preserve every byte.
      // Check both CodeMirror's value and the canonical engine/file snapshots so
      // entering source mode cannot accidentally become the assertion mechanism.
      await enterSourceMode(page, app)
      expect(await sourceMarkdown(page)).toBe(FILE_LOSSLESS_CORPUS)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(FILE_LOSSLESS_CORPUS)
      await exitSourceMode(page, app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(FILE_LOSSLESS_CORPUS)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(FILE_LOSSLESS_CORPUS)

      // The desktop counter follows the documented canonical-source policy; a
      // display projection must not silently count only visible accepted text.
      await expect(page.locator(WORD_COUNT_TEXT)).toBeVisible({ timeout: 5000 })
      await expect.poll(() => page.locator(WORD_COUNT_TEXT).innerText()).toMatch(/^W\s/)
      await expect.poll(() => wordCounterValue(page)).toBe(
        canonicalWordCount(FILE_LOSSLESS_CORPUS)
      )

      const markedParagraph = 'Alpha {++added++}, {--removed--}, and {~~before~>after~~}.'
      expect(await selectParagraphContaining(page, 'Alpha')).toBe(markedParagraph)
      await copySelection(app, markedParagraph)
      expect(await readCanonicalMarkdown(page)).toBe(FILE_LOSSLESS_CORPUS)

      await clickMenuById(app, 'reviewShowRevisedMenuItem')
      await expect(page.locator('.editor-component')).toHaveAttribute(
        'data-critic-projection',
        'revised'
      )
      const revisedParagraph = 'Alpha added, , and after.'
      expect(await selectParagraphContaining(page, 'Alpha')).toBe(revisedParagraph)
      await copySelection(app, revisedParagraph)
      expect(await readCanonicalMarkdown(page)).toBe(FILE_LOSSLESS_CORPUS)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(FILE_LOSSLESS_CORPUS)
      await expect.poll(() => wordCounterValue(page)).toBe(
        canonicalWordCount(FILE_LOSSLESS_CORPUS)
      )

      await clickMenuById(app, 'reviewShowOriginalMenuItem')
      await expect(page.locator('.editor-component')).toHaveAttribute(
        'data-critic-projection',
        'original'
      )
      const originalParagraph = 'Alpha , removed, and before.'
      expect(await selectParagraphContaining(page, 'Alpha')).toBe(originalParagraph)
      await copySelection(app, originalParagraph)
      expect(await readCanonicalMarkdown(page)).toBe(FILE_LOSSLESS_CORPUS)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(FILE_LOSSLESS_CORPUS)
      await expect.poll(() => wordCounterValue(page)).toBe(
        canonicalWordCount(FILE_LOSSLESS_CORPUS)
      )

      await clickMenuById(app, 'reviewShowMarkedMenuItem')
      await expect(page.locator('.editor-component')).toHaveAttribute(
        'data-critic-projection',
        'marked'
      )

      await saveFileExactly(app, page, filePath, FILE_LOSSLESS_CORPUS)
      await saveFileExactly(app, page, filePath, FILE_LOSSLESS_CORPUS)
      await reopen()
      expect(await readCanonicalMarkdown(page)).toBe(FILE_LOSSLESS_CORPUS)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(FILE_LOSSLESS_CORPUS)

      await focusEditor(page)
      await selectWord(page, 'reviewable')
      await expect.poll(() => menuEnabled(app, 'reviewMarkDeletionMenuItem')).toBe(true)
      await clickMenuById(app, 'reviewMarkDeletionMenuItem')
      const marked = FILE_LOSSLESS_CORPUS.replace('reviewable', '{--reviewable--}')
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(marked)

      // Authoring is one durable history boundary in the real desktop route.
      await undo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(FILE_LOSSLESS_CORPUS)
      await redo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(marked)

      await saveFileExactly(app, page, filePath, marked)
      await reopen()
      expect(await readCanonicalMarkdown(page)).toBe(marked)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(marked)

      await openReviewSidebar(page, app)
      const authoredCard = page.locator('.review-card').filter({ hasText: 'reviewable' })
      await expect(authoredCard).toHaveCount(1)
      await authoredCard.locator('.card-actions button').nth(1).click()
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(FILE_LOSSLESS_CORPUS)

      // Targeted resolution is independently undoable and redoable after a real
      // file reopen; neither direction may lose the exact pending annotation.
      await undo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(marked)
      await expect(authoredCard).toHaveCount(1)
      await redo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(FILE_LOSSLESS_CORPUS)
      await expect(authoredCard).toHaveCount(0)

      await saveFileExactly(app, page, filePath, FILE_LOSSLESS_CORPUS)
      await reopen()
      expect(await readCanonicalMarkdown(page)).toBe(FILE_LOSSLESS_CORPUS)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(FILE_LOSSLESS_CORPUS)
      await expectNoCapturedErrors(app)
    } finally {
      await app.close().catch(() => undefined)
    }
  })
})

// ----------------------------------------------------------------------------
// Per-row file-backed coverage for the plan-minimum corpus rows that cannot
// join the concatenated FILE_LOSSLESS_CORPUS document: byte classes that must
// occupy the exact start/end of a real file (BOM, CRLF, front matter), rows
// whose declared parser options differ from the desktop defaults, and
// malformed recovery (a dangling opener would capture closers from later
// rows). Each row is written to its own real file and driven through open,
// Review item enumeration, repeated explicit save, and reopen with byte-exact
// file reads at every step.
// ----------------------------------------------------------------------------

// The desktop open boundary (main-process `loadMarkdownFile`) decodes away a
// UTF-8 BOM and canonicalizes every line ending to LF before the engine sees
// the text, while recording `encoding.isBom` / `lineEnding` so the save path
// re-emits the original bytes. This pair is the documented desktop-level
// normalization the per-row assertions encode: the in-editor canonical text is
// the LF form, the persisted artifact stays byte-identical to the source.
const desktopOpenNormalization = (source: string): string =>
  source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')

interface FileRowCaseDefinition {
  id: string
  /**
   * Desktop-settable subset of the row's declared parser options, applied via
   * the real `mt::set-user-preference` round trip before any assertion.
   * `frontMatter` and `math` have no desktop preference — the renderer always
   * boots the engine defaults (both enabled), which matches the front-matter
   * row's declared profile; the two option rows below contain neither
   * front-matter-opening nor math-delimiter bytes, and their declared-profile
   * parse proof stays with the muya RT/PAC suites.
   */
  preferences?: Record<string, boolean>
}

const FILE_ROW_CASE_DEFS: readonly FileRowCaseDefinition[] = [
  { id: 'malformed-outer-recovers-inner-and-later-items' },
  { id: 'bom-crlf-and-astral-boundaries' },
  { id: 'repeated-table-cells-and-escaped-pipes', preferences: { superSubScript: true } },
  { id: 'yaml-front-matter' },
  { id: 'hostile-cross-block-addition', preferences: { superSubScript: true } },
  { id: 'nested-block-spanning-addition-and-deletion' },
  // The no-final-newline / repeated-blank byte classes (corpus-boundary
  // matrix rows 24, 38, 39, 40) must occupy the exact end of a real file,
  // so each crosses file IO as its own document.
  { id: 'identical-substitution-arms-with-literal-link-destinations' },
  {
    id: 'no-final-newline-repeated-blanks-astral-and-identical-text',
    preferences: { superSubScript: true }
  },
  { id: 'hostile-addition-html-and-url' },
  { id: 'hostile-comment-title' }
]

const FILE_ROW_CASES = FILE_ROW_CASE_DEFS.map((definition) => {
  const row = CRITIC_MARKUP_CORPUS.find((candidate) => candidate.id === definition.id)
  if (!row) {
    throw new TypeError(`Shared CriticMarkup corpus row is missing: ${definition.id}`)
  }
  // A `known` serializer normalization is admissible here only when it is
  // fully subsumed by the desktop open boundary (BOM strip + CRLF
  // canonicalization) — otherwise the row needs its own expected bytes.
  if (
    row.normalization.kind === 'known' &&
    desktopOpenNormalization(row.normalization.output) !== desktopOpenNormalization(row.source)
  ) {
    throw new TypeError(
      `File-backed corpus row ${row.id} declares a serializer normalization ` +
      'beyond the desktop open boundary.'
    )
  }
  return { ...definition, row }
})

const REVIEW_TYPE_LABELS: Record<string, string> = {
  addition: 'Addition',
  deletion: 'Deletion',
  substitution: 'Substitution',
  highlight: 'Highlight',
  comment: 'Comment'
}

const readPreferenceValue = (page: Page, key: string): Promise<unknown> =>
  page.evaluate((prefKey) => {
    const root = document.querySelector('#app') as
      | (Element & { __vue_app__?: { config?: { globalProperties?: Record<string, unknown> } } })
      | null
    const pinia = root?.__vue_app__?.config?.globalProperties?.$pinia as
      | { _s?: Map<string, Record<string, unknown>> }
      | undefined
    const store = pinia?._s?.get('preferences')
    return store ? store[prefKey] : undefined
  }, key)

const applyRowPreferences = async(
  page: Page,
  preferences: Record<string, boolean>
): Promise<void> => {
  await page.evaluate((payload) => {
    window.electron.ipcRenderer.send('mt::set-user-preference', payload)
  }, preferences)
  for (const [key, value] of Object.entries(preferences)) {
    await expect.poll(() => readPreferenceValue(page, key), { timeout: 5000 }).toBe(value)
  }
  // The preference watcher re-renders the engine (`setOptions(..., true)`);
  // let that settle before canonical-markdown assertions.
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

// A no-op save must still WRITE (the main process persists unconditionally).
// Asserting only byte equality would pass vacuously when the file already
// holds the expected bytes, so require an mtime advance before comparing.
const saveAndExpectFileBytes = async(
  app: ElectronApplication,
  filePath: string,
  expected: string
): Promise<void> => {
  const mtimeBefore = fs.statSync(filePath).mtimeMs
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => fs.statSync(filePath).mtimeMs, { timeout: 5000 })
    .toBeGreaterThan(mtimeBefore)
  expect(fs.readFileSync(filePath, 'utf-8')).toBe(expected)
}

// Live-editor inertness scan for hostile rows: no script element, no event
// handler or srcdoc attribute, and no javascript:/vbscript:/non-image data:
// URL survives in the rendered document (mirrors the assertion set of muya's
// criticMarkupSecurity.spec.ts against the real desktop renderer DOM).
const editorSecurityViolations = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const urlAttributes = new Set([
      'action',
      'formaction',
      'href',
      'poster',
      'src',
      'xlink:href'
    ])
    const violations: string[] = []
    if ((window as unknown as { __criticXss?: unknown }).__criticXss !== undefined) {
      violations.push('__criticXss global was set')
    }
    const root = document.querySelector('.editor-component')
    if (!root) return ['editor root missing']
    if (root.querySelector('script')) violations.push('script element rendered')
    for (const element of root.querySelectorAll('*')) {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase()
        if (name.startsWith('on')) violations.push(`event attribute ${name}`)
        if (name === 'srcdoc') violations.push('srcdoc attribute')
        if (urlAttributes.has(name)) {
          const compact = attribute.value
            .split('')
            .filter((character) => character.charCodeAt(0) > 0x20)
            .join('')
            .toLowerCase()
          // `data:image/...` is the engine's own safe embedded-image form;
          // executable schemes and non-image data: payloads must not survive.
          if (/^(?:javascript|vbscript):/.test(compact)) {
            violations.push(`${name}=${attribute.value}`)
          } else if (/^data:/.test(compact) && !/^data:image\//.test(compact)) {
            violations.push(`${name}=${attribute.value}`)
          }
        }
      }
    }
    return violations
  })

test.describe('CriticMarkup file-backed corpus rows (plan minimum)', () => {
  test.describe.configure({ timeout: 90000 })

  for (const { id, preferences, row } of FILE_ROW_CASES) {
    test(`${id} round-trips real file IO, review enumeration, and reopen`, async() => {
      const expectedCanonical = desktopOpenNormalization(row.source)
      const initial = await launchWithMarkdown(row.source)
      let app = initial.app
      let page = initial.page
      const { filePath } = initial

      try {
        await clearCapturedErrors(app)
        if (preferences) await applyRowPreferences(page, preferences)

        await expect.poll(() => readCanonicalMarkdown(page), { timeout: 5000 })
          .toBe(expectedCanonical)
        expect(fs.readFileSync(filePath, 'utf-8')).toBe(row.source)

        await openReviewSidebar(page, app)
        const cards = page.locator('.review-card')
        await expect(cards).toHaveCount(row.expected.itemTypes.length)
        if (row.expected.itemTypes.length > 0) {
          await expect(cards.locator('.type-label')).toHaveText(
            row.expected.itemTypes.map((type) => REVIEW_TYPE_LABELS[type])
          )
        }

        if (row.tags.includes('hostile')) {
          expect(await editorSecurityViolations(page)).toEqual([])
        }

        // The save path must restore the exact source bytes (including BOM
        // and CRLF via the recorded encoding/line-ending bookkeeping), and a
        // repeated save must be byte-idempotent.
        await saveAndExpectFileBytes(app, filePath, row.source)
        await saveAndExpectFileBytes(app, filePath, row.source)
        expect(await readCanonicalMarkdown(page)).toBe(expectedCanonical)

        await expectNoCapturedErrors(app)
        await app.close()
        const reopened = await launchWithDoc(filePath)
        app = reopened.app
        page = reopened.page
        await clearCapturedErrors(app)
        if (preferences) await applyRowPreferences(page, preferences)

        await expect.poll(() => readCanonicalMarkdown(page), { timeout: 5000 })
          .toBe(expectedCanonical)
        expect(fs.readFileSync(filePath, 'utf-8')).toBe(row.source)
        await saveAndExpectFileBytes(app, filePath, row.source)
        await expectNoCapturedErrors(app)
      } finally {
        await app.close().catch(() => undefined)
      }
    })
  }
})

// ----------------------------------------------------------------------------
// Track Changes at the real desktop boundary: menu toggle, tracked selection
// replacement, native cut, bulk resolution, and one-undo-step semantics —
// the flows docs/CRITICMARKUP.md promises but no E2E previously exercised.
// ----------------------------------------------------------------------------

test.describe('CriticMarkup Track Changes desktop workflow', () => {
  test.describe.configure({ timeout: 90000 })

  test('tracks replacement and native cut, resolves all, one undo step each', async() => {
    const original = 'alpha bravo charlie\n\ndelta echo foxtrot\n'
    const { app, page } = await launchWithMarkdown(original)
    try {
      await focusEditor(page)
      await clearRendererErrors(app)

      await expect.poll(() => menuEnabled(app, 'reviewTrackChangesMenuItem')).toBe(true)
      expect(await menuChecked(app, 'reviewTrackChangesMenuItem')).toBe(false)
      await clickMenuById(app, 'reviewTrackChangesMenuItem')
      await expect.poll(() => menuChecked(app, 'reviewTrackChangesMenuItem')).toBe(true)

      // Typing over a selection becomes a substitution marker, not a
      // destructive edit, and the exact untouched bytes stay in place.
      await selectWord(page, 'bravo')
      // 'zulu' shares no boundary bytes with 'bravo', so the minimal-diff
      // tracked commit records the whole word as one substitution.
      await page.keyboard.insertText('zulu')
      const tracked = original.replace('bravo', '{~~bravo~>zulu~~}')
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(tracked)

      // One semantic history entry per tracked commit.
      await undo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(original)
      await redo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(tracked)

      // Native cut under Track Changes: a deletion marker in the document,
      // the removed text in the OS clipboard.
      await selectWord(page, 'echo')
      const sentinel = `critic-cut-sentinel-${Date.now()}`
      await writeClipboard(app, sentinel)
      await expect.poll(() => readClipboard(app)).toBe(sentinel)
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (!win) throw new TypeError('No editor window is available for native cut.')
        win.webContents.cut()
      })
      await expect.poll(() => readClipboard(app), { timeout: 8000 }).toBe('echo')
      const trackedCut = tracked.replace('echo', '{--echo--}')
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(trackedCut)

      // Accept All applies both markers as one undoable boundary.
      await expect.poll(() => menuEnabled(app, 'reviewAcceptAllMenuItem')).toBe(true)
      await clickMenuById(app, 'reviewAcceptAllMenuItem')
      const accepted = original.replace('bravo', 'zulu').replace('echo', '')
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(accepted)
      await undo(app)
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(trackedCut)

      // Reject All restores the exact pre-review bytes.
      await expect.poll(() => menuEnabled(app, 'reviewRejectAllMenuItem')).toBe(true)
      await clickMenuById(app, 'reviewRejectAllMenuItem')
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(original)

      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })

  test('authors addition, suggested replacement, and highlight via the Review menu', async() => {
    const original = 'one two three four\n'
    const { app, page } = await launchWithMarkdown(original)
    try {
      await focusEditor(page)
      await clearRendererErrors(app)

      await selectWord(page, 'two')
      await expect.poll(() => menuEnabled(app, 'reviewMarkAdditionMenuItem')).toBe(true)
      await clickMenuById(app, 'reviewMarkAdditionMenuItem')
      const added = original.replace('two', '{++two++}')
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(added)

      await selectWord(page, 'three')
      await expect.poll(() => menuEnabled(app, 'reviewSuggestReplacementMenuItem')).toBe(true)
      await clickMenuById(app, 'reviewSuggestReplacementMenuItem')
      const prompt = page.locator('.ag-critic-markup-dialog')
      await expect(prompt).toBeVisible()
      await prompt.locator('textarea').fill('tres')
      await prompt.locator('.el-button--primary').click()
      await expect(prompt).toBeHidden()
      const replaced = added.replace('three', '{~~three~>tres~~}')
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(replaced)

      await selectWord(page, 'four')
      await expect.poll(() => menuEnabled(app, 'reviewHighlightMenuItem')).toBe(true)
      await clickMenuById(app, 'reviewHighlightMenuItem')
      const highlighted = replaced.replace('four', '{==four==}')
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(highlighted)

      await openReviewSidebar(page, app)
      await expect(page.locator('.review-card')).toHaveCount(3)
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
    }
  })
})

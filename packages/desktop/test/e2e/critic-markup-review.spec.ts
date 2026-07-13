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

const sourceMarkdown = (page: Page): Promise<string> => page.evaluate(() => {
  const element = document.querySelector('.source-code .CodeMirror') as
    | (Element & { CodeMirror?: { getValue: () => string } })
    | null
  if (!element?.CodeMirror) throw new TypeError('Source CodeMirror instance is unavailable.')
  return element.CodeMirror.getValue()
})

const menuEnabled = (app: ElectronApplication, id: string): Promise<boolean | null> =>
  app.evaluate(({ Menu }, menuId) => Menu.getApplicationMenu()?.getMenuItemById(menuId)?.enabled ?? null, id)

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
  await page.locator('.side-bar .left-column li[aria-label="Review"]').click()
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
    const prompt = page.locator('.ag-critic-markup-dialog')
    await expect(prompt).toBeVisible()
    await prompt.locator('textarea').fill('review note')
    await prompt.locator('.el-button--primary').click()
    await expect(prompt).toBeHidden()
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
      const prompt = page.locator('.ag-critic-markup-dialog')
      await expect(prompt).toBeVisible()
      await prompt.locator('textarea').fill('cross tab note')

      await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'beta landing zone\n')
      await expect(page.locator('.tabs-container > li')).toHaveCount(2)
      await expect(page.locator('.editor-component')).toContainText('beta landing zone')
      await expect(prompt).toBeHidden()

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
})

const FILE_CORPUS_ROW_IDS = [
  'all-five-canonical-forms',
  'mixed-nested-forms',
  'escaped-opener-and-closer-like-payload',
  'block-spanning-addition',
  'inline-fenced-and-indented-code-contexts'
] as const

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

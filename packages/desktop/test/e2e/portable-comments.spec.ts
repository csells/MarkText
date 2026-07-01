import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import {
  clickMenuById,
  enterSourceMode,
  exitSourceMode,
  focusEditor,
  getMarkdownContent,
  launchElectron,
  launchWithMarkdown,
  sendIpcToRenderer,
  setSourceMarkdown,
  waitForEditor,
  waitForMenuReady
} from './helpers'

const metadata = (data: Record<string, unknown>): string =>
  `data:application/json;base64,${Buffer.from(JSON.stringify(data)).toString('base64')}`

const META_OPEN =
  'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwiYXV0aG9ycyI6WyJBZGEiXSwicmVwbGllcyI6W119'
const META_RESOLVED =
  'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJyZXNvbHZlZCIsImF1dGhvcnMiOlsiQWRhIl0sInJlcGxpZXMiOltdfQ=='

const DOC = [
  'A <!--MC:a-->reviewed<!--MC:~a--> span.',
  '',
  `[MC:a]: ${META_OPEN}`,
  ''
].join('\n')

const DOC_WITH_REPLY = [
  'A <!--MC:a-->reviewed<!--MC:~a--> span.',
  '',
  `[MC:a]: ${metadata({
    version: 1,
    status: 'open',
    authors: ['Ada'],
    replies: [
      {
        author: 'Ada',
        createdAt: '2026-06-30T12:00:00.000Z',
        body: 'Original note'
      }
    ]
  })}`,
  ''
].join('\n')

const MALFORMED_DOC = [
  'A <!--MC:broken-->dangling span.',
  '',
  `[MC:orphan]: ${META_OPEN}`,
  ''
].join('\n')

const sourceValue = async(page: Page): Promise<string> =>
  page.evaluate(() => {
    const cm = document.querySelector('.source-code .CodeMirror') as
      | (Element & { CodeMirror?: { getValue(): string } })
      | null
    return cm?.CodeMirror?.getValue() ?? ''
  })

const isDirty = (page: Page): Promise<boolean> =>
  page.evaluate(() => !!document.querySelector('.editor-tabs li.unsaved'))

type SourceCodeMirrorElement = Element & {
  CodeMirror?: {
    focus(): void
    getSelection(): string
    getValue(): string
    posFromIndex(index: number): { line: number; ch: number }
    replaceRange(
      replacement: string,
      from: { line: number; ch: number },
      to?: { line: number; ch: number }
    ): void
    setCursor(cursor: { line: number; ch: number }): void
    setSelection(anchor: { line: number; ch: number }, focus: { line: number; ch: number }): void
  }
}

const setSourceSelection = async(
  page: Page,
  anchor: { line: number; ch: number },
  focus: { line: number; ch: number }
): Promise<void> => {
  await page.evaluate(
    ({ anchor, focus }) => {
      const cm = document.querySelector('.source-code .CodeMirror') as SourceCodeMirrorElement | null
      cm?.CodeMirror?.focus()
      cm?.CodeMirror?.setSelection(anchor, focus)
    },
    { anchor, focus }
  )
}

const replaceSourceText = async(
  page: Page,
  search: string,
  replacement: string
): Promise<void> => {
  await page.evaluate(
    ({ search, replacement }) => {
      const cm = document.querySelector('.source-code .CodeMirror') as SourceCodeMirrorElement | null
      const editor = cm?.CodeMirror
      if (!editor) throw new Error('CodeMirror is not available')
      const value = editor.getValue()
      const index = value.indexOf(search)
      if (index < 0) throw new Error(`Source text not found: ${search}`)
      const from = editor.posFromIndex(index)
      const to = editor.posFromIndex(index + search.length)
      editor.focus()
      editor.replaceRange(replacement, from, to)
      editor.setCursor(editor.posFromIndex(index + replacement.length))
    },
    { search, replacement }
  )
}

const sourceSelectionText = async(page: Page): Promise<string> =>
  page.evaluate(() => {
    const cm = document.querySelector('.source-code .CodeMirror') as SourceCodeMirrorElement | null
    return cm?.CodeMirror?.getSelection() ?? ''
  })

const save = async(app: ElectronApplication): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
}

const openCommentsSidebar = async(page: Page, app: ElectronApplication): Promise<void> => {
  if (!(await page.locator('.side-bar').isVisible())) {
    await clickMenuById(app, 'sideBarMenuItem')
  }

  await page.locator('.side-bar .left-column > ul').first().locator('li').nth(3).click()
  await page.waitForSelector('.side-bar-comments', { state: 'visible', timeout: 10000 })
}

test.describe('Portable markdown comments', () => {
  test('render in WYSIWYG while preserving the raw Markdown source', async() => {
    const { app, page } = await launchWithMarkdown(DOC)
    try {
      await page.waitForSelector('.mu-comment-highlight', { state: 'attached', timeout: 10000 })

      await expect
        .poll(() => page.locator('.mu-comment-highlight').first().textContent(), {
          timeout: 10000
        })
        .toBe('reviewed')
      expect(await page.locator('.mu-comment-marker').first().textContent()).toBe('<!--MC:a-->')
      expect(await getMarkdownContent(page, app)).toBe(DOC)
    } finally {
      await app.close()
    }
  })

  test('source mode handoffs do not rewrite valid comment syntax', async() => {
    const { app, page } = await launchWithMarkdown(DOC)
    try {
      for (let i = 0; i < 2; i++) {
        await enterSourceMode(page, app)
        expect(await sourceValue(page)).toBe(DOC)
        await exitSourceMode(page, app)
        expect(await getMarkdownContent(page, app)).toBe(DOC)
      }
    } finally {
      await app.close()
    }
  })

  test('source mode decorates comment syntax without changing the raw value', async() => {
    const { app, page } = await launchWithMarkdown(DOC)
    try {
      await enterSourceMode(page, app)
      expect(await sourceValue(page)).toBe(DOC)

      await expect(page.locator('.source-code .cm-mt-comment-marker')).toHaveCount(2)
      await expect(page.locator('.source-code .cm-mt-comment-metadata')).toHaveCount(1)
      expect(await sourceValue(page)).toBe(DOC)
    } finally {
      await app.close()
    }
  })

  test('source mode add-comment menu wraps the CodeMirror selection', async() => {
    const { app, page } = await launchWithMarkdown('A reviewed span.\n')
    try {
      await enterSourceMode(page, app)
      await setSourceSelection(page, { line: 0, ch: 2 }, { line: 0, ch: 10 })
      await clickMenuById(app, 'edit.add-comment')

      await expect.poll(() => sourceValue(page), { timeout: 5000 }).toContain(
        'A <!--MC:cmt_1-->reviewed<!--MC:~cmt_1--> span.'
      )
      const markdown = await sourceValue(page)
      expect(markdown).toContain('[MC:cmt_1]: data:application/json;base64,')
      await expect(page.locator('.side-bar-comments .thread')).toHaveCount(1)
      await expect(page.locator('.side-bar-comments .reply-box textarea').first()).toBeFocused()

      await exitSourceMode(page, app)
      expect(await getMarkdownContent(page, app)).toContain(
        'A <!--MC:cmt_1-->reviewed<!--MC:~cmt_1--> span.'
      )
    } finally {
      await app.close()
    }
  })

  test('add comment opens the initial note composer', async() => {
    const { app, page } = await launchWithMarkdown('A reviewed span.\n')
    try {
      await focusEditor(page)
      await clickMenuById(app, 'edit.add-comment')

      await expect(page.locator('.side-bar-comments .thread')).toHaveCount(1)
      const thread = page.locator('.side-bar-comments .thread').first()
      await expect(thread.locator('.reply-box textarea')).toBeFocused()
      await thread.locator('.reply-box textarea').fill('Initial note')
      await thread.getByRole('button', { name: 'Reply' }).click()
      await expect(thread.locator('.reply p').first()).toHaveText('Initial note')
    } finally {
      await app.close()
    }
  })

  test('source mode edits refresh comment diagnostics before WYSIWYG handoff', async() => {
    const { app, page } = await launchWithMarkdown(DOC)
    try {
      await enterSourceMode(page, app)
      await openCommentsSidebar(page, app)

      await replaceSourceText(page, '<!--MC:~a-->', '<!--MC:~missing-->')

      await expect(page.locator('.side-bar-comments .diagnostic-code')).toContainText([
        'orphan-close-marker',
        'unclosed-open-marker',
        'orphan-metadata'
      ])
      expect(await sourceValue(page)).toContain('<!--MC:~missing-->')
    } finally {
      await app.close()
    }
  })

  test('source mode sidebar actions edit, reply, resolve, reopen, and jump to raw comments', async() => {
    const { app, page } = await launchWithMarkdown(DOC_WITH_REPLY)
    try {
      await enterSourceMode(page, app)
      await openCommentsSidebar(page, app)
      const thread = page.locator('.side-bar-comments .thread').first()

      await thread.locator('.thread-actions button').nth(0).click()
      await expect.poll(() => sourceSelectionText(page), { timeout: 5000 }).toBe('reviewed')

      await thread.locator('.thread-actions button').nth(1).click()
      await thread.locator('.edit-box textarea').fill('Edited in source')
      await thread.getByRole('button', { name: 'Save' }).click()
      await expect(thread.locator('.reply p').first()).toHaveText('Edited in source')

      await thread.locator('.reply-box textarea').fill('Source reply')
      await thread.getByRole('button', { name: 'Reply' }).click()
      await expect(thread.locator('.reply p').last()).toHaveText('Source reply')

      await thread.locator('.thread-actions button').nth(2).click()
      await expect(thread.locator('.status')).toHaveText('Resolved')

      await thread.locator('.thread-actions button').nth(2).click()
      await expect(thread.locator('.status')).toHaveText('Open')
      expect(await sourceValue(page)).toContain('<!--MC:a-->reviewed<!--MC:~a-->')
    } finally {
      await app.close()
    }
  })

  test('source edits outside markers and inside metadata survive the handoff', async() => {
    const { app, page } = await launchWithMarkdown(DOC)
    try {
      const proseEdited = DOC.replace(' span.', ' span with source edit.')
      await setSourceMarkdown(page, app, proseEdited)
      expect(await getMarkdownContent(page, app)).toBe(proseEdited)

      const metadataEdited = proseEdited.replace(META_OPEN, META_RESOLVED)
      await setSourceMarkdown(page, app, metadataEdited)
      expect(await getMarkdownContent(page, app)).toBe(metadataEdited)
      await expect
        .poll(() => page.locator('.mu-comment-highlight').first().textContent(), {
          timeout: 10000
        })
        .toBe('reviewed')
    } finally {
      await app.close()
    }
  })

  test('shows diagnostics for malformed comments without blocking open or source handoff', async() => {
    const { app, page } = await launchWithMarkdown(MALFORMED_DOC)
    try {
      await openCommentsSidebar(page, app)

      await expect(page.locator('.side-bar-comments .diagnostic-code')).toContainText([
        'unclosed-open-marker',
        'orphan-metadata'
      ])
      expect(await getMarkdownContent(page, app)).toBe(MALFORMED_DOC)
    } finally {
      await app.close()
    }
  })

  test('sidebar actions edit, reply, resolve, and reopen thread metadata', async() => {
    const { app, page } = await launchWithMarkdown(DOC)
    try {
      await openCommentsSidebar(page, app)
      const thread = page.locator('.side-bar-comments .thread').first()

      await thread.locator('.thread-actions button').nth(1).click()
      await thread.locator('.edit-box textarea').fill('Edited first note')
      await thread.getByRole('button', { name: 'Save' }).click()
      await expect(thread.locator('.reply p').first()).toHaveText('Edited first note')

      await thread.locator('.reply-box textarea').fill('Second reply')
      await thread.getByRole('button', { name: 'Reply' }).click()
      await expect(thread.locator('.reply p').last()).toHaveText('Second reply')

      await thread.locator('.thread-actions button').nth(2).click()
      await expect(thread.locator('.status')).toHaveText('Resolved')

      await thread.locator('.thread-actions button').nth(2).click()
      await expect(thread.locator('.status')).toHaveText('Open')
      expect(await getMarkdownContent(page, app)).toContain('<!--MC:a-->reviewed<!--MC:~a-->')
    } finally {
      await app.close()
    }
  })

  test('save and reopen preserve portable comment bytes', async() => {
    const expected = DOC.replace(' span.', ' persisted span.').replace(META_OPEN, META_RESOLVED)
    const { app, page, filePath } = await launchWithMarkdown(DOC)
    try {
      await setSourceMarkdown(page, app, expected)
      await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

      await save(app)
      await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)
      await expect.poll(() => fs.readFileSync(filePath, 'utf-8'), { timeout: 5000 }).toBe(expected)
    } finally {
      await app.close()
    }

    const reopened = await launchElectron([filePath])
    try {
      await waitForEditor(reopened.page)
      await waitForMenuReady(reopened.app)
      await reopened.page.waitForSelector('.mu-comment-highlight', {
        state: 'attached',
        timeout: 10000
      })
      expect(await getMarkdownContent(reopened.page, reopened.app)).toBe(expected)
    } finally {
      await reopened.app.close()
    }
  })
})

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

interface CommentThreadMetadata {
  status?: string
  replies?: Array<{ body?: string }>
}

const readCommentMetadata = (markdown: string, id: string): CommentThreadMetadata => {
  const line = markdown.split(/\r\n|\n|\r/u).find(value => value.startsWith(`[MC:${id}]: `))
  if (!line) throw new Error(`Missing metadata for ${id}`)
  const dataUri = line.slice(`[MC:${id}]: `.length)
  return JSON.parse(
    Buffer.from(dataUri.replace('data:application/json;base64,', ''), 'base64').toString('utf8')
  ) as CommentThreadMetadata
}

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

const MISSING_METADATA_DOC = [
  'A <!--MC:missing-->reviewed<!--MC:~missing--> span.',
  ''
].join('\n')

const STRUCTURED_DOC = [
  '# <!--MC:heading-->Heading<!--MC:~heading-->',
  '',
  '> A <!--MC:quote-->quoted<!--MC:~quote--> line.',
  '',
  '- A <!--MC:list-->list item<!--MC:~list-->',
  '',
  '[<!--MC:link-->linked text<!--MC:~link-->](https://example.com)',
  '',
  '| Column |',
  '| --- |',
  '| <!--MC:table-->cell<!--MC:~table--> |',
  '',
  ...['heading', 'quote', 'list', 'link', 'table'].map(
    id => `[MC:${id}]: ${metadata({ version: 1, status: 'open', replies: [] })}`
  ),
  ''
].join('\n')

const OVERLAP_CROSS_BLOCK_DOC = [
  'A <!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->.',
  '',
  'Start <!--MC:cross-->first paragraph.',
  '',
  'second paragraph<!--MC:~cross--> end.',
  '',
  ...['a', 'b', 'cross'].map(
    id => `[MC:${id}]: ${metadata({ version: 1, status: 'open', replies: [] })}`
  ),
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

const wysiwygSelectionText = async(page: Page): Promise<string> =>
  page.evaluate(() => window.getSelection()?.toString() ?? '')

const save = async(app: ElectronApplication): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
}

const menuItemEnabled = async(app: ElectronApplication, id: string): Promise<boolean | null> =>
  app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    return item ? !!item.enabled : null
  }, id)

const waitForMenuItemEnabled = async(
  app: ElectronApplication,
  id: string,
  expected: boolean,
  timeout = 4000
): Promise<boolean | null> => {
  const deadline = Date.now() + timeout
  let last = await menuItemEnabled(app, id)
  while (Date.now() < deadline) {
    if (last === expected) return last
    await new Promise((resolve) => setTimeout(resolve, 100))
    last = await menuItemEnabled(app, id)
  }
  return last
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

  test('renders comments across Markdown structures while hiding raw marker syntax', async() => {
    const { app, page } = await launchWithMarkdown(STRUCTURED_DOC)
    try {
      await expect(page.locator('.mu-comment-highlight')).toHaveCount(5, { timeout: 10000 })
      const highlights = await page.locator('.mu-comment-highlight').evaluateAll(elements =>
        elements.map(element => element.textContent)
      )
      expect(highlights).toEqual(
        expect.arrayContaining(['Heading', 'quoted', 'list item', 'linked text', 'cell'])
      )

      const markerStyle = await page.locator('.mu-comment-marker').first().evaluate((element) => {
        const style = window.getComputedStyle(element)
        return {
          fontSize: style.fontSize,
          text: element.textContent
        }
      })
      expect(markerStyle).toEqual({
        fontSize: '0px',
        text: '<!--MC:heading-->'
      })

      await openCommentsSidebar(page, app)
      await expect(page.locator('.side-bar-comments .thread')).toHaveCount(5)
    } finally {
      await app.close()
    }
  })

  test('renders overlapping and cross-block ranges in WYSIWYG and sidebar state', async() => {
    const { app, page } = await launchWithMarkdown(OVERLAP_CROSS_BLOCK_DOC)
    try {
      await expect(page.locator('.mu-comment-highlight').first()).toBeAttached({ timeout: 10000 })
      const highlightedText = (
        await page.locator('.mu-comment-highlight').evaluateAll(elements =>
          elements.map(element => element.textContent ?? '')
        )
      ).join('|')

      expect(highlightedText).toContain('alpha')
      expect(highlightedText).toContain('beta')
      expect(highlightedText).toContain('gamma')
      expect(highlightedText).toContain('first paragraph.')
      expect(highlightedText).toContain('second paragraph')

      await openCommentsSidebar(page, app)
      await expect(page.locator('.side-bar-comments .thread')).toHaveCount(3)
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

  test('source mode decorates only live comment syntax, not ignored contexts', async() => {
    const doc = [
      '---',
      'title: <!--MC:front-->front<!--MC:~front-->',
      '---',
      '',
      '```md',
      '<!--MC:fenced-->fenced<!--MC:~fenced-->',
      `[MC:fenced]: ${META_OPEN}`,
      '```',
      '',
      'Example `<!--MC:inline-->inline<!--MC:~inline-->` text.',
      '',
      '<section><!--MC:html-->html<!--MC:~html--></section>',
      '',
      '$$',
      '<!--MC:math-->math<!--MC:~math-->',
      '$$',
      '',
      '    <!--MC:indented-->indented<!--MC:~indented-->',
      '',
      'A <!--MC:a-->real<!--MC:~a--> span.',
      '',
      `[MC:a]: ${META_OPEN}`,
      ''
    ].join('\n')
    const { app, page } = await launchWithMarkdown(doc)
    try {
      await enterSourceMode(page, app)

      await expect(page.locator('.source-code .cm-mt-comment-marker')).toHaveCount(2)
      await expect(page.locator('.source-code .cm-mt-comment-metadata')).toHaveCount(1)
      expect(await sourceValue(page)).toBe(doc)
    } finally {
      await app.close()
    }
  })

  test('source mode Add Comment menu follows the CodeMirror selection', async() => {
    const { app, page } = await launchWithMarkdown('A reviewed span.\n')
    try {
      await enterSourceMode(page, app)
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', false)).toBe(false)

      await setSourceSelection(page, { line: 0, ch: 2 }, { line: 0, ch: 10 })
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', true)).toBe(true)

      await setSourceSelection(page, { line: 0, ch: 2 }, { line: 0, ch: 2 })
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', false)).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('source mode Add Comment rejects fenced-code selections', async() => {
    const doc = '```js\nconst value = 1\n```\n'
    const { app, page } = await launchWithMarkdown(doc)
    try {
      await enterSourceMode(page, app)
      await setSourceSelection(page, { line: 1, ch: 0 }, { line: 1, ch: 5 })
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', false)).toBe(false)

      await clickMenuById(app, 'review.add-comment')

      expect(await sourceValue(page)).toBe(doc)
      expect(await sourceValue(page)).not.toContain('[MC:')
    } finally {
      await app.close()
    }
  })

  test('source mode Add Comment rejects inline-code selections', async() => {
    const doc = 'A `reviewed` span.\n'
    const { app, page } = await launchWithMarkdown(doc)
    try {
      await enterSourceMode(page, app)
      await setSourceSelection(page, { line: 0, ch: 3 }, { line: 0, ch: 11 })
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', false)).toBe(false)

      await clickMenuById(app, 'review.add-comment')

      expect(await sourceValue(page)).toBe(doc)
      expect(await sourceValue(page)).not.toContain('[MC:')
    } finally {
      await app.close()
    }
  })

  test('source mode Add Comment rejects selections inside existing marker syntax', async() => {
    const { app, page } = await launchWithMarkdown(DOC)
    try {
      await enterSourceMode(page, app)
      await setSourceSelection(page, { line: 0, ch: 5 }, { line: 0, ch: 9 })
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', false)).toBe(false)

      await clickMenuById(app, 'review.add-comment')

      expect(await sourceValue(page)).toBe(DOC)
    } finally {
      await app.close()
    }
  })

  test('source mode Add Comment rejects selections inside metadata definitions', async() => {
    const { app, page } = await launchWithMarkdown(DOC)
    try {
      await enterSourceMode(page, app)
      await setSourceSelection(page, { line: 2, ch: 1 }, { line: 2, ch: 5 })
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', false)).toBe(false)

      await clickMenuById(app, 'review.add-comment')

      expect(await sourceValue(page)).toBe(DOC)
    } finally {
      await app.close()
    }
  })

  test('source mode Add Comment rejects a whole-line block selection that would demote the block', async() => {
    const doc = '# Heading\n\n- item\n\n> quote\n'
    const { app, page } = await launchWithMarkdown(doc)
    try {
      await enterSourceMode(page, app)

      // Whole heading line from column 0 (includes the '# ' prefix): a marker
      // inserted at column 0 would turn the heading into a paragraph.
      await setSourceSelection(page, { line: 0, ch: 0 }, { line: 0, ch: 9 })
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', false)).toBe(false)
      await clickMenuById(app, 'review.add-comment')
      expect(await sourceValue(page)).toBe(doc)
      expect(await sourceValue(page)).not.toContain('[MC:')

      // Whole list-item line from column 0 (includes the '- ' prefix).
      await setSourceSelection(page, { line: 2, ch: 0 }, { line: 2, ch: 6 })
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', false)).toBe(false)

      // Whole blockquote line from column 0 (includes the '> ' prefix).
      await setSourceSelection(page, { line: 4, ch: 0 }, { line: 4, ch: 7 })
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', false)).toBe(false)

      // But selecting only the heading TEXT (after the prefix) is allowed.
      await setSourceSelection(page, { line: 0, ch: 2 }, { line: 0, ch: 9 })
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', true)).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('source mode Add Comment rejects non-commentable block selections', async() => {
    const doc = [
      '---',
      'title: front matter text',
      '---',
      '',
      '<div>html text</div>',
      '',
      '$$',
      'math text',
      '$$',
      '',
      '    indented code text',
      '',
      'plain selectable text',
      ''
    ].join('\n')
    const { app, page } = await launchWithMarkdown(doc)
    try {
      await enterSourceMode(page, app)

      for (const [line, from, to] of [
        [1, 7, 12],
        [4, 5, 9],
        [7, 0, 4],
        [10, 4, 12]
      ] as const) {
        await setSourceSelection(page, { line, ch: from }, { line, ch: to })
        expect(await waitForMenuItemEnabled(app, 'review.add-comment', false)).toBe(false)
      }

      await setSourceSelection(page, { line: 12, ch: 0 }, { line: 12, ch: 5 })
      expect(await waitForMenuItemEnabled(app, 'review.add-comment', true)).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('source mode add-comment menu wraps the CodeMirror selection', async() => {
    const { app, page } = await launchWithMarkdown('A reviewed span.\n')
    try {
      await enterSourceMode(page, app)
      await setSourceSelection(page, { line: 0, ch: 2 }, { line: 0, ch: 10 })
      await clickMenuById(app, 'review.add-comment')

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
      await clickMenuById(app, 'review.add-comment')

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

  test('WYSIWYG context-menu add-comment IPC wraps the current selection', async() => {
    const { app, page } = await launchWithMarkdown('A reviewed span.\n')
    try {
      await focusEditor(page)
      await sendIpcToRenderer(app, 'mt::cm-add-comment')

      await expect(page.locator('.side-bar-comments .thread')).toHaveCount(1)
      const markdown = await getMarkdownContent(page, app)
      expect(markdown).toContain('<!--MC:cmt_1-->A<!--MC:~cmt_1--> reviewed span.')
      expect(markdown).toContain('[MC:cmt_1]: data:application/json;base64,')
    } finally {
      await app.close()
    }
  })

  test('save and reopen preserve a newly-created WYSIWYG comment thread', async() => {
    const { app, page, filePath } = await launchWithMarkdown('A reviewed span.\n')
    try {
      await focusEditor(page)
      await clickMenuById(app, 'review.add-comment')

      await expect(page.locator('.side-bar-comments .thread')).toHaveCount(1)
      const thread = page.locator('.side-bar-comments .thread').first()
      await thread.locator('.reply-box textarea').fill('Initial note')
      await thread.getByRole('button', { name: 'Reply' }).click()
      await expect(thread.locator('.reply p').first()).toHaveText('Initial note')

      await save(app)
      await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)
      await expect.poll(() => fs.readFileSync(filePath, 'utf-8'), { timeout: 5000 }).toContain(
        '<!--MC:cmt_1-->A<!--MC:~cmt_1--> reviewed span.'
      )
    } finally {
      await app.close()
    }

    const reopened = await launchElectron([filePath])
    try {
      await waitForEditor(reopened.page)
      await waitForMenuReady(reopened.app)
      await expect(reopened.page.locator('.mu-comment-highlight')).toHaveText('A')
      await openCommentsSidebar(reopened.page, reopened.app)
      await expect(reopened.page.locator('.side-bar-comments .reply p').first()).toHaveText(
        'Initial note'
      )
    } finally {
      await reopened.app.close()
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
      await page.locator('.side-bar-comments .diagnostic').first().click()
      await expect.poll(() => sourceSelectionText(page), { timeout: 5000 }).toBe('<!--MC:~missing-->')
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

  test('source mode sidebar metadata actions persist after save and reopen', async() => {
    const { app, page, filePath } = await launchWithMarkdown(DOC_WITH_REPLY)
    let savedMarkdown = ''
    try {
      await enterSourceMode(page, app)
      await openCommentsSidebar(page, app)
      const thread = page.locator('.side-bar-comments .thread').first()

      await thread.locator('.thread-actions button').nth(1).click()
      await thread.locator('.edit-box textarea').fill('Persisted source edit')
      await thread.getByRole('button', { name: 'Save' }).click()
      await expect(thread.locator('.reply p').first()).toHaveText('Persisted source edit')

      await thread.locator('.reply-box textarea').fill('Persisted source reply')
      await thread.getByRole('button', { name: 'Reply' }).click()
      await expect(thread.locator('.reply p').last()).toHaveText('Persisted source reply')

      await thread.locator('.thread-actions button').nth(2).click()
      await expect(thread.locator('.status')).toHaveText('Resolved')

      await save(app)
      await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)
      await expect.poll(() => {
        const thread = readCommentMetadata(fs.readFileSync(filePath, 'utf-8'), 'a')
        return thread.replies?.map(reply => reply.body)
      }, { timeout: 5000 }).toEqual([
        'Persisted source edit',
        'Persisted source reply'
      ])
      savedMarkdown = fs.readFileSync(filePath, 'utf-8')
      const savedThread = readCommentMetadata(savedMarkdown, 'a')
      expect(savedThread.status).toBe('resolved')
      expect(savedThread.replies?.map(reply => reply.body)).toEqual([
        'Persisted source edit',
        'Persisted source reply'
      ])
    } finally {
      await app.close()
    }

    const reopened = await launchElectron([filePath])
    try {
      await waitForEditor(reopened.page)
      await waitForMenuReady(reopened.app)
      await openCommentsSidebar(reopened.page, reopened.app)
      const reopenedThread = reopened.page.locator('.side-bar-comments .thread').first()

      await expect(reopenedThread.locator('.status')).toHaveText('Resolved')
      await expect(reopenedThread.locator('.reply p').first()).toHaveText('Persisted source edit')
      await expect(reopenedThread.locator('.reply p').last()).toHaveText('Persisted source reply')
      expect(await getMarkdownContent(reopened.page, reopened.app)).toBe(savedMarkdown)
    } finally {
      await reopened.app.close()
    }
  })

  test('source mode sidebar jump ignores comment-looking markers inside fenced examples', async() => {
    const doc = [
      '```md',
      '<!--MC:a-->example<!--MC:~a-->',
      '```',
      '',
      'A <!--MC:a-->real<!--MC:~a--> span.',
      '',
      `[MC:a]: ${META_OPEN}`,
      ''
    ].join('\n')
    const { app, page } = await launchWithMarkdown(doc)
    try {
      await enterSourceMode(page, app)
      await openCommentsSidebar(page, app)

      await page.locator('.side-bar-comments .thread .thread-actions button').first().click()

      await expect.poll(() => sourceSelectionText(page), { timeout: 5000 }).toBe('real')
    } finally {
      await app.close()
    }
  })

  test('source mode sidebar jump reaches a comment on an indented paragraph-continuation line', async() => {
    // The second line is >=4 spaces indented but is a lazy paragraph
    // continuation (indented code cannot interrupt a paragraph), so its marker
    // must not be treated as code — the sidebar jump must still find it.
    const doc = [
      'paragraph text',
      '    A <!--MC:a-->reviewed<!--MC:~a--> continuation.',
      '',
      `[MC:a]: ${META_OPEN}`,
      ''
    ].join('\n')
    const { app, page } = await launchWithMarkdown(doc)
    try {
      await enterSourceMode(page, app)
      await openCommentsSidebar(page, app)

      await page.locator('.side-bar-comments .thread .thread-actions button').first().click()

      await expect.poll(() => sourceSelectionText(page), { timeout: 5000 }).toBe('reviewed')
    } finally {
      await app.close()
    }
  })

  test('source mode sidebar jump supports line-start and standalone marker ranges', async() => {
    const doc = [
      '<!--MC:line-->alpha<!--MC:~line-->',
      '',
      '<!--MC:block-->',
      '',
      'reviewed paragraph',
      '',
      '<!--MC:~block-->',
      '',
      `[MC:line]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
      `[MC:block]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
      ''
    ].join('\n')
    const { app, page } = await launchWithMarkdown(doc)
    try {
      await enterSourceMode(page, app)
      await openCommentsSidebar(page, app)

      await page.locator('.side-bar-comments .thread[data-comment-id="line"] .thread-actions button')
        .first()
        .click()
      await expect.poll(() => sourceSelectionText(page), { timeout: 5000 }).toBe('alpha')

      await page.locator('.side-bar-comments .thread[data-comment-id="block"] .thread-actions button')
        .first()
        .click()
      await expect.poll(() => sourceSelectionText(page), { timeout: 5000 })
        .toContain('reviewed paragraph')
    } finally {
      await app.close()
    }
  })

  test('source mode sidebar jump ignores comment-looking markers inside inline code', async() => {
    const doc = [
      'Example `<!--MC:a-->example<!--MC:~a-->` marker text.',
      '',
      'A <!--MC:a-->real<!--MC:~a--> span.',
      '',
      `[MC:a]: ${META_OPEN}`,
      ''
    ].join('\n')
    const { app, page } = await launchWithMarkdown(doc)
    try {
      await enterSourceMode(page, app)
      await openCommentsSidebar(page, app)

      await page.locator('.side-bar-comments .thread .thread-actions button').first().click()

      await expect.poll(() => sourceSelectionText(page), { timeout: 5000 }).toBe('real')
    } finally {
      await app.close()
    }
  })

  test('source mode sidebar jump ignores comment-looking markers inside non-commentable blocks', async() => {
    const doc = [
      '---',
      'title: <!--MC:a-->front<!--MC:~a-->',
      '---',
      '',
      '<section><!--MC:a-->html<!--MC:~a--></section>',
      '',
      '$$',
      '<!--MC:a-->math<!--MC:~a-->',
      '$$',
      '',
      '    <!--MC:a-->code<!--MC:~a-->',
      '',
      'A <!--MC:a-->real<!--MC:~a--> span.',
      '',
      `[MC:a]: ${META_OPEN}`,
      ''
    ].join('\n')
    const { app, page } = await launchWithMarkdown(doc)
    try {
      await enterSourceMode(page, app)
      await openCommentsSidebar(page, app)

      await page.locator('.side-bar-comments .thread .thread-actions button').first().click()

      await expect.poll(() => sourceSelectionText(page), { timeout: 5000 }).toBe('real')
    } finally {
      await app.close()
    }
  })

  test('source mode sidebar metadata actions preserve definition line formatting', async() => {
    const formattedDoc = DOC_WITH_REPLY.replace(
      /^\[MC:a\]: (data:application\/json;base64,\S+)$/m,
      '   [MC:a]:   $1   '
    )
    const { app, page } = await launchWithMarkdown(formattedDoc)
    try {
      await enterSourceMode(page, app)
      await openCommentsSidebar(page, app)

      const thread = page.locator('.side-bar-comments .thread').first()
      await thread.locator('.thread-actions button').nth(2).click()
      await expect(thread.locator('.status')).toHaveText('Resolved')

      const updated = await sourceValue(page)
      const metadataLine = updated.split('\n').find(line => line.includes('[MC:a]:'))
      expect(metadataLine?.startsWith('   [MC:a]:   data:application/json;base64,')).toBe(true)
      expect(metadataLine?.endsWith('   ')).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('source mode sidebar metadata actions skip malformed duplicate definitions', async() => {
    const badLine = '[MC:a]: data:application/json;base64,%%%%'
    const doc = [
      'A <!--MC:a-->reviewed<!--MC:~a--> span.',
      '',
      badLine,
      `[MC:a]: ${META_OPEN}`,
      ''
    ].join('\n')
    const { app, page } = await launchWithMarkdown(doc)
    try {
      await enterSourceMode(page, app)
      await openCommentsSidebar(page, app)

      const thread = page.locator('.side-bar-comments .thread').first()
      await thread.locator('.thread-actions button').nth(2).click()
      await expect(thread.locator('.status')).toHaveText('Resolved')

      const metadataLines = (await sourceValue(page))
        .split('\n')
        .filter(line => line.startsWith('[MC:a]:'))
      expect(metadataLines[0]).toBe(badLine)
      const updatedDataUri = metadataLines[1].replace('[MC:a]: ', '')
      const updatedJson = JSON.parse(
        Buffer.from(updatedDataUri.replace('data:application/json;base64,', ''), 'base64')
          .toString('utf8')
      ) as { status?: string }
      expect(updatedJson.status).toBe('resolved')
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
      if (await page.locator('.side-bar').isVisible()) {
        await clickMenuById(app, 'sideBarMenuItem')
      }
      await expect(page.locator('.side-bar')).toBeHidden()
      await expect(page.locator('.comments-diagnostic-peek .comments-diagnostic-badge')).toHaveText(
        '2'
      )

      await page.locator('.comments-diagnostic-peek').click()
      await page.waitForSelector('.side-bar-comments', { state: 'visible', timeout: 10000 })

      await expect(page.locator('.side-bar-comments .diagnostic-code')).toContainText([
        'unclosed-open-marker',
        'orphan-metadata'
      ])
      expect(await getMarkdownContent(page, app)).toBe(MALFORMED_DOC)
    } finally {
      await app.close()
    }
  })

  test('WYSIWYG diagnostic click focuses the rendered comment range when one exists', async() => {
    const { app, page } = await launchWithMarkdown(MISSING_METADATA_DOC)
    try {
      await openCommentsSidebar(page, app)
      await expect(page.locator('.side-bar-comments .diagnostic-code')).toContainText([
        'missing-metadata'
      ])

      await page.locator('.side-bar-comments .diagnostic').first().click()

      await expect.poll(() => wysiwygSelectionText(page), { timeout: 5000 }).toBe('reviewed')
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
      await expect.poll(() => getMarkdownContent(page, app), { timeout: 5000 }).toBe(expected)

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

  test('discarding a composed WYSIWYG comment removes its markers from the document', async() => {
    const { app, page } = await launchWithMarkdown('A reviewed span.\n')
    try {
      await focusEditor(page)
      await clickMenuById(app, 'review.add-comment')
      await expect(page.locator('.side-bar-comments .thread')).toHaveCount(1)
      expect(await getMarkdownContent(page, app)).toContain('<!--MC:')

      // Cancel the just-composed thread before adding a note → comment:discard.
      await page.locator('.side-bar-comments .thread').first()
        .getByRole('button', { name: 'Cancel' }).click()

      await expect(page.locator('.side-bar-comments .thread')).toHaveCount(0)
      expect(await getMarkdownContent(page, app)).not.toContain('<!--MC:')
    } finally {
      await app.close()
    }
  })

  test('discarding a composed comment in source mode strips its syntax bytes', async() => {
    const { app, page } = await launchWithMarkdown('A reviewed span.\n')
    try {
      await enterSourceMode(page, app)
      await setSourceSelection(page, { line: 0, ch: 2 }, { line: 0, ch: 10 })
      await clickMenuById(app, 'review.add-comment')
      await expect.poll(() => sourceValue(page), { timeout: 5000 }).toContain('<!--MC:cmt_1-->')
      expect(await sourceValue(page)).toContain('[MC:cmt_1]: ')

      await page.locator('.side-bar-comments .thread').first()
        .getByRole('button', { name: 'Cancel' }).click()

      await expect(page.locator('.side-bar-comments .thread')).toHaveCount(0)
      // handleCommentDiscard -> commentSyntaxRangesForId removes all comment
      // syntax while leaving the prose intact. (It leaves the trailing blank
      // lines the metadata appendix introduced — a cosmetic residue, not data
      // loss; the syntax itself is fully gone.)
      await expect.poll(() => sourceValue(page), { timeout: 5000 }).not.toContain('MC:cmt_1')
      const after = await sourceValue(page)
      expect(after).toContain('A reviewed span.')
      expect(after).not.toContain('<!--MC:')
      expect(after).not.toContain('[MC:')
    } finally {
      await app.close()
    }
  })
})

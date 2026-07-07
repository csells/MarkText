import type { ElectronApplication, Page } from 'playwright'
import { clickMenuById, sendIpcToRenderer } from './helpers'

export {
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

export const metadata = (data: Record<string, unknown>): string =>
  `data:application/json;base64,${Buffer.from(JSON.stringify(data)).toString('base64')}`

interface CommentThreadMetadata {
  status?: string
  replies?: Array<{ body?: string }>
}

// Reads both wire formats: a v1 base64 data-URI head with embedded replies,
// or a v2 JSON head plus `[MC:id.N]:` reply lines in document order.
export const readCommentMetadata = (markdown: string, id: string): CommentThreadMetadata => {
  const lines = markdown.split(/\r\n|\n|\r/u)
  const headLine = lines.find((value) => value.startsWith(`[MC:${id}]: `))
  if (!headLine) throw new Error(`Missing metadata for ${id}`)
  const payload = headLine.slice(`[MC:${id}]: `.length)
  if (payload.startsWith('data:application/json;base64,')) {
    return JSON.parse(
      Buffer.from(payload.replace('data:application/json;base64,', ''), 'base64').toString('utf8')
    ) as CommentThreadMetadata
  }
  const head = JSON.parse(payload) as CommentThreadMetadata
  const replies = lines
    .filter((value) => new RegExp(`^\\[MC:${id}\\.\\d+\\]: `).test(value))
    .map((value) => JSON.parse(value.slice(value.indexOf(']: ') + 3)) as { body?: string })
  return { ...head, replies }
}

export const META_OPEN =
  'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwiYXV0aG9ycyI6WyJBZGEiXSwicmVwbGllcyI6W119'
export const META_RESOLVED =
  'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJyZXNvbHZlZCIsImF1dGhvcnMiOlsiQWRhIl0sInJlcGxpZXMiOltdfQ=='

export const DOC = ['A <!--MC:a-->reviewed<!--MC:~a--> span.', '', `[MC:a]: ${META_OPEN}`, ''].join(
  '\n'
)

// v2 twins for byte-fidelity flows: the engine writes v2, so only v2 input
// round-trips byte-identically (v1 is read-forever, written-never).
export const META_OPEN_V2 = '{"version":2,"status":"open","authors":["Ada"]}'
export const META_RESOLVED_V2 = '{"version":2,"status":"resolved","authors":["Ada"]}'
export const DOC_V2 = [
  'A <!--MC:a-->reviewed<!--MC:~a--> span.',
  '',
  `[MC:a]: ${META_OPEN_V2}`,
  ''
].join('\n')

export const DOC_WITH_REPLY = [
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

export const MALFORMED_DOC = [
  'A <!--MC:broken-->dangling span.',
  '',
  `[MC:orphan]: ${META_OPEN}`,
  ''
].join('\n')

export const MISSING_METADATA_DOC = [
  'A <!--MC:missing-->reviewed<!--MC:~missing--> span.',
  ''
].join('\n')

export const STRUCTURED_DOC = [
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
    (id) => `[MC:${id}]: ${metadata({ version: 1, status: 'open', replies: [] })}`
  ),
  ''
].join('\n')

export const OVERLAP_CROSS_BLOCK_DOC = [
  'A <!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->.',
  '',
  'Start <!--MC:cross-->first paragraph.',
  '',
  'second paragraph<!--MC:~cross--> end.',
  '',
  ...['a', 'b', 'cross'].map(
    (id) => `[MC:${id}]: ${metadata({ version: 1, status: 'open', replies: [] })}`
  ),
  ''
].join('\n')

export const sourceValue = async(page: Page): Promise<string> =>
  page.evaluate(() => {
    const cm = document.querySelector('.source-code .CodeMirror') as
      | (Element & { CodeMirror?: { getValue(): string } })
      | null
    return cm?.CodeMirror?.getValue() ?? ''
  })

export const isDirty = (page: Page): Promise<boolean> =>
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

export const setSourceSelection = async(
  page: Page,
  anchor: { line: number; ch: number },
  focus: { line: number; ch: number }
): Promise<void> => {
  await page.evaluate(
    ({ anchor, focus }) => {
      const cm = document.querySelector(
        '.source-code .CodeMirror'
      ) as SourceCodeMirrorElement | null
      cm?.CodeMirror?.focus()
      cm?.CodeMirror?.setSelection(anchor, focus)
    },
    { anchor, focus }
  )
}

export const replaceSourceText = async(
  page: Page,
  search: string,
  replacement: string
): Promise<void> => {
  await page.evaluate(
    ({ search, replacement }) => {
      const cm = document.querySelector(
        '.source-code .CodeMirror'
      ) as SourceCodeMirrorElement | null
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

export const sourceSelectionText = async(page: Page): Promise<string> =>
  page.evaluate(() => {
    const cm = document.querySelector('.source-code .CodeMirror') as SourceCodeMirrorElement | null
    return cm?.CodeMirror?.getSelection() ?? ''
  })

export const wysiwygSelectionText = async(page: Page): Promise<string> =>
  page.evaluate(() => window.getSelection()?.toString() ?? '')

export const save = async(app: ElectronApplication): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
}

const menuItemEnabled = async(app: ElectronApplication, id: string): Promise<boolean | null> =>
  app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    return item ? !!item.enabled : null
  }, id)

export const waitForMenuItemEnabled = async(
  app: ElectronApplication,
  id: string,
  expected: boolean,
  timeout = 4000
): Promise<boolean | null> => {
  // The value must HOLD for consecutive reads before we accept it: a
  // negative expectation would otherwise return the stale pre-selection
  // value before the renderer->main sync lands, passing vacuously.
  const requiredStreak = 3
  const deadline = Date.now() + timeout
  let streak = 0
  let last = await menuItemEnabled(app, id)
  while (Date.now() < deadline) {
    if (last === expected) {
      streak += 1
      if (streak >= requiredStreak) return last
    } else {
      streak = 0
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    last = await menuItemEnabled(app, id)
  }
  return last
}

export const openCommentsSidebar = async(page: Page, app: ElectronApplication): Promise<void> => {
  if (!(await page.locator('.side-bar').isVisible())) {
    await clickMenuById(app, 'sideBarMenuItem')
  }

  await page.locator('.side-bar .left-column > ul').first().locator('li').nth(3).click()
  await page.waitForSelector('.side-bar-comments', { state: 'visible', timeout: 10000 })
}

export const showAllComments = async(page: Page): Promise<void> => {
  await page
    .locator('.side-bar-comments .comment-filters button', { hasText: 'All' })
    .first()
    .click()
}

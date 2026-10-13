import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  clickMenuByLabel,
  enterSourceMode,
  exitSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  getRendererErrors,
  launchInstalled,
  menuEnabledByLabel,
  waitForEditor
} from './helpers'
import { exportedDocumentText } from './helpers/exportedDocumentText'
import { preserveSystemClipboard } from './helpers/systemClipboardFixture'
import {
  authoringForms,
  captureContextMenu,
  clickContextMenu,
  clickReviewMenu,
  clickText,
  contextMenuItems,
  drag,
  menuStates,
  nativeKey,
  nextFrame,
  resetContextMenu,
  selectionPoint,
  sidebarState,
  textPoint,
  toolbarState,
  type AuthoringForm
} from './reviewGestures'

// The vision's complete editorial pass (specs/vision/
// criticmarkup-vision.md, "What native integration means") in the installed
// app, through real selection gestures, menus, keyboard, the Comments and
// Suggestions sidebar tab and the same production paths for ordinary Markdown
// and CriticMarkup. Every mutation is checked on screen and in the saved bytes.
//
// The steps share one session (an annotated and an ordinary document in two
// tabs of one hidden window) while they leave both documents at their saved
// baseline. A step that fails, or one that ends elsewhere, retires the session
// and the next step starts a fresh one, so each failure names its own step.

const ANNOTATED = [
  '# Editorial pass',
  '',
  'Intro with {++an added phrase++} and {--a removed phrase--} here.',
  '',
  'Swap {~~old wording~>new wording~~} then {==a highlighted claim==} end.',
  '',
  'Pair {==checked figure==}{>>Verify this figure.<<} and a note{>>Standalone remark.<<} here.',
  '',
  'Nested {==outer {++inner addition++} mark==}{>>Nested pair note.<<} and {>>Comment with {--nested deletion--} inside.<<} done.',
  '',
  'Cross {--start of removal',
  '',
  'end of removal--} after.',
  '',
  '- first item with {++list addition++}',
  '- second item',
  '',
  '| Name | Value |',
  '| ---- | ----- |',
  '| alpha | {~~one~>two~~} |',
  '',
  '```js',
  'const answer = 42',
  '```',
  '',
  '$$',
  'E = mc^2',
  '$$',
  '',
  'A footnote reference[^note].',
  '',
  'Authoring paragraph with plain words.',
  '',
  'Second authoring paragraph here.',
  '',
  'Tracked paragraph hello world.',
  '',
  '[^note]: Footnote with {++footnote addition++} inside.',
  ''
].join('\n')

const ORDINARY = [
  '# Field notes',
  '',
  'Some *emphasis* and a [link](https://example.com).',
  '',
  '- first',
  '- second',
  '',
  '| Left | Right |',
  '|:-----|------:|',
  '| a    | b     |',
  '',
  '```js',
  'const x = 1',
  '```',
  ''
].join('\n')

/** Applies `[from, to]` replacements, each of which must match exactly once. */
const edited = (source: string, ...changes: Array<[string, string]>): string =>
  changes.reduce((text, [from, to]) => {
    const at = text.indexOf(from)
    if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`Fixture edit is not unique: ${from}`)
    return text.slice(0, at) + to + text.slice(at + from.length)
  }, source)

// Resolution applies to the document's changes, including the one nested in a
// Highlight payload; a Comment payload is an isolated subdocument (profile R5).
const ACCEPTED_ALL = edited(
  ANNOTATED,
  ['{++an added phrase++} and {--a removed phrase--}', 'an added phrase and '],
  ['{~~old wording~>new wording~~}', 'new wording'],
  ['outer {++inner addition++} mark', 'outer inner addition mark'],
  ['Cross {--start of removal\n\nend of removal--} after.', 'Cross  after.'],
  ['{++list addition++}', 'list addition'],
  ['{~~one~>two~~}', 'two'],
  ['{++footnote addition++}', 'footnote addition']
)
const REJECTED_ALL = edited(
  ANNOTATED,
  ['{++an added phrase++} and {--a removed phrase--}', ' and a removed phrase'],
  ['{~~old wording~>new wording~~}', 'old wording'],
  ['outer {++inner addition++} mark', 'outer  mark'],
  ['Cross {--start of removal\n\nend of removal--} after.', 'Cross start of removal\n\nend of removal after.'],
  ['with {++list addition++}', 'with '],
  ['{~~one~>two~~}', 'one'],
  ['{++footnote addition++}', '']
)

const CRITIC_MARKER = /\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\{==|==\}|\{>>|<<\}/
const sidebarTabName = 'Comments and Suggestions'

// ---------------------------------------------------------------------------
// Launch, menus and files

const scratchRoots: string[] = []
const scratchRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-editorial-pass-'))
  scratchRoots.push(root)
  return root
}

const writeFixture = (root: string, name: string, content: string | Buffer): string => {
  const file = path.join(root, name)
  fs.writeFileSync(file, content, { flag: 'wx' })
  return file
}

async function launch(profile: string, files: string[]): Promise<{ app: ElectronApplication; page: Page }> {
  const launched = await launchInstalled(files, { userDataDir: profile, timeout: 60_000 })
  try {
    await expectEditorWindowHidden(launched.app)
    expectEditorNotFrontmost(launched.app)
    return launched
  } catch (error) {
    await launched.app.close().catch(() => {})
    throw error
  }
}

/** Answers every native message box in main: close prompts must never show. */
const answerMessageBoxes = (app: ElectronApplication, response: number) =>
  app.evaluate(({ dialog }, response) => {
    const host = globalThis as unknown as { editorialPrompts?: string[] }
    host.editorialPrompts = []
    dialog.showMessageBox = (async(...args: unknown[]) => {
      const options = args.find(arg => arg !== null && typeof arg === 'object' && 'message' in arg) as
        | { message: string }
        | undefined
      host.editorialPrompts?.push(options?.message ?? '')
      return { response, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, response)

const prompts = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as { editorialPrompts?: string[] }).editorialPrompts ?? [])

async function closeApp(app: ElectronApplication): Promise<void> {
  // A failed step may leave a composer or a dirty tab; never show a real prompt.
  await answerMessageBoxes(app, 1).catch(() => {})
  const errors = await getRendererErrors(app).catch(() => [])
  await app.close().catch(() => {})
  expect(errors).toEqual([])
}

/** Waits for the menu item at this label path to enable, then clicks it. */
async function menu(app: ElectronApplication, ...labels: string[]): Promise<void> {
  await expect.poll(() => menuEnabledByLabel(app, ...labels), { message: labels.join(' → ') }).toBe(true)
  await clickMenuByLabel(app, ...labels)
}

const reviewMenuChecked = (app: ElectronApplication, id: string): Promise<boolean | undefined> =>
  app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(`critic-${id}`)?.checked, id)

const settled = (page: Page): Promise<void> =>
  page.evaluate(async() => { await window.__marktextDocumentCore?.settled() })

/** The active document's canonical source, as Core holds it. */
const source = (page: Page): Promise<string | undefined> =>
  page.evaluate(async() => {
    try {
      return await window.__marktextDocumentCore?.authoritySource?.()
    } catch (error) {
      // A tab switch or reload retires the view that installed this hook.
      if (/generation changed|lease is released/.test(String(error))) return undefined
      throw error
    }
  })

/** File → Save until the file holds `expected`; a command may still be applying. */
async function expectSaved(app: ElectronApplication, file: string, expected: string): Promise<void> {
  await expect.poll(async() => {
    await menu(app, 'File', 'Save')
    return fs.readFileSync(file, 'utf8')
  }, { timeout: 15_000, message: `saved bytes of ${path.basename(file)}` }).toBe(expected)
}

/** Undoes (by ⌘Z or Edit → Undo) until the document is `expected` again. */
async function undoTo(app: ElectronApplication, page: Page, expected: string, via: 'key' | 'menu'): Promise<void> {
  for (let step = 0; step < 16 && (await source(page)) !== expected; step++) {
    if (via === 'key') await nativeKey(app, 'Z', ['meta'])
    else await menu(app, 'Edit', 'Undo')
    await settled(page)
    await page.waitForTimeout(100)
  }
  expect(await source(page)).toBe(expected)
}

const tab = (page: Page, file: string) => page.locator(`.tabs-container li[title=${JSON.stringify(file)}]`)

async function selectTab(page: Page, file: string): Promise<void> {
  await tab(page, file).click()
  await expect(tab(page, file)).toHaveClass(/active/)
  await page.waitForFunction(() => window.__marktextDocumentCore !== undefined)
  await expect(page.locator('.core-view-handoff')).toHaveCount(0)
  await expect.poll(() => source(page)).not.toBeUndefined()
}

// ---------------------------------------------------------------------------
// Sidebar and document probes

/** Shows the sidebar and selects its Comments and Suggestions tab by clicking it. */
async function openReviewTab(app: ElectronApplication, page: Page): Promise<void> {
  if (!(await sidebarState(page)).shown) await menu(app, 'View', 'Toggle Sidebar')
  const reviewTab = page.locator(`.side-bar .left-column li[aria-label="${sidebarTabName}"]`)
  await expect(reviewTab).toBeVisible()
  if ((await reviewTab.getAttribute('aria-selected')) !== 'true') await reviewTab.click()
  await expect(reviewTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('critic-review-list')).toBeVisible()
}

async function hideSidebar(app: ElectronApplication, page: Page): Promise<void> {
  if ((await sidebarState(page)).shown) await menu(app, 'View', 'Toggle Sidebar')
  await expect.poll(async() => (await sidebarState(page)).shown).toBe(false)
}

const entry = (page: Page, name: string | RegExp) =>
  page.getByTestId('critic-review-entry').getByRole('button', { name })

/** Whether the editor selection or caret touches the rendered annotation showing `text`. */
const selectionTouches = (page: Page, text: string): Promise<boolean> =>
  page.evaluate(text => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return false
    const range = selection.getRangeAt(0)
    const marks = Array.from(document.querySelectorAll<HTMLElement>('.editor-component [data-critic-kind]'))
      .filter(mark => mark.textContent?.includes(text))
    // A caret at an annotation's edge touches it even outside its element.
    const touches = (mark: HTMLElement) => {
      if (range.intersectsNode(mark)) return true
      const gap = document.createRange()
      gap.selectNodeContents(mark)
      const before = document.createRange()
      before.setStart(range.endContainer, range.endOffset)
      before.setEnd(gap.startContainer, gap.startOffset)
      const after = document.createRange()
      after.setStart(gap.endContainer, gap.endOffset)
      after.setEnd(range.startContainer, range.startOffset)
      return (!before.collapsed && before.toString() === '') || (!after.collapsed && after.toString() === '') ||
        range.compareBoundaryPoints(Range.START_TO_START, gap) === 0
    }
    return marks.some(touches)
  }, text)

/** The text either side of the caret, for failure reports. */
const caretContext = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return '(no selection)'
    const range = selection.getRangeAt(0)
    const root = document.querySelector('.editor-component')
    if (!root) return '(no editor)'
    const before = document.createRange()
    before.setStart(root, 0)
    before.setEnd(range.startContainer, range.startOffset)
    const after = document.createRange()
    after.setStart(range.endContainer, range.endOffset)
    after.setEnd(root, root.childNodes.length)
    return `${before.toString().slice(-40)}[${range.toString()}]${after.toString().slice(0, 40)}`
  })

/** Scrolls the first rendered occurrence of `text` into view, as a reader would before clicking it. */
const reveal = (page: Page, text: string): Promise<void> =>
  page.evaluate(text => {
    const root = document.querySelector('.editor-component')
    const walker = root ? document.createTreeWalker(root, NodeFilter.SHOW_TEXT) : undefined
    while (walker?.nextNode()) {
      if (walker.currentNode.textContent?.includes(text)) {
        walker.currentNode.parentElement?.scrollIntoView({ block: 'center' })
        return
      }
    }
    throw new Error(`Rendered text not found: ${text}`)
  }, text)

const clickAt = async(page: Page, text: string, where: 'start' | 'end' | number): Promise<void> => {
  await reveal(page, text)
  await clickText(page, text, where)
}

const renderedMark = (page: Page, kind: string, text: string) =>
  page.locator(`.editor-component [data-critic-kind="${kind}"]`).filter({ hasText: text })

// ---------------------------------------------------------------------------
// The shared session

interface Session {
  app: ElectronApplication
  page: Page
  root: string
  annotated: string
  ordinary: string
}

let current: Session | undefined

async function session(): Promise<Session> {
  if (current !== undefined) return current
  const root = scratchRoot()
  const annotated = writeFixture(root, 'annotated.md', ANNOTATED)
  const ordinary = writeFixture(root, 'ordinary.md', ORDINARY)
  const { app, page } = await launch(path.join(root, 'profile'), [annotated, ordinary])
  current = { app, page, root, annotated, ordinary }
  await captureContextMenu(app)
  await selectTab(page, annotated)
  return current
}

async function retireSession(): Promise<void> {
  const ended = current
  current = undefined
  if (ended !== undefined) await closeApp(ended.app)
}

/** A step leaves both documents saved at their baselines, or retires the session. */
async function expectBaseline(s: Session): Promise<void> {
  await expect(s.page.locator('.tabs-container li.unsaved')).toHaveCount(0)
  expect(fs.readFileSync(s.annotated, 'utf8')).toBe(ANNOTATED)
  expect(fs.readFileSync(s.ordinary, 'utf8')).toBe(ORDINARY)
  await expectNoRendererErrors(s.app)
  await expectEditorWindowHidden(s.app)
  expectEditorNotFrontmost(s.app)
}

test.afterEach(async() => {
  const info = test.info()
  if (info.status === info.expectedStatus) return
  const page = current?.page
  if (page !== undefined && !page.isClosed()) {
    const state = await Promise.all([
      source(page).catch(String),
      caretContext(page).catch(String),
      page.locator('.core-review-panel-content').innerText({ timeout: 1000 }).catch(String),
      page.locator('.editor-component').innerText({ timeout: 1000 }).catch(String)
    ])
    const report = info.outputPath('editorial-state.json')
    fs.writeFileSync(report, JSON.stringify({ source: state[0], caret: state[1], sidebar: state[2], editor: state[3] }, null, 2))
    await info.attach('editorial-state.json', { path: report, contentType: 'application/json' })
  }
  await retireSession()
})
test.afterAll(async() => {
  await retireSession()
  for (const root of scratchRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Authoring gestures and entry points

const AUTHORING = 'Authoring paragraph with plain words.'

interface Gesture {
  name: string
  /** The source a single-block selection covers; cross-block ones vary by layout. */
  selects?: string
  select(page: Page, app: ElectronApplication): Promise<void>
}

const gestures: Gesture[] = [
  {
    name: 'mouse drag',
    selects: 'paragraph with',
    async select(page) { await drag(page, await textPoint(page, 'paragraph with', 'start'), await textPoint(page, 'paragraph with', 'end')) }
  },
  {
    name: 'double-click',
    selects: 'plain',
    async select(page) { const at = await textPoint(page, 'plain words', 2); await page.mouse.dblclick(at.x, at.y) }
  },
  {
    name: 'triple-click',
    selects: AUTHORING,
    async select(page) { const at = await textPoint(page, 'plain words', 2); await page.mouse.click(at.x, at.y, { clickCount: 3 }) }
  },
  {
    name: 'Shift+arrows',
    selects: 'plain',
    async select(page) {
      await clickAt(page, 'plain words', 'start')
      for (let step = 0; step < 5; step++) await page.keyboard.press('Shift+ArrowRight')
    }
  },
  {
    name: 'Shift+⌘→',
    selects: 'plain words.',
    async select(page) { await clickAt(page, 'plain words', 'start'); await page.keyboard.press('Shift+Meta+ArrowRight') }
  },
  {
    name: 'Shift+↓ across paragraphs',
    async select(page) { await clickAt(page, 'paragraph with', 3); await page.keyboard.press('Shift+ArrowDown') }
  },
  {
    name: 'cross-paragraph drag',
    async select(page) { await drag(page, await textPoint(page, 'paragraph with', 'start'), await textPoint(page, 'paragraph here', 4)) }
  },
  {
    name: 'Edit → Select All',
    selects: AUTHORING,
    async select(page, app) { await clickAt(page, 'paragraph with', 3); await menu(app, 'Edit', 'Select All') }
  }
]

const entryPoints = ['floating toolbar', 'context menu', 'Review menu', 'command palette', 'Add Comment shortcut'] as const
type EntryPoint = typeof entryPoints[number]

const paletteLabels: Record<AuthoringForm, string> = {
  'add-comment': 'Review: Add Comment',
  'mark-highlight': 'Review: Highlight for Review',
  'mark-addition': 'Review: Mark as Addition',
  'suggest-replacement': 'Review: Suggest Replacement'
}

const wrapping: Record<AuthoringForm, { open: string; close: string; kind: string; composer?: { testId: string; text: string } }> = {
  'add-comment': { open: '{==', close: '==}{>>Pass note<<}', kind: 'highlight', composer: { testId: 'critic-review-comment', text: 'Pass note' } },
  'mark-highlight': { open: '{==', close: '==}', kind: 'highlight' },
  'mark-addition': { open: '{++', close: '++}', kind: 'addition' },
  'suggest-replacement': { open: '{~~', close: '~>REPLACED~~}', kind: 'substitution', composer: { testId: 'critic-review-replacement', text: 'REPLACED' } }
}

/** The baseline slice `saved` wraps in `form`'s markup, when it wraps exactly one. */
const wrappedSlice = (saved: string, form: AuthoringForm): string | undefined => {
  let start = 0
  while (start < saved.length && saved[start] === ANNOTATED[start]) start++
  const { open, close } = wrapping[form]
  if (!saved.startsWith(open, start)) return undefined
  const end = saved.indexOf(close, start + open.length)
  if (end < 0) return undefined
  const slice = saved.slice(start + open.length, end)
  const rebuilt = ANNOTATED.slice(0, start) + open + slice + close + ANNOTATED.slice(start + slice.length)
  return slice !== '' && saved === rebuilt ? slice : undefined
}

async function invokeEntry(app: ElectronApplication, page: Page, entryPoint: EntryPoint, form: AuthoringForm): Promise<void> {
  switch (entryPoint) {
    case 'floating toolbar':
      await expect.poll(async() => {
        const state = await toolbarState(page)
        return state.visible && state.review.includes(`${form}:on`)
      }, { message: `toolbar offers ${form}` }).toBe(true)
      await page.locator(`.mu-format-picker [data-action="${form}"]`).click()
      return
    case 'context menu': {
      const point = await selectionPoint(page)
      if (!point) throw new Error('No selection to right-click')
      await resetContextMenu(app)
      await page.mouse.click(point.x, point.y, { button: 'right' })
      await expect.poll(async() => (await contextMenuItems(app))?.[`critic-${form}`]).toBe(true)
      await clickContextMenu(app, `critic-${form}`)
      return
    }
    case 'Review menu':
      await clickReviewMenu(app, form)
      return
    case 'command palette': {
      await menu(app, 'View', 'Command Palette')
      const input = page.locator('.command-palette input.search')
      await input.waitFor({ state: 'visible' })
      await input.pressSequentially(paletteLabels[form])
      await expect(page.locator('.command-palette li').first()).toContainText(paletteLabels[form])
      await page.keyboard.press('Enter')
      return
    }
    case 'Add Comment shortcut':
      await nativeKey(app, 'M', ['meta', 'alt', 'shift'])
  }
}

// ---------------------------------------------------------------------------
// 1–2. Open the documents; find the comments

test.describe('installed editorial pass', () => {
  test.describe.configure({ timeout: 240_000 })

  test('1. opens an annotated and an ordinary document in two tabs and renders every form', async() => {
    const s = await session()
    const { page } = s
    await expect(page.locator('.tabs-container li')).toHaveCount(2)
    expect(await source(page)).toBe(ANNOTATED)

    // All five forms, pairs, nested and cross-block suggestions render in place.
    await expect(renderedMark(page, 'addition', 'an added phrase')).not.toHaveCount(0)
    await expect(renderedMark(page, 'deletion', 'a removed phrase')).not.toHaveCount(0)
    await expect(page.locator('.editor-component [data-critic-kind="substitution"][data-critic-arm="old"]').filter({ hasText: 'old wording' })).not.toHaveCount(0)
    await expect(page.locator('.editor-component [data-critic-kind="substitution"][data-critic-arm="new"]').filter({ hasText: 'new wording' })).not.toHaveCount(0)
    await expect(renderedMark(page, 'highlight', 'a highlighted claim')).not.toHaveCount(0)
    await expect(renderedMark(page, 'highlight', 'checked figure')).not.toHaveCount(0)
    await expect(renderedMark(page, 'addition', 'inner addition')).not.toHaveCount(0)
    await expect(renderedMark(page, 'deletion', 'start of removal')).not.toHaveCount(0)
    await expect(renderedMark(page, 'deletion', 'end of removal')).not.toHaveCount(0)
    await expect(renderedMark(page, 'addition', 'list addition')).not.toHaveCount(0)
    await expect(renderedMark(page, 'addition', 'footnote addition')).not.toHaveCount(0)
    await expect(page.locator('.editor-component table').first()).toContainText('two')
    // Comment payloads are hidden behind their markers, not document text.
    await expect(page.locator('.editor-component .mu-critic-comment-marker')).toHaveCount(4)
    await expect(page.locator('.editor-component')).not.toContainText('Standalone remark.')
    await expect(page.locator('.editor-component li').first()).toContainText('first item with list addition')
    await expect(page.locator('.editor-component pre, .editor-component .mu-code-block').first()).toContainText('const answer = 42')
    await expect(page.locator('.editor-component .katex').first()).toBeAttached()

    await selectTab(page, s.ordinary)
    expect(await source(page)).toBe(ORDINARY)
    await expect(page.locator('.editor-component h1')).toContainText('Field notes')
    await expect(page.locator('.editor-component em')).toContainText('emphasis')
    await expect(page.locator('.editor-component table')).toHaveCount(1)
    await expect(page.locator('.editor-component [data-critic-kind]')).toHaveCount(0)
    await selectTab(page, s.annotated)
    await expectBaseline(s)
  })

  test('2. finds the comments in the Comments and Suggestions sidebar tab and reads their bodies', async() => {
    const s = await session()
    const { app, page } = s
    await hideSidebar(app, page)
    await openReviewTab(app, page)
    const list = page.getByTestId('critic-review-list')
    for (const name of [
      'Addition: an added phrase',
      'Deletion: a removed phrase',
      'Replacement: old wording → new wording',
      'Highlight: a highlighted claim',
      'Comment: checked figure',
      'Addition: list addition',
      'Replacement: one → two',
      'Addition: footnote addition'
    ]) await expect(entry(page, name), name).toHaveCount(1)
    await expect(entry(page, /^Deletion: start of removal/)).toHaveCount(1)
    const bodies = list.locator('.core-review-comment')
    // A Comment body reads in its Markup reading (documentCore.projectComment
    // 'markup'): a suggestion nested in it shows as a suggestion.
    for (const body of ['Verify this figure.', 'Standalone remark.', 'Nested pair note.', 'Comment with nested deletion inside.']) {
      await expect(bodies.filter({ hasText: body }), body).toHaveCount(1)
    }
    const nestedDeletion = bodies.getByRole('deletion').filter({ hasText: 'nested deletion' })
    await expect(nestedDeletion).toHaveCount(1)
    await expect(nestedDeletion).toHaveCSS('text-decoration-line', 'line-through')
    await expect(entry(page, 'Addition: inner addition')).toHaveCount(1)
    // A commented passage shows its nested suggestion marked, as the editor does.
    const nestedPair = entry(page, 'Comment: outer inner addition mark')
    await expect(nestedPair).toHaveCount(1)
    await expect(nestedPair.getByRole('insertion')).toHaveText('inner addition')
    await expect(entry(page, /^Deletion: start of removal end of removal/)).toHaveCount(1)
    // Selecting an entry reveals its target and keeps the sidebar consistent.
    await entry(page, 'Deletion: a removed phrase').click()
    await expect(entry(page, 'Deletion: a removed phrase')).toHaveAttribute('aria-pressed', 'true')
    // The sidebar keeps focus; the target is scrolled to and marked as current.
    const target = renderedMark(page, 'deletion', 'a removed phrase').first()
    await expect(target).toHaveClass(/core-review-current-block/)
    await expect(target).toBeInViewport()
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'deletion')
    // A click on an annotation selects its entry.
    await clickAt(page, 'new wording', 3)
    await expect(entry(page, 'Replacement: old wording → new wording')).toHaveAttribute('aria-pressed', 'true')
    expect(await source(page)).toBe(ANNOTATED)
    // Excerpts show recognizable text, never CriticMarkup delimiters.
    expect(await list.innerText()).not.toMatch(CRITIC_MARKER)
    await expectBaseline(s)
  })

  // ---------------------------------------------------------------------------
  // 3. Author through every selection gesture × entry point × form

  for (const gesture of gestures) {
    test(`3. authors after ${gesture.name} through every entry point, then ⌘Z restores the bytes`, async() => {
      const s = await session()
      const { app, page } = s
      const slices = new Set<string>()
      for (const entryPoint of entryPoints) {
        for (const form of authoringForms) {
          if (entryPoint === 'Add Comment shortcut' && form !== 'add-comment') continue
          const label = `${gesture.name} → ${entryPoint} → ${form}`
          await clickAt(page, 'hello world', 'end')
          await expect.poll(async() => (await menuStates(app, [form]))[form], { message: `${label}: collapsed` }).toBe(false)
          await gesture.select(page, app)
          await expect.poll(async() => (await menuStates(app, [form]))[form], { message: `${label}: selected` }).toBe(true)
          await invokeEntry(app, page, entryPoint, form)
          const composer = wrapping[form].composer
          if (composer) {
            const input = page.getByTestId(`${composer.testId}-input`)
            await expect(input, label).toBeFocused()
            await input.fill(composer.text)
            await page.getByTestId(`${composer.testId}-submit`).click()
          }
          await expect.poll(() => source(page), { message: label }).not.toBe(ANNOTATED)
          await settled(page)
          const saved = (await source(page))!
          await expectSaved(app, s.annotated, saved)
          const slice = wrappedSlice(saved, form)
          expect(slice, `${label}: ${JSON.stringify(saved.slice(ANNOTATED.indexOf('Authoring') - 2, ANNOTATED.indexOf('Tracked')))}`).toBeDefined()
          if (gesture.selects !== undefined) expect(slice, label).toBe(gesture.selects)
          slices.add(slice!)
          const firstWord = slice!.split(/\s/)[0]!
          await expect(renderedMark(page, wrapping[form].kind, firstWord), `${label}: rendered`).not.toHaveCount(0)
          await nativeKey(app, 'Z', ['meta'])
          await expectSaved(app, s.annotated, ANNOTATED)
        }
      }
      // Every entry point and form addresses the same selected source.
      expect([...slices]).toHaveLength(1)
      await expectBaseline(s)
    })
  }

  test('3b. adds a comment to an existing highlight and edits it in its card composer with ⌘Enter and Esc', async() => {
    const s = await session()
    const { app, page } = s
    await openReviewTab(app, page)
    await entry(page, 'Highlight: a highlighted claim').click()
    await page.getByTestId('critic-review-add-comment').click()
    const input = page.getByTestId('critic-review-comment-input')
    await expect(input).toBeFocused()
    await input.pressSequentially('Needs a source')
    await page.keyboard.press('Meta+Enter')
    await expect(input).toHaveCount(0)
    const commented = edited(ANNOTATED, ['{==a highlighted claim==}', '{==a highlighted claim==}{>>Needs a source<<}'])
    await expectSaved(app, s.annotated, commented)
    await expect(page.getByTestId('critic-review-list').locator('.core-review-comment').filter({ hasText: 'Needs a source' })).toHaveCount(1)

    // Esc abandons an edit; ⌘Enter commits the next one.
    await entry(page, 'Comment: a highlighted claim').click()
    await page.getByTestId('critic-review-edit-comment').click()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Needs a source')
    await input.fill('Abandoned edit')
    await page.keyboard.press('Escape')
    await expect(input).toHaveCount(0)
    await expectSaved(app, s.annotated, commented)
    await entry(page, 'Comment: a highlighted claim').click()
    await page.getByTestId('critic-review-edit-comment').click()
    await expect(input).toHaveValue('Needs a source')
    await input.fill('Needs two sources')
    await page.keyboard.press('Meta+Enter')
    await expect(input).toHaveCount(0)
    await expectSaved(app, s.annotated, edited(ANNOTATED, ['{==a highlighted claim==}', '{==a highlighted claim==}{>>Needs two sources<<}']))
    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, s.annotated, commented)
    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, s.annotated, ANNOTATED)
    await expectBaseline(s)
  })

  // ---------------------------------------------------------------------------
  // 4. Track Changes

  test('4. Track Changes records typing, Backspace, Enter, paste and bold the way Google Docs does', async() => {
    const s = await session()
    const { app, page } = s
    const clipboard = preserveSystemClipboard()
    const tracked = (to: string) => edited(ANNOTATED, ['Tracked paragraph hello world.', to])
    const press = async(key: string, times = 1) => {
      for (let step = 0; step < times; step++) {
        await page.keyboard.press(key)
        await settled(page)
      }
    }
    const afterHello = () => clickAt(page, 'hello world', 5)
    try {
      // ⌘⇧E turns tracking on; the title bar and the Review menu show it.
      await clickAt(page, 'hello world', 'end')
      await nativeKey(app, 'E', ['meta', 'shift'])
      await expect(page.getByTestId('title-bar-tracking')).toBeVisible()
      await expect.poll(() => reviewMenuChecked(app, 'track-changes')).toBe(true)

      // Repeated Backspace strikes leftward as one deletion.
      await afterHello()
      await press('Backspace', 3)
      await expectSaved(app, s.annotated, tracked('Tracked paragraph he{--llo--} world.'))
      await expect(renderedMark(page, 'deletion', 'llo')).not.toHaveCount(0)
      // Backspace with struck text beside the caret moves over it, then extends.
      await press('Backspace', 1)
      await expectSaved(app, s.annotated, tracked('Tracked paragraph h{--ello--} world.'))
      // Typing before the struck text merges into one Replacement.
      await page.keyboard.type('ZY')
      await settled(page)
      await expectSaved(app, s.annotated, tracked('Tracked paragraph h{~~ello~>ZY~~} world.'))
      // Accept and Reject resolve it.
      await clickReviewMenu(app, 'accept')
      await expectSaved(app, s.annotated, tracked('Tracked paragraph hZY world.'))
      await menu(app, 'Edit', 'Undo')
      await expectSaved(app, s.annotated, tracked('Tracked paragraph h{~~ello~>ZY~~} world.'))
      await clickAt(page, 'ZY', 1)
      await clickReviewMenu(app, 'reject')
      await expectSaved(app, s.annotated, ANNOTATED)
      await expect(page.getByTestId('title-bar-tracking')).toBeVisible()

      // Typing inside struck text splits the deletion.
      await afterHello()
      await press('Backspace', 3)
      await press('ArrowRight', 1)
      await page.keyboard.type('X')
      await settled(page)
      await expectSaved(app, s.annotated, tracked('Tracked paragraph he{--l--}{++X++}{--lo--} world.'))
      await undoTo(app, page, ANNOTATED, 'key')

      // Bold over struck text changes nothing there.
      await afterHello()
      await press('Backspace', 3)
      await press('Shift+ArrowRight', 3)
      await nativeKey(app, 'B', ['meta'])
      await settled(page)
      await expectSaved(app, s.annotated, tracked('Tracked paragraph he{--llo--} world.'))
      await undoTo(app, page, ANNOTATED, 'menu')

      // Enter then typing is one Addition.
      await clickAt(page, 'paragraph hello', 'start')
      await press('Enter')
      await page.keyboard.type('ab')
      await settled(page)
      await expectSaved(app, s.annotated, tracked('Tracked {++\n\nab++}paragraph hello world.'))
      await undoTo(app, page, ANNOTATED, 'key')

      // Paste through Edit → Paste is one Addition.
      await app.evaluate(({ clipboard }) => clipboard.writeText('PASTED'))
      clipboard.rememberOwnedWrite('PASTED')
      await clickAt(page, 'hello world', 'end')
      await menu(app, 'Edit', 'Paste')
      await settled(page)
      await expectSaved(app, s.annotated, tracked('Tracked paragraph hello world{++PASTED++}.'))
      await undoTo(app, page, ANNOTATED, 'menu')

      // In the document's own deletion, Backspace moves over struck text and
      // typing there splits the deletion around the Addition.
      await clickAt(page, 'a removed phrase', 5)
      await press('Backspace', 2)
      await page.keyboard.type('Q')
      await settled(page)
      await expectSaved(app, s.annotated, edited(ANNOTATED, ['{--a removed phrase--}', '{--a r--}{++Q++}{--emoved phrase--}']))
      await undoTo(app, page, ANNOTATED, 'key')

      // The title-bar indicator turns tracking off; typing is then plain.
      await page.getByTestId('title-bar-tracking').click()
      await expect(page.getByTestId('title-bar-tracking')).toHaveCount(0)
      await expect.poll(() => reviewMenuChecked(app, 'track-changes')).toBe(false)
      await clickAt(page, 'hello world', 'end')
      await page.keyboard.type('!')
      await settled(page)
      await expectSaved(app, s.annotated, tracked('Tracked paragraph hello world!.'))
      await undoTo(app, page, ANNOTATED, 'key')
      await expectSaved(app, s.annotated, ANNOTATED)
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await expectBaseline(s)
    } finally {
      clipboard.restore()
    }
  })

  // ---------------------------------------------------------------------------
  // 5. Navigate, resolve, undo and redo

  test('5a. Next and Previous move the caret to each item without opening the sidebar', async() => {
    const s = await session()
    const { app, page } = s
    await hideSidebar(app, page)
    const at = (text: string) => expect.poll(() => selectionTouches(page, text), {
      message: `the caret reaches "${text}"`
    }).toBe(true)
    await clickAt(page, 'Editorial pass', 'start')
    await clickReviewMenu(app, 'next')
    await at('an added phrase')
    await clickReviewMenu(app, 'next')
    await at('a removed phrase')
    await clickReviewMenu(app, 'previous')
    await at('an added phrase')
    // The keyboard shortcuts ⌘⌥] and ⌘⌥[ reach the same commands.
    await nativeKey(app, ']', ['meta', 'alt'])
    await at('a removed phrase')
    await nativeKey(app, ']', ['meta', 'alt'])
    await at('old wording')
    await nativeKey(app, '[', ['meta', 'alt'])
    await at('a removed phrase')
    expect((await sidebarState(page)).shown).toBe(false)
    // The caret stays in the document: typing lands there and undoes.
    expect(await page.evaluate(() => !!document.activeElement?.closest('.editor-component'))).toBe(true)
    expect(await source(page)).toBe(ANNOTATED)
    await expectBaseline(s)
  })

  test('5b. resolves items from card buttons, the context menu and the Review menu, with ⌘Z/⇧⌘Z and Edit menu history', async() => {
    const s = await session()
    const { app, page } = s
    await openReviewTab(app, page)

    // Card button: Accept an Addition.
    const accepted = edited(ANNOTATED, ['{++an added phrase++}', 'an added phrase'])
    await entry(page, 'Addition: an added phrase').click()
    await page.getByTestId('critic-review-accept').click()
    await expectSaved(app, s.annotated, accepted)
    await expect(renderedMark(page, 'addition', 'an added phrase')).toHaveCount(0)
    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, s.annotated, ANNOTATED)
    await nativeKey(app, 'Z', ['meta', 'shift'])
    await expectSaved(app, s.annotated, accepted)
    await menu(app, 'Edit', 'Undo')
    await expectSaved(app, s.annotated, ANNOTATED)
    await expect(renderedMark(page, 'addition', 'an added phrase')).not.toHaveCount(0)

    // Context menu: Reject a Deletion.
    const rejected = edited(ANNOTATED, ['{--a removed phrase--}', 'a removed phrase'])
    await clickAt(page, 'a removed phrase', 4)
    await resetContextMenu(app)
    const at = await textPoint(page, 'a removed phrase', 4)
    await page.mouse.click(at.x, at.y, { button: 'right' })
    await expect.poll(async() => (await contextMenuItems(app))?.['critic-reject']).toBe(true)
    await clickContextMenu(app, 'critic-reject')
    await expectSaved(app, s.annotated, rejected)
    await menu(app, 'Edit', 'Undo')
    await expectSaved(app, s.annotated, ANNOTATED)
    await menu(app, 'Edit', 'Redo')
    await expectSaved(app, s.annotated, rejected)
    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, s.annotated, ANNOTATED)

    // Review menu: Accept a Replacement at the caret.
    await clickAt(page, 'new wording', 3)
    await clickReviewMenu(app, 'accept')
    await expectSaved(app, s.annotated, edited(ANNOTATED, ['{~~old wording~>new wording~~}', 'new wording']))
    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, s.annotated, ANNOTATED)

    // Card button: Remove a standalone Comment.
    await page.getByTestId('critic-review-entry').filter({ hasText: 'Standalone remark.' }).getByRole('button').first().click()
    await page.getByTestId('critic-review-remove').click()
    await expectSaved(app, s.annotated, edited(ANNOTATED, ['{>>Standalone remark.<<}', '']))
    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, s.annotated, ANNOTATED)

    // Card button: Accept All; Review menu: Reject All.
    await entry(page, 'Addition: an added phrase').click()
    await page.getByTestId('critic-review-accept-all').click()
    await expectSaved(app, s.annotated, ACCEPTED_ALL)
    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, s.annotated, ANNOTATED)
    await nativeKey(app, 'Z', ['meta', 'shift'])
    await expectSaved(app, s.annotated, ACCEPTED_ALL)
    await menu(app, 'Edit', 'Undo')
    await expectSaved(app, s.annotated, ANNOTATED)
    await clickReviewMenu(app, 'reject-all')
    await expectSaved(app, s.annotated, REJECTED_ALL)
    await menu(app, 'Edit', 'Undo')
    await expectSaved(app, s.annotated, ANNOTATED)
    await expectBaseline(s)
  })

  // ---------------------------------------------------------------------------
  // 6. Views

  test('6. switches Markup → Original → Revised and Source and back without changing the source', async() => {
    const s = await session()
    const { app, page } = s
    const banner = page.getByTestId('core-reader-banner')
    await clickReviewMenu(app, 'original')
    await expect(banner).toContainText('Original — read-only')
    const original = page.locator('[data-projection="original"]')
    await expect(original).toBeVisible()
    await expect(original).toContainText('a removed phrase')
    await expect(original).toContainText('old wording')
    await expect(original).not.toContainText('an added phrase')
    await expect(page.locator('.editor-surface')).toBeHidden()
    await expect.poll(() => reviewMenuChecked(app, 'original')).toBe(true)

    await clickReviewMenu(app, 'revised')
    await expect(banner).toContainText('Revised — read-only')
    const revised = page.locator('[data-projection="revised"]')
    await expect(revised).toBeVisible()
    await expect(revised).toContainText('an added phrase')
    await expect(revised).toContainText('new wording')
    await expect(revised).not.toContainText('a removed phrase')
    await expect(original).toHaveCount(0)
    await expect.poll(() => reviewMenuChecked(app, 'revised')).toBe(true)

    await page.getByTestId('core-reader-banner-markup').click()
    await expect(banner).toHaveCount(0)
    await expect(page.locator('.editor-surface')).toBeVisible()
    await expect.poll(() => reviewMenuChecked(app, 'markup')).toBe(true)
    expect(await source(page)).toBe(ANNOTATED)

    await enterSourceMode(page, app)
    const codeMirror = await page.evaluate(() => (document.querySelector('.source-code .CodeMirror') as Element & {
      CodeMirror: { getValue(): string }
    }).CodeMirror.getValue())
    expect(codeMirror).toBe(ANNOTATED)
    await exitSourceMode(page, app)
    expect(await source(page)).toBe(ANNOTATED)
    await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)

    // Editing resumes in Markup.
    await clickAt(page, 'hello world', 'end')
    await page.keyboard.type('!')
    await settled(page)
    await expectSaved(app, s.annotated, edited(ANNOTATED, ['hello world.', 'hello world!.']))
    await nativeKey(app, 'Z', ['meta'])
    await expectSaved(app, s.annotated, ANNOTATED)
    await expectBaseline(s)
  })

  // ---------------------------------------------------------------------------
  // 7. Ordinary Markdown in the second tab; tab isolation

  test('7a. ordinary Markdown edits save as upstream does, isolated from the annotated tab', async() => {
    // A fresh session, so the annotated tab's ⌘Z and ⇧⌘Z below meet no history
    // that earlier steps left there.
    await retireSession()
    const s = await session()
    const { app, page } = s
    await selectTab(page, s.ordinary)
    const end = async(locator: string, text: string) => {
      await page.locator(locator).filter({ hasText: text }).first().click()
      await page.keyboard.press('Meta+ArrowRight')
    }
    await end('.editor-component .mu-atxheading-content', 'Field notes')
    await page.keyboard.type(' today')
    await end('.editor-component li .mu-paragraph-content', 'second')
    await page.keyboard.press('Enter')
    await page.keyboard.type('third')
    await end('.editor-component .mu-table-cell-content', 'b')
    await page.keyboard.type('c')
    const codeEnd = await page.evaluate(() => {
      const code = document.querySelector('.editor-component .mu-code-block code, .editor-component .mu-code-block .mu-codeblock-content')
      const walker = code ? document.createTreeWalker(code, NodeFilter.SHOW_TEXT) : undefined
      let last: Node | null = null
      while (walker?.nextNode()) if (walker.currentNode.textContent?.trim()) last = walker.currentNode
      if (last === null) return null
      const range = document.createRange()
      range.setStart(last, last.textContent!.length - 1)
      range.setEnd(last, last.textContent!.length)
      const rect = range.getBoundingClientRect()
      return { x: rect.right - 0.5, y: rect.top + rect.height / 2 }
    })
    if (codeEnd === null) throw new Error('The code block is not rendered')
    await page.mouse.click(codeEnd.x, codeEnd.y)
    await nextFrame(page)
    await page.keyboard.type('0')
    await end('.editor-component .mu-paragraph-content', 'Some')
    await page.keyboard.type(' See [docs](https://docs.example.com).')
    await settled(page)
    const expected = [
      '# Field notes today',
      '',
      'Some *emphasis* and a [link](https://example.com). See [docs](https://docs.example.com).',
      '',
      '- first',
      '- second',
      '- third',
      '',
      '| Left | Right |',
      '|:-----|------:|',
      '| a    | bc     |',
      '',
      '```js',
      'const x = 10',
      '```',
      ''
    ].join('\n')
    await expectSaved(app, s.ordinary, expected)
    await expect(page.locator('.editor-component h1')).toContainText('Field notes today')
    await expect(page.locator('.editor-component li')).toHaveCount(3)
    await expect(page.locator('.editor-component .mu-link[data-raw="[docs](https://docs.example.com)"]')).toHaveCount(1)

    // The annotated tab kept its bytes and history; its ⌘Z does not reach here.
    expect(fs.readFileSync(s.annotated, 'utf8')).toBe(ANNOTATED)
    await expect(tab(page, s.annotated)).not.toHaveClass(/unsaved/)
    await selectTab(page, s.annotated)
    expect(await source(page)).toBe(ANNOTATED)
    await clickAt(page, 'hello world', 'end')
    await nativeKey(app, 'Z', ['meta'])
    await settled(page)
    await nativeKey(app, 'Z', ['meta', 'shift'])
    await settled(page)
    expect(await source(page)).toBe(ANNOTATED)
    await expectSaved(app, s.annotated, ANNOTATED)
    await selectTab(page, s.ordinary)
    expect(await source(page)).toBe(expected)
    await undoTo(app, page, ORDINARY, 'menu')
    await expectSaved(app, s.ordinary, ORDINARY)
    await selectTab(page, s.annotated)
    await expectBaseline(s)
  })

  test('7b. saves, closes and reopens the annotated document with exact bytes', async() => {
    const s = await session()
    const { app, page } = s
    await captureContextMenu(app)
    const point = await textPoint(page, 'plain words', 2)
    await page.mouse.dblclick(point.x, point.y)
    await expect.poll(async() => (await menuStates(app, ['add-comment']))['add-comment']).toBe(true)
    await nativeKey(app, 'M', ['meta', 'alt', 'shift'])
    const input = page.getByTestId('critic-review-comment-input')
    await expect(input).toBeFocused()
    await input.fill('Reopen note')
    await page.keyboard.press('Meta+Enter')
    const saved = edited(ANNOTATED, ['with plain words', 'with {==plain==}{>>Reopen note<<} words'])
    await expectSaved(app, s.annotated, saved)
    await expect(tab(page, s.annotated)).not.toHaveClass(/unsaved/)

    await menu(app, 'File', 'Close Tab')
    await expect(tab(page, s.annotated)).toHaveCount(0)
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async() => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
    }, s.annotated)
    await menu(app, 'File', 'Open File')
    await expect(tab(page, s.annotated)).toHaveClass(/active/)
    await waitForEditor(page)
    await expect.poll(() => source(page)).toBe(saved)
    await expect(renderedMark(page, 'highlight', 'plain')).not.toHaveCount(0)
    await openReviewTab(app, page)
    await expect(page.getByTestId('critic-review-list').locator('.core-review-comment').filter({ hasText: 'Reopen note' })).toHaveCount(1)
    await expectSaved(app, s.annotated, saved)
    await expectNoRendererErrors(app)
    await retireSession()
  })
})

// ---------------------------------------------------------------------------
// 7–8. Byte fidelity and lifecycle

test.describe('installed editorial pass: lifecycle and recovery', () => {
  test.describe.configure({ timeout: 180_000 })

  test('7c. a save without edits keeps CRLF and BOM bytes of an annotated document', async() => {
    const root = scratchRoot()
    const bytes = Buffer.from('﻿# Title\r\n\r\nKeep {++added++} {~~old~>new~~}\r\n\r\n{==a==}{>>n<<}\r\n', 'utf8')
    const file = writeFixture(root, 'crlf.md', bytes)
    const past = new Date('2001-01-01T00:00:00Z')
    fs.utimesSync(file, past, past)
    const { app, page } = await launch(path.join(root, 'profile'), [file])
    try {
      await expect(renderedMark(page, 'addition', 'added')).not.toHaveCount(0)
      await menu(app, 'File', 'Save')
      await expect.poll(() => fs.statSync(file).mtimeMs, { timeout: 15_000 }).toBeGreaterThan(past.getTime() + 1000)
      expect(fs.readFileSync(file).equals(bytes)).toBe(true)
    } finally {
      await closeApp(app)
    }
  })

  test('8a. closing a tab or the window with an open comment composer asks Discard or Cancel', async() => {
    const root = scratchRoot()
    const file = writeFixture(root, 'annotated.md', ANNOTATED)
    const { app, page } = await launch(path.join(root, 'profile'), [file])
    let exited = false
    try {
      const at = await textPoint(page, 'plain words', 2)
      await page.mouse.dblclick(at.x, at.y)
      await clickReviewMenu(app, 'add-comment')
      const input = page.getByTestId('critic-review-comment-input')
      await input.fill('Unsubmitted thought')
      await answerMessageBoxes(app, 1)
      await menu(app, 'File', 'Close Tab')
      await expect.poll(() => prompts(app)).toEqual([expect.stringContaining('comment')])
      await expect(tab(page, file)).toHaveCount(1)
      await expect(input).toHaveValue('Unsubmitted thought')
      await answerMessageBoxes(app, 1)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
      await expect.poll(() => prompts(app)).toEqual([expect.stringContaining('comment')])
      await expect(input).toHaveValue('Unsubmitted thought')
      await expectNoRendererErrors(app)
      await answerMessageBoxes(app, 0)
      const closed = new Promise<void>(resolve => app.once('close', () => resolve()))
      await menu(app, 'File', 'Close Tab')
      await expect(tab(page, file)).toHaveCount(0)
      expect(fs.readFileSync(file, 'utf8')).toBe(ANNOTATED)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
      await closed
      exited = true
    } finally {
      if (!exited) await closeApp(app)
    }
  })

  test('8b. window close keeps unsaved work for restore by default, and otherwise asks to save before closing or quitting', async() => {
    const root = scratchRoot()
    const profile = path.join(root, 'profile')
    const file = writeFixture(root, 'annotated.md', ANNOTATED)
    const typed = edited(ANNOTATED, ['hello world.', 'hello world!.'])
    const first = await launch(profile, [file])
    let app = first.app
    let exited = false
    try {
      await clickAt(first.page, 'hello world', 'end')
      await first.page.keyboard.type('!')
      await settled(first.page)
      await expect(tab(first.page, file)).toHaveClass(/unsaved/)
      // Under the default Restore All start-up, closing the last window keeps
      // the unsaved tab for the next launch without asking (upstream behaviour).
      await answerMessageBoxes(app, 2)
      let child = app.process()
      await menu(app, 'File', 'Close Window')
      await expect.poll(() => child.exitCode, { timeout: 20_000 }).toBe(0)
      await app.close().catch(() => {})
      expect(fs.readFileSync(file, 'utf8')).toBe(ANNOTATED)

      const second = await launch(profile, [])
      app = second.app
      const page = second.page
      await expect(tab(page, file)).toHaveClass(/unsaved/)
      await expect.poll(() => source(page)).toBe(typed)
      await page.evaluate(() => {
        window.electron.ipcRenderer.send('mt::set-user-preference', { startUpAction: 'blank' })
      })
      // Otherwise Close Window asks, and Cancel keeps the window and the edit.
      await answerMessageBoxes(app, 2)
      await menu(app, 'File', 'Close Window')
      await expect.poll(() => prompts(app)).toEqual([expect.stringContaining('Save changes')])
      await expect(tab(page, file)).toHaveClass(/unsaved/)
      expect(fs.readFileSync(file, 'utf8')).toBe(ANNOTATED)
      await expectNoRendererErrors(app)
      // Quit → Save writes the edit and exits.
      await answerMessageBoxes(app, 0)
      child = app.process()
      await menu(app, 'MarkText', 'Quit MarkText')
      await expect.poll(() => child.exitCode, { timeout: 20_000 }).toBe(0)
      exited = true
      expect(fs.readFileSync(file, 'utf8')).toBe(typed)
    } finally {
      if (exited) await app.close().catch(() => {})
      else await closeApp(app)
    }
  })

  test('8c. after a crash, restart restores the unsaved annotated draft and its recovery backup', async() => {
    const root = scratchRoot()
    const profile = path.join(root, 'profile')
    const file = writeFixture(root, 'annotated.md', ANNOTATED)
    const first = await launch(profile, [file])
    const draft = edited(ANNOTATED, ['hello world.', 'hello world{++ crash++}.'])
    let restarted: ElectronApplication | undefined
    try {
      await clickAt(first.page, 'hello world', 'end')
      await clickReviewMenu(first.app, 'track-changes')
      await first.page.keyboard.type(' crash')
      await settled(first.page)
      expect(await source(first.page)).toBe(draft)
      // Wait for the window's recovery checkpoint, then kill the app outright.
      const checkpointed = () => {
        const stores = fs.readdirSync(profile, { recursive: true, encoding: 'utf8' })
          .filter(name => name.endsWith('_editor_buffer_store.json'))
        return stores.some(name => fs.readFileSync(path.join(profile, name), 'utf8').includes('{++ crash++}'))
      }
      await expect.poll(checkpointed, { timeout: 15_000 }).toBe(true)
      const child = first.app.process()
      child.kill('SIGKILL')
      await expect.poll(() => child.signalCode ?? child.exitCode, { timeout: 10_000 }).not.toBeNull()
      await first.app.close().catch(() => {})
      expect(fs.readFileSync(file, 'utf8')).toBe(ANNOTATED)

      // A backup a faulted session left behind is offered on the same restart.
      const backups = path.join(profile, 'core-recovery-drafts')
      fs.mkdirSync(backups, { recursive: true })
      const backupId = '00000000-0000-0000-0000-00000000c0de'
      fs.writeFileSync(path.join(backups, `${backupId}.json.pending`), JSON.stringify({
        id: backupId,
        createdAt: '2026-09-27T00:00:00.000Z',
        documentId: 'annotated.md',
        generation: 1,
        revision: 2,
        reason: 'Worker failure',
        visibleText: 'Recovered hello world'
      }), { flag: 'wx' })

      const second = await launch(profile, [])
      restarted = second.app
      const page = second.page
      await expect(tab(page, file)).toHaveClass(/unsaved/)
      await expect.poll(() => source(page)).toBe(draft)
      await expect(renderedMark(page, 'addition', 'crash')).not.toHaveCount(0)
      const drafts = page.getByTestId('core-recovery-draft')
      await expect(drafts).toHaveCount(1)
      await expect(drafts.getByRole('textbox', { name: 'Recovered draft text' })).toHaveValue('Recovered hello world')
      await drafts.getByRole('button', { name: 'I have recovered this draft' }).click()
      await expect(drafts).toHaveCount(0)
      await expectSaved(second.app, file, draft)
      await expect(tab(page, file)).not.toHaveClass(/unsaved/)
    } finally {
      if (restarted) await closeApp(restarted)
      else await first.app.close().catch(() => {})
    }
  })

  test('8d. a change on disk reloads the annotated document, its sidebar and history', async() => {
    const root = scratchRoot()
    const file = writeFixture(root, 'annotated.md', ANNOTATED)
    const { app, page } = await launch(path.join(root, 'profile'), [file])
    try {
      await openReviewTab(app, page)
      // File watching registers asynchronously after the document opens.
      await page.waitForTimeout(1500)
      const changed = edited(ANNOTATED, ['{++an added phrase++}', '{++a disk addition++}'])
      fs.writeFileSync(file, changed)
      await expect.poll(() => source(page), { timeout: 15_000 }).toBe(changed)
      await expect(tab(page, file)).not.toHaveClass(/unsaved/)
      await expect(renderedMark(page, 'addition', 'a disk addition')).not.toHaveCount(0)
      await expect(entry(page, 'Addition: a disk addition')).toHaveCount(1)
      await menu(app, 'Edit', 'Undo')
      await expect.poll(() => source(page)).toBe(ANNOTATED)
      await expect(tab(page, file)).toHaveClass(/unsaved/)
      await menu(app, 'Edit', 'Redo')
      await expect.poll(() => source(page)).toBe(changed)
      await expectSaved(app, file, changed)
    } finally {
      await closeApp(app)
    }
  })
})

// ---------------------------------------------------------------------------
// 9. Exports through the File menu and the installed pandoc

const PANDOC = spawnSync('sh', ['-c', 'command -v pandoc'], { encoding: 'utf8' }).stdout.trim()

test.describe('installed editorial pass: exports', () => {
  test.describe.configure({ timeout: 240_000 })

  test('9. exports both documents to HTML and PDF (Revised) and to Word through pandoc (tracked changes and comments)', async() => {
    expect(PANDOC, 'the installed pandoc on PATH').not.toBe('')
    const root = scratchRoot()
    const annotated = writeFixture(root, 'annotated.md', ANNOTATED)
    const ordinary = writeFixture(root, 'ordinary.md', ORDINARY)
    const out = path.join(root, 'out')
    fs.mkdirSync(out)
    const { app, page } = await launch(path.join(root, 'profile'), [annotated, ordinary])
    try {
      // Upstream (#5513) moved Pandoc conversion to its own File submenu,
      // shown only with this preference on.
      await page.evaluate(() => window.electron.ipcRenderer.send('mt::set-user-preference', { showPandocConvert: true }))
      await app.evaluate(({ dialog }, directory) => {
        ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async(
          _owner: unknown,
          options: { defaultPath?: string }
        ) => ({ canceled: false, filePath: `${directory}/${String(options?.defaultPath ?? 'export').split('/').pop()}` })
      }, out)
      const exportPrinted = async(label: 'Export as HTML' | 'Export as PDF') => {
        await menu(app, 'File', 'Export', label)
        const settings = page.locator('.print-settings-dialog .el-dialog')
        await expect(settings).toBeVisible({ timeout: 10_000 })
        await settings.locator('.button-primary').click()
        await expect(settings).toBeHidden({ timeout: 10_000 })
      }
      const exportAll = async(stem: string) => {
        await exportPrinted('Export as HTML')
        const htmlPath = path.join(out, `${stem}.html`)
        await expect.poll(() => fs.existsSync(htmlPath), { timeout: 30_000 }).toBe(true)
        await exportPrinted('Export as PDF')
        const pdfPath = path.join(out, `${stem}.pdf`)
        await expect.poll(() => fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 1000, { timeout: 30_000 }).toBe(true)
        await menu(app, 'File', 'Convert with Pandoc', 'Word (.docx)')
        const docxPath = path.join(out, `${stem}.docx`)
        await expect.poll(() => fs.existsSync(docxPath) && spawnSync('unzip', ['-t', docxPath]).status === 0, { timeout: 60_000 }).toBe(true)
        return {
          html: await page.evaluate(exportedDocumentText, fs.readFileSync(htmlPath, 'utf8')),
          rawHtml: fs.readFileSync(htmlPath, 'utf8'),
          pdf: execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' '),
          docx: execFileSync('unzip', ['-p', docxPath, 'word/document.xml'], { encoding: 'utf8' }),
          comments: spawnSync('unzip', ['-p', docxPath, 'word/comments.xml'], { encoding: 'utf8' }).stdout
        }
      }
      const runs = (xml: string, tag: 'ins' | 'del', textTag: string): string[] =>
        [...xml.matchAll(new RegExp(`<w:${tag} [^>]*>([\\s\\S]*?)</w:${tag}>`, 'g'))].map(match =>
          [...match[1]!.matchAll(new RegExp(`<w:${textTag}[^>]*>([^<]*)</w:${textTag}>`, 'g'))].map(text => text[1]).join(''))

      await selectTab(page, annotated)
      const reviewed = await exportAll('annotated')
      for (const text of [reviewed.html.replace(/\s+/g, ' '), reviewed.pdf]) {
        expect(text).toContain('Intro with an added phrase and here.')
        expect(text).toContain('Swap new wording then a highlighted claim end.')
        expect(text).toContain('Cross after.')
        expect(text).not.toContain('a removed phrase')
        expect(text).not.toContain('old wording')
        expect(text).not.toContain('Verify this figure.')
        expect(text).not.toMatch(CRITIC_MARKER)
      }
      expect(reviewed.rawHtml).not.toContain('Standalone remark.')
      expect(runs(reviewed.docx, 'ins', 't')).toEqual(expect.arrayContaining(['an added phrase', 'new wording', 'list addition', 'two']))
      expect(runs(reviewed.docx, 'del', 'delText')).toEqual(expect.arrayContaining(['a removed phrase', 'old wording', 'one']))
      expect(reviewed.docx).not.toMatch(CRITIC_MARKER)
      for (const comment of ['Verify this figure.', 'Standalone remark.', 'Nested pair note.']) {
        expect(reviewed.comments).toContain(comment)
      }

      await selectTab(page, ordinary)
      const plain = await exportAll('ordinary')
      for (const text of [plain.html.replace(/\s+/g, ' '), plain.pdf]) {
        expect(text).toContain('Field notes')
        expect(text).toContain('Some emphasis and a link.')
        expect(text).toContain('const x = 1')
      }
      expect(plain.rawHtml).toContain('<em>emphasis</em>')
      expect(plain.docx).toContain('<w:tbl>')
      expect(plain.docx).not.toMatch(/<w:ins |<w:del /)

      // Exporting never changes either document.
      expect(fs.readFileSync(annotated, 'utf8')).toBe(ANNOTATED)
      expect(fs.readFileSync(ordinary, 'utf8')).toBe(ORDINARY)
      await expect(page.locator('.tabs-container li.unsaved')).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })
})

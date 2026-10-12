import { expect, test, type TestInfo } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  enterSourceMode,
  exitSourceMode,
  getRendererErrors,
  launchWithDoc,
  sendIpcToRenderer,
  showReviewSidebar
} from './helpers'
import { preserveSystemClipboard } from './helpers/systemClipboardFixture'
import { drag, hiddenCoreEnv as env, nativeKey, nextFrame } from './reviewGestures'

// Drives real mouse and keyboard gestures over every block of a real document
// and fails on the first gesture that sends the session into draft recovery or
// raises a renderer error. MARKTEXT_SWEEP_DOC names the document to sweep (it
// is copied, never edited); without it the sweep uses the generic sample below.
// MARKTEXT_SWEEP_VERBOSE=1 prints every gesture as it runs; otherwise each
// test writes its gesture log to its output directory and a failure names the
// gesture and the steps before it.

const SAMPLE = `---
title: "A Sample Document"
date: "2026-01-01T09:00:00-07:00"
tags: [sample, notes]
draft: true
---

# A Sample Document

This paragraph links to [the project page](https://example.com/project) and says “hello” with ‘smart’ quotes. It’s long enough to wrap across more than one line in the editor, so drags and word selections have room to move around inside it.

Second paragraph with *emphasis*, **strong text**, \`inline code\` and an [inline link](/relative/path). It ends with a sentence -- and a dash.

## A Second Heading

- First item with a [link](https://example.com/a)
- Second item, plain text
- Third item with \`code\`

1. Ordered one
2. Ordered two

> A quoted paragraph that “quotes” someone.

<img src="missing.png" alt="An image that is not there" />

Final paragraph with an ellipsis... and a trailing sentence.
`

const sweepPath = process.env.MARKTEXT_SWEEP_DOC
const sweepSource = sweepPath ? fs.readFileSync(sweepPath, 'utf8') : SAMPLE
const docLabel = sweepPath ? path.basename(sweepPath) : 'generic-sample'
const verbose = process.env.MARKTEXT_SWEEP_VERBOSE === '1'
// Saves after every gesture and prints the saved source and selection, to
// reduce a failure: `1` for every test, or a test's label such as
// `clipboard 36..37` for that test only.
const traceSource = process.env.MARKTEXT_SWEEP_TRACE_SOURCE
// Skips every gesture after this many in each test, to find the gesture that
// leaves a later step, such as closing, broken.
const stopAfter = Number(process.env.MARKTEXT_SWEEP_STOP_AFTER ?? Infinity)
const hasFrontMatter = sweepSource.startsWith('---\n')

/**
 * A rough count of the document's editable leaves: front matter, each block
 * between blank lines, and each list item. It only sizes the chunks the
 * sweep is split into; the last chunk also takes any leaves beyond it.
 */
const estimateLeaves = (markdown: string): number => {
  let body = markdown
  let count = 0
  const frontMatter = /^---\n[\s\S]*?\n---\n/.exec(body)
  if (frontMatter) {
    count++
    body = body.slice(frontMatter[0].length)
  }
  for (const block of body.split(/\n\s*\n/)) {
    if (block.trim() === '') continue
    const items = block.split('\n').filter(line => /^\s*([-*+]|\d+[.)])\s/.test(line)).length
    count += Math.max(1, items)
  }
  return count
}

const leafCount = estimateLeaves(sweepSource)

/** Index ranges of leaves, `chunk` per test; the last range is open-ended. */
const chunks = (chunk: number): Array<{ from: number, to: number }> => {
  const ranges: Array<{ from: number, to: number }> = []
  for (let from = 0; from < leafCount; from += chunk) ranges.push({ from, to: from + chunk })
  if (ranges.length === 0) ranges.push({ from: 0, to: Infinity })
  ranges[ranges.length - 1].to = Infinity
  return ranges
}

const meta = process.platform === 'darwin' ? 'Meta' : 'Control'
const command = (key: string): string => `${meta}+${key}`

type Where = 'start' | 'end' | 'mid' | 'link' | 'near-end'

interface TargetPoint {
  x: number
  y: number
  kind: string
  snippet: string
  word?: string
  /** What lies over the point instead of the leaf, such as a floating toolbar. */
  coveredBy?: string
}

interface Leaf {
  kind: string
  snippet: string
}

declare global {
  interface Window {
    __gestureSweep?: {
      leaves(): Leaf[]
      point(index: number, where: Where): TargetPoint | null
      word(index: number): TargetPoint | null
      span(index: number): { from: TargetPoint, to: TargetPoint } | null
      across(index: number): { from: TargetPoint, to: TargetPoint } | null
    }
  }
}

/**
 * Installs the page-side geometry used to aim gestures. Every point is the
 * centre of a rendered, visible character of a visible editable leaf, after
 * scrolling that leaf into view; hidden Markdown markers are never aimed at.
 */
const installGeometry = async(page: Page): Promise<void> => {
  await page.evaluate(() => {
    if (window.__gestureSweep) return
    const leaves = (): HTMLElement[] => Array.from(
      document.querySelectorAll<HTMLElement>('.editor-component .mu-content[contenteditable="true"]')
    ).filter(element => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    const kindOf = (element: HTMLElement): string => {
      if (element.closest('[class*="frontmatter"]')) return 'front-matter'
      if (element.closest('li')) return element.querySelector('.mu-link') ? 'list-item+link' : 'list-item'
      if (element.closest('blockquote')) return 'quote'
      if (element.className.includes('heading')) return 'heading'
      if (element.className.includes('codeblock')) return element.closest('[class*="html"]') ? 'html' : 'code'
      return element.querySelector('.mu-link') ? 'paragraph+link' : 'paragraph'
    }
    interface Char { node: Text, offset: number }
    const visibleChars = (element: HTMLElement, filter?: (node: Text) => boolean): Char[] => {
      const chars: Char[] = []
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const range = document.createRange()
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        if (filter && !filter(node)) continue
        for (let offset = 0; offset < node.length; offset++) {
          range.setStart(node, offset)
          range.setEnd(node, offset + 1)
          const rect = range.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) chars.push({ node, offset })
        }
      }
      return chars
    }
    const snippetOf = (element: HTMLElement): string => (element.textContent ?? '').replace(/\s+/g, ' ').slice(0, 40)
    const at = (element: HTMLElement, char: Char, edge: 'left' | 'right' | 'centre'): TargetPoint => {
      const range = document.createRange()
      range.setStart(char.node, char.offset)
      range.setEnd(char.node, char.offset + 1)
      const rect = range.getBoundingClientRect()
      const x = edge === 'left' ? rect.left + 0.5 : edge === 'right' ? rect.right - 0.5 : rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const hit = document.elementFromPoint(x, y)
      const coveredBy = hit && element.contains(hit) ? undefined : String(hit?.className || hit?.nodeName || 'nothing')
      return { x, y, kind: kindOf(element), snippet: snippetOf(element), ...(coveredBy ? { coveredBy } : {}) }
    }
    const inView = (point: TargetPoint): boolean => point.y > 4 && point.y < window.innerHeight - 4
    const show = (element: HTMLElement): void => {
      element.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
    const isWordChar = (char: Char): boolean => /[\p{L}\p{N}]/u.test(char.node.data[char.offset])
    window.__gestureSweep = {
      leaves: () => leaves().map(element => ({ kind: kindOf(element), snippet: snippetOf(element) })),
      point(index, where) {
        const element = leaves()[index]
        if (!element) return null
        show(element)
        const chars = where === 'link'
          ? visibleChars(element, node => !!node.parentElement?.closest('.mu-link'))
          : visibleChars(element)
        if (chars.length === 0) return null
        if (where === 'start') return at(element, chars[0], 'left')
        if (where === 'end') return at(element, chars[chars.length - 1], 'right')
        if (where === 'near-end') return at(element, chars[Math.max(0, chars.length - 4)], 'left')
        return at(element, chars[Math.floor(chars.length / 2)], 'left')
      },
      word(index) {
        const element = leaves()[index]
        if (!element) return null
        show(element)
        const chars = visibleChars(element)
        const middle = Math.floor(chars.length / 2)
        for (let distance = 0; distance < chars.length; distance++) {
          for (const candidate of [middle + distance, middle - distance]) {
            const char = chars[candidate]
            if (!char || !isWordChar(char)) continue
            let start = candidate
            let end = candidate
            while (start > 0 && chars[start - 1].node === char.node && isWordChar(chars[start - 1])) start--
            while (end + 1 < chars.length && chars[end + 1].node === char.node && isWordChar(chars[end + 1])) end++
            const point = at(element, chars[Math.floor((start + end) / 2)], 'centre')
            point.word = char.node.data.slice(chars[start].offset, chars[end].offset + 1)
            return point
          }
        }
        return null
      },
      span(index) {
        const element = leaves()[index]
        if (!element) return null
        show(element)
        const chars = visibleChars(element)
        if (chars.length < 3) return null
        const from = Math.floor(chars.length / 4)
        const to = Math.min(chars.length - 1, from + 12)
        return { from: at(element, chars[from], 'left'), to: at(element, chars[to], 'right') }
      },
      across(index) {
        const all = leaves()
        const first = all[index]
        const second = all[index + 1]
        if (!first || !second) return null
        second.scrollIntoView({ block: 'center', inline: 'nearest' })
        const head = visibleChars(first)
        const tail = visibleChars(second)
        if (head.length === 0 || tail.length === 0) return null
        const from = at(first, head[Math.max(0, head.length - 6)], 'left')
        const to = at(second, tail[Math.min(tail.length - 1, 4)], 'right')
        return inView(from) && inView(to) ? { from, to } : null
      }
    }
  })
}

interface SweepSession {
  app: ElectronApplication
  page: Page
  filePath: string
  clipboard: ReturnType<typeof preserveSystemClipboard>
  pageErrors: string[]
  /** Renderer console errors, which explain a refusal that shows no UI. */
  consoleErrors: string[]
  /** The text the sweep last put on the system clipboard. */
  lastCopy?: string
  tracked?: boolean
}

const copyToTemp = (source: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-gesture-sweep-'))
  const filePath = path.join(directory, sweepPath ? path.basename(sweepPath) : 'sample.md')
  fs.writeFileSync(filePath, source, 'utf8')
  return filePath
}

const launchSweep = async(source: string): Promise<SweepSession> => {
  const filePath = copyToTemp(source)
  const clipboard = preserveSystemClipboard()
  const { app, page } = await launchWithDoc(filePath, { suppressErrorDialog: true, env })
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(`${error.name}: ${error.message}\n${error.stack ?? ''}`))
  const consoleErrors: string[] = []
  watchConsoleErrors(page, consoleErrors)
  await installGeometry(page)
  return { app, page, filePath, clipboard, pageErrors, consoleErrors }
}

const watchConsoleErrors = (page: Page, errors: string[]): void => {
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
}

const closeSweep = async(session: SweepSession | undefined): Promise<void> => {
  if (!session) return
  await closeApp(session).catch(() => {})
  rememberClipboard(session)
  session.clipboard.restore()
}

/**
 * Closes the editor window as a user does, then the app, and fails, naming any
 * message box main raised, if the window does not close in time. Message boxes
 * are recorded and left unanswered, so none appears on screen.
 */
const closeApp = async({ app, consoleErrors }: SweepSession): Promise<void> => {
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const raised: string[] = []
    ;(globalThis as unknown as { sweepMessageBoxes: string[] }).sweepMessageBoxes = raised
    const record = (...args: unknown[]): never => {
      raised.push(JSON.stringify(args[args.length - 1]).slice(0, 400))
      return new Promise(() => {}) as never
    }
    dialog.showMessageBox = record
    dialog.showMessageBoxSync = record
    for (const win of BrowserWindow.getAllWindows()) win.close()
  })
  let state = { windows: 1, messageBoxes: [] as string[] }
  for (const deadline = Date.now() + 15000; Date.now() < deadline;) {
    state = await app.evaluate(({ BrowserWindow }) => ({
      windows: BrowserWindow.getAllWindows().length,
      messageBoxes: (globalThis as unknown as { sweepMessageBoxes: string[] }).sweepMessageBoxes
    })).catch(() => ({ windows: 0, messageBoxes: state.messageBoxes }))
    if (state.windows === 0) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (state.windows !== 0) {
    app.process().kill('SIGKILL')
    throw new Error(`The editor window did not close within 15 s; message boxes: ${JSON.stringify(state.messageBoxes)}; ` +
      `console errors:\n${consoleErrors.slice(-5).join('\n')}`)
  }
  await app.close().catch(() => {})
}

/** Lets the system clipboard restoration accept the sweep's own latest copy. */
const rememberClipboard = (session: SweepSession): void => {
  if (session.lastCopy !== undefined) session.clipboard.rememberOwnedWrite(session.lastCopy)
}

/** Records and checks gestures for one test, naming each one in failures. */
class Sweep {
  readonly trail: string[] = []
  constructor(readonly session: SweepSession, readonly label: string) {}

  get page(): Page { return this.session.page }
  get app(): ElectronApplication { return this.session.app }

  async leaves(): Promise<Leaf[]> {
    await installGeometry(this.page)
    return this.page.evaluate(() => window.__gestureSweep!.leaves())
  }

  /** Runs one gesture, then fails if it left the document in recovery or raised an error. */
  async step(description: string, gesture: () => Promise<void>): Promise<void> {
    if (this.trail.length >= stopAfter) return
    const entry = `${this.label} #${this.trail.length + 1}: ${description}`
    this.trail.push(entry)
    if (verbose) console.log(entry)
    try {
      await gesture()
      await this.settle()
    } catch (error) {
      throw new Error(`${this.failureContext(entry)}\n${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    }
    await this.check(entry)
    if (traceSource === '1' || (traceSource && this.label === traceSource)) {
      await sendIpcToRenderer(this.app, 'mt::editor-ask-file-save')
      await expect(this.page.locator('.editor-tabs li.unsaved')).toHaveCount(0, { timeout: 10000 })
      console.log(`  source: ${JSON.stringify(fs.readFileSync(this.session.filePath, 'utf8'))}`)
      console.log(`  selection: ${await this.page.evaluate(() => {
        const selection = window.getSelection()
        const describe = (node: Node | null | undefined, offset: number | undefined): string => {
          if (!node) return 'none'
          const element = node instanceof Element ? node : node.parentElement
          const content = element?.closest('.mu-content')
          return `${node.nodeName}${element ? `.${element.className}` : ''}@${offset}` +
            `${node.isConnected ? '' : ' DETACHED'}${content ? '' : ' OUTSIDE-CONTENT'} "${(node.textContent ?? '').slice(0, 24)}"`
        }
        return `${JSON.stringify(selection?.toString())} anchor ${describe(selection?.anchorNode, selection?.anchorOffset)}` +
          ` focus ${describe(selection?.focusNode, selection?.focusOffset)}`
      })}`)
    }
  }

  async settle(): Promise<void> {
    await this.page.evaluate(() => window.__marktextDocumentCore?.settled())
    await nextFrame(this.page)
  }

  async check(entry: string): Promise<void> {
    const recovery = await this.page.getByRole('textbox', { name: 'Recovered draft text' }).count() +
      await this.page.getByTestId('core-recovery-draft').count()
    const errors = await getRendererErrors(this.app)
    const problems = [
      ...(recovery > 0 ? [`draft recovery is showing (${recovery})`] : []),
      ...errors.map(error => `renderer error ${error.name ?? 'Error'}: ${error.message}\n${error.stack ?? ''}`),
      ...this.session.pageErrors.map(error => `page error ${error}`)
    ]
    if (problems.length > 0) {
      let draft = ''
      if (recovery > 0) {
        draft = await this.page.getByRole('textbox', { name: 'Recovered draft text' }).first()
          .inputValue({ timeout: 1000 }).catch(() => '')
      }
      throw new Error(`${this.failureContext(entry)}\n${problems.join('\n')}${draft ? `\nrecovered draft starts: ${JSON.stringify(draft.slice(0, 300))}` : ''}`)
    }
  }

  private failureContext(entry: string): string {
    return `Gesture failed on ${docLabel}: ${entry}\nPrevious gestures:\n${this.trail.slice(-12, -1).join('\n')}`
  }

  /** Gesture places skipped because something stayed over them. */
  readonly covered: string[] = []

  /**
   * Fetches the points a gesture aims at. A floating toolbar over one is first
   * dismissed with Escape, as a user would; a place that stays covered is
   * skipped, so the sweep never presses a toolbar button by accident.
   */
  private async aim<T>(fetch: () => Promise<T | null>, points: (target: T) => TargetPoint[]): Promise<T | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await installGeometry(this.page)
      const target = await fetch()
      if (!target) return null
      const covering = points(target).find(point => point.coveredBy !== undefined)
      if (!covering) return target
      if (attempt === 0) {
        await this.press('Escape')
      } else {
        this.covered.push(`${covering.kind} "${covering.snippet}" under ${covering.coveredBy}`)
      }
    }
    return null
  }

  async point(index: number, where: Where): Promise<TargetPoint | null> {
    return this.aim(
      () => this.page.evaluate(({ index, where }) => window.__gestureSweep!.point(index, where), { index, where }),
      point => [point]
    )
  }

  /** Clicks at `where` in leaf `index` as one gesture; false when the leaf has no such place. */
  async clickStep(index: number, where: Where): Promise<boolean> {
    const point = await this.point(index, where)
    if (!point) return false
    await this.step(`click ${where} of leaf ${index} (${point.kind} "${point.snippet}")`, async() => {
      await this.page.mouse.click(point.x, point.y)
      await nextFrame(this.page)
    })
    return true
  }

  async type(text: string): Promise<void> {
    await this.step(`type ${JSON.stringify(text)}`, () => this.page.keyboard.type(text))
  }

  async press(key: string): Promise<void> {
    await this.step(`press ${key}`, () => this.page.keyboard.press(key))
  }

  async copy(): Promise<void> {
    await this.step('Cmd+C', async() => {
      await this.page.keyboard.press(command('C'))
      await this.noteClipboard()
    })
  }

  async cut(): Promise<void> {
    await this.step('Cmd+X', async() => {
      await this.page.keyboard.press(command('X'))
      await this.noteClipboard()
    })
  }

  async paste(): Promise<void> {
    await this.step('Cmd+V', () => this.page.keyboard.press(command('V')))
  }

  /** Cmd+Z through Electron's native input path, as the Edit menu accelerator receives it. */
  async undo(): Promise<void> {
    await this.step('Cmd+Z', () => nativeKey(this.app, 'Z', ['meta']))
  }

  async redo(): Promise<void> {
    await this.step('Cmd+Shift+Z', () => nativeKey(this.app, 'Z', ['meta', 'shift']))
  }

  async doubleClickWord(index: number): Promise<boolean> {
    const point = await this.aim(() => this.page.evaluate(index => window.__gestureSweep!.word(index), index), point => [point])
    if (!point) return false
    await this.step(`double-click "${point.word}" in leaf ${index} (${point.kind} "${point.snippet}")`, async() => {
      await this.page.mouse.dblclick(point.x, point.y)
      await nextFrame(this.page)
    })
    return true
  }

  async dragSpan(index: number): Promise<boolean> {
    const span = await this.aim(
      () => this.page.evaluate(index => window.__gestureSweep!.span(index), index),
      span => [span.from, span.to]
    )
    if (!span) return false
    await this.step(`drag-select part of leaf ${index} (${span.from.kind} "${span.from.snippet}")`, async() => {
      await drag(this.page, span.from, span.to)
      await nextFrame(this.page)
    })
    return true
  }

  async dragAcross(index: number): Promise<boolean> {
    const span = await this.aim(
      () => this.page.evaluate(index => window.__gestureSweep!.across(index), index),
      span => [span.from, span.to]
    )
    if (!span) return false
    await this.step(
      `drag-select from leaf ${index} (${span.from.kind} "${span.from.snippet}") into leaf ${index + 1} (${span.to.kind} "${span.to.snippet}")`,
      async() => {
        await drag(this.page, span.from, span.to)
        await nextFrame(this.page)
      }
    )
    return true
  }

  private async noteClipboard(): Promise<void> {
    this.session.lastCopy = await this.app.evaluate(({ clipboard }) => clipboard.readText())
  }

  /**
   * Saves, waits for the save to land, and checks the file still holds a
   * document. A tracked edit in front matter is a suggestion around it, so only
   * untracked sessions must keep the file's leading front matter.
   */
  async checkpoint(): Promise<string> {
    let saved = ''
    await this.step('save checkpoint', async() => {
      await sendIpcToRenderer(this.app, 'mt::editor-ask-file-save')
      await expect(this.page.locator('.editor-tabs li.unsaved')).toHaveCount(0, { timeout: 10000 })
      saved = fs.readFileSync(this.session.filePath, 'utf8')
      if (sweepSource.trim() !== '') expect(saved.trim(), 'saved document is not empty').not.toBe('')
      if (hasFrontMatter && !this.session.tracked) {
        expect(saved.startsWith('---\n'), 'saved document keeps its front matter').toBe(true)
      }
    })
    return saved
  }

  writeLog(testInfo: TestInfo): void {
    fs.writeFileSync(testInfo.outputPath('gestures.log'), `${this.trail.join('\n')}\n`, 'utf8')
    rememberClipboard(this.session)
  }
}

/**
 * One gesture family over the whole document: a shared app session, split
 * into tests of `chunk` leaves each so every test stays under the default
 * timeout. A failed test restarts the worker; the next test relaunches on the
 * original document.
 */
const family = (
  name: string,
  chunk: number,
  options: { tracked?: boolean, atMidpoint?: (sweep: Sweep) => Promise<void> },
  sweepLeaf: (sweep: Sweep, index: number) => Promise<void>
): void => {
  test.describe(`${name} on ${docLabel}`, () => {
    let session: SweepSession | undefined

    test.beforeAll(async() => {
      session = await launchSweep(sweepSource)
      if (options.tracked) {
        session.tracked = true
        // Track Changes lives in the Review sidebar, which a document without
        // annotations leaves closed.
        await showReviewSidebar(session.app)
        await session.page.getByTestId('critic-review-track-changes').click()
        await expect(session.page.getByTestId('critic-review-track-changes')).toHaveAttribute('aria-pressed', 'true')
      }
    })

    test.afterAll(async() => {
      await closeSweep(session)
      session = undefined
    })

    const ranges = chunks(chunk)
    ranges.forEach((range, chunkIndex) => {
      const last = range.to === Infinity ? 'end' : String(range.to - 1)
      test(`leaves ${range.from}..${last}`, async() => {
        const testInfo = test.info()
        const sweep = new Sweep(session!, `${name} ${range.from}..${last}`)
        try {
          const leaves = await sweep.leaves()
          if (chunkIndex === 0) {
            console.log(`${name} on ${docLabel}: ${leaves.length} leaves (${leaves.map(leaf => leaf.kind).join(', ')})`)
          }
          const midpoint = chunkIndex === Math.floor(ranges.length / 2)
          if (midpoint && options.atMidpoint) await options.atMidpoint(sweep)
          for (let index = range.from; index < Math.min(range.to, leaves.length); index++) {
            if ((await sweep.leaves()).length <= index) break
            await sweepLeaf(sweep, index)
          }
          if (range.to === Infinity || midpoint) await sweep.checkpoint()
        } finally {
          sweep.writeLog(testInfo)
          const skipped = sweep.covered.length > 0 ? `; skipped ${sweep.covered.length} covered: ${sweep.covered.join('; ')}` : ''
          console.log(`${sweep.trail.length} gestures in ${name} ${range.from}..${last}${skipped}`)
        }
      })
    })

    // The swept document opens again without recovery, and saving it
    // unchanged leaves its bytes alone.
    test('the swept document reopens and saves unchanged', async() => {
      const current = session!
      const saved = await new Sweep(current, `${name} reopen`).checkpoint()
      await closeApp(current)
      const reopened = await launchWithDoc(current.filePath, { suppressErrorDialog: true, env })
      current.app = reopened.app
      current.page = reopened.page
      current.pageErrors.length = 0
      current.consoleErrors.length = 0
      reopened.page.on('pageerror', error => current.pageErrors.push(`${error.name}: ${error.message}\n${error.stack ?? ''}`))
      watchConsoleErrors(reopened.page, current.consoleErrors)
      const sweep = new Sweep(current, `${name} reopened`)
      await sweep.step('reopen', () => sweep.settle())
      await sendIpcToRenderer(reopened.app, 'mt::editor-ask-file-save')
      await sweep.settle()
      expect(fs.readFileSync(current.filePath, 'utf8')).toBe(saved)
    })
  })
}

const SPECIALS = ['*', '_', '`', '[', '$', '<', '&', '\\']

// Caret placement and typing at the start, middle and end of every leaf and in
// every link: words with spaces, a trailing space, and each Markdown-significant
// character, each removed again with Backspace. Source mode is toggled once.
family('typing', 3, { atMidpoint: sweep => toggleSource(sweep) }, async(sweep, index) => {
  if (await sweep.clickStep(index, 'start')) await sweep.type('Sweep words here ')
  if (await sweep.clickStep(index, 'end')) {
    await sweep.type(' ')
    await sweep.type('tail words ')
  }
  if (await sweep.clickStep(index, 'mid')) {
    for (const special of SPECIALS) {
      await sweep.type(special)
      await sweep.press('Backspace')
    }
    await sweep.type('in the middle')
  }
  if (await sweep.clickStep(index, 'link')) {
    await sweep.type('L ')
    await sweep.press('Backspace')
  }
})

/** Saves, compares Source mode with the saved bytes, and returns to the editor. */
const toggleSource = async(sweep: Sweep): Promise<void> => {
  const saved = await sweep.checkpoint()
  await sweep.step('toggle Source mode on', () => enterSourceMode(sweep.page, sweep.app))
  const source = await sweep.page.evaluate(() => {
    const element = document.querySelector('.source-code .CodeMirror') as (Element & { CodeMirror?: { getValue(): string } }) | null
    return element?.CodeMirror?.getValue() ?? null
  })
  expect(source, 'Source mode shows the saved document').toBe(saved)
  await sweep.step('toggle Source mode off', () => exitSourceMode(sweep.page, sweep.app))
}

// Selections by double-click, drag, Shift+Arrow, Shift+Alt+Arrow and across two
// leaves, each copied, cut, undone and pasted, including the original crash: a
// cut or copy in a paragraph that ends in a just-typed space.
family('clipboard', 2, {}, async(sweep, index) => {
  if (await sweep.doubleClickWord(index)) {
    await sweep.copy()
    if (await sweep.clickStep(index, 'end')) {
      await sweep.paste()
      await sweep.undo()
    }
  }
  if (await sweep.dragSpan(index)) {
    await sweep.copy()
    await sweep.cut()
    await sweep.undo()
    await sweep.redo()
    await sweep.undo()
  }
  if (await sweep.clickStep(index, 'end')) {
    await sweep.type(' ')
    if (await sweep.doubleClickWord(index)) {
      await sweep.copy()
      await sweep.cut()
      await sweep.undo()
    }
    if (await sweep.clickStep(index, 'end')) await sweep.type('after')
  }
  if (await sweep.clickStep(index, 'mid')) {
    for (const key of ['Shift+ArrowRight', 'Shift+ArrowRight', 'Shift+ArrowRight', 'Shift+Alt+ArrowRight', 'Shift+Alt+ArrowRight']) {
      await sweep.press(key)
    }
    await sweep.copy()
    await sweep.press('Shift+Alt+ArrowLeft')
    await sweep.press('Shift+ArrowLeft')
    await sweep.cut()
    await sweep.undo()
    await sweep.press('Shift+ArrowDown')
    await sweep.copy()
    await sweep.cut()
    await sweep.undo()
  }
  if (await sweep.dragAcross(index)) {
    await sweep.copy()
    await sweep.cut()
    await sweep.undo()
    if (await sweep.clickStep(index, 'start')) {
      await sweep.paste()
      await sweep.undo()
    }
  }
})

// Enter, Shift+Enter, Backspace and Delete at the start and end of every leaf,
// each undone and redone.
family('structure', 3, {}, async(sweep, index) => {
  if (await sweep.clickStep(index, 'end')) {
    await sweep.press('Enter')
    await sweep.type('new')
    await sweep.undo()
    await sweep.redo()
    await sweep.undo()
  }
  if (await sweep.clickStep(index, 'end')) {
    await sweep.press('Shift+Enter')
    await sweep.type('x')
    await sweep.press('Backspace')
    await sweep.press('Backspace')
  }
  if (await sweep.clickStep(index, 'start')) {
    await sweep.press('Backspace')
    await sweep.undo()
  }
  if (await sweep.clickStep(index, 'end')) {
    await sweep.press('Delete')
    await sweep.undo()
  }
  if (await sweep.clickStep(index, 'start')) {
    await sweep.press('Enter')
    await sweep.undo()
  }
  if (await sweep.clickStep(index, 'near-end')) {
    await sweep.press('Delete')
    await sweep.press('Backspace')
    await sweep.undo()
    await sweep.undo()
  }
})

// A subset with Track Changes on: typing, a trailing space, cut, copy, paste,
// Enter, Backspace and Delete, with undo and redo.
// Source mode edits raw text, and returning from it starts with Track Changes
// off; the sweep turns it back on as a user would.
const trackedMidpoint = async(sweep: Sweep): Promise<void> => {
  await toggleSource(sweep)
  const toggle = sweep.page.getByTestId('critic-review-track-changes')
  if (await toggle.getAttribute('aria-pressed') !== 'true') {
    await sweep.step('turn Track Changes back on', () => toggle.click())
  }
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
}

family('tracked', 2, { tracked: true, atMidpoint: trackedMidpoint }, async(sweep, index) => {
  if (await sweep.clickStep(index, 'mid')) await sweep.type('tracked words ')
  if (await sweep.clickStep(index, 'end')) await sweep.type(' ')
  if (await sweep.doubleClickWord(index)) {
    await sweep.copy()
    await sweep.cut()
    await sweep.undo()
    await sweep.redo()
  }
  if (await sweep.clickStep(index, 'end')) {
    await sweep.paste()
    await sweep.press('Enter')
    await sweep.type('n')
    await sweep.undo()
  }
  if (await sweep.clickStep(index, 'start')) {
    await sweep.press('Backspace')
    await sweep.press('Delete')
    await sweep.undo()
  }
  if (await sweep.dragSpan(index)) {
    await sweep.type('replaced')
    await sweep.undo()
  }
})

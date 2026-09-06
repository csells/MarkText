import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { expectDefaultCoreAuthority } from './installedArtifactProvenance'

import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  getMarkdownContent,
  launchElectron,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady
} from './helpers'

type OpenedEditor = {
  app: ElectronApplication
  page: Page
  pageErrors: string[]
}

const openFixture = async(filePath: string): Promise<OpenedEditor> => {
  const binary = process.env.MARKTEXT_PACKAGED_APP
  const env: Record<string, string> = {
    PERF_TESTING: 'true',
    MARKTEXT_DOCUMENT_CORE_MODE: '1',
    MARKTEXT_E2E_HIDDEN_WINDOW: '1'
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key in env)) env[key] = value
  }
  delete env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
  if (binary !== undefined) {
    delete env.MARKTEXT_DOCUMENT_CORE_MODE
    delete env.MARKTEXT_DOCUMENT_CORE_SHADOW
  }
  let app: ElectronApplication
  let page: Page
  if (binary === undefined) {
    ({ app, page } = await launchElectron([filePath], {
      suppressErrorDialog: true,
      env: { ...env, MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
    }))
  } else {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-structural-profile-'))
    app = await electron.launch({
      executablePath: path.resolve(binary),
      args: ['--user-data-dir', profile, filePath],
      env,
      timeout: 60_000
    })
    try {
      page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
    } catch (error) {
      await app.close().catch(() => {})
      throw error
    }
  }
  const pageErrors: string[] = []
  page.on('pageerror', error => { pageErrors.push(error.message) })
  try {
    await waitForEditor(page, 60_000)
    await waitForMenuReady(app, 60_000)
    if (binary !== undefined) await expectDefaultCoreAuthority(page)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    return { app, page, pageErrors }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

const fixture = (source: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-structural-review-'))
  const filePath = path.join(root, 'document.md')
  fs.writeFileSync(filePath, source, { encoding: 'utf8', flag: 'wx' })
  return filePath
}

const saveExact = async(app: ElectronApplication, filePath: string, source: string): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(source)
}

const expectHealthy = async(opened: OpenedEditor): Promise<void> => {
  expect(opened.pageErrors).toEqual([])
  if (process.env.MARKTEXT_PACKAGED_APP === undefined) await expectNoRendererErrors(opened.app)
  await expectEditorWindowHidden(opened.app)
  expectEditorNotFrontmost(opened.app)
}

const editableBlocks = [
  {
    name: 'heading',
    source: '# Heading\n',
    selector: '.mu-atxheading-content',
    initialText: 'Heading',
    editedSource: '# Heading!\n'
  },
  {
    name: 'list item',
    source: '- item\n',
    selector: 'li .mu-paragraph-content',
    initialText: 'item',
    editedSource: '- item!\n'
  },
  {
    name: 'table cell',
    source: '| col |\n| --- |\n| cell |\n',
    selector: '.mu-table-cell-content',
    initialText: 'cell',
    editedSource: '| col |\n| --- |\n| cell! |\n'
  },
  {
    name: 'fenced code block',
    source: '```text\ncode\n```\n',
    selector: '.mu-codeblock-content',
    initialText: 'code',
    editedSource: '```text\ncode!\n```\n'
  },
  {
    name: 'empty fenced code block',
    source: '~~~ts\n~~~\n',
    selector: '.mu-codeblock-content',
    initialText: '',
    editedSource: '~~~ts\n!\n~~~\n'
  },
  {
    name: 'empty math block',
    source: '$$\n\n$$\n',
    activateSelector: '.mu-math-preview',
    selector: '.mu-math-block .mu-content',
    initialText: '',
    editedSource: '$$\n!\n$$\n'
  }
] as const

test.describe('Core structural and editorial compatibility', () => {
  test.describe.configure({ timeout: 60_000 })

  for (const block of editableBlocks) {
    test(`edits a ${block.name} and preserves exact source through history and reopen`, async() => {
      const filePath = fixture(block.source)
      let opened = await openFixture(filePath)
      try {
        const { app, page } = opened
        if ('activateSelector' in block) await page.locator(block.activateSelector).click()
        const content = page.locator(block.selector).filter({ hasText: block.initialText }).first()
        await expect(content).toBeVisible()
        await expect(content).toHaveAttribute('contenteditable', 'true')
        await content.click()
        await page.keyboard.press('End')
        await page.keyboard.type('!')
        await saveExact(app, filePath, block.editedSource)
        await expect(content).toContainText(`${block.initialText}!`)

        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await saveExact(app, filePath, block.source)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
        await saveExact(app, filePath, block.editedSource)
        expect(await getMarkdownContent(page, app)).toBe(block.editedSource)
        await expectHealthy(opened)
        await app.close()

        opened = await openFixture(filePath)
        await expect(opened.page.locator(block.selector).filter({ hasText: `${block.initialText}!` }).first())
          .toHaveAttribute('contenteditable', 'true')
        await saveExact(opened.app, filePath, block.editedSource)
        await expectHealthy(opened)
      } finally {
        await opened.app.close().catch(() => {})
      }
    })
  }

  test('shows all five forms in Markup and preserves them through Source and reopen', async() => {
    const source = 'Before {++added++} {--removed--} {~~old~>new~~} {==highlight==} {>>note<<} after.\n'
    const filePath = fixture(source)
    let opened = await openFixture(filePath)
    try {
      const { app, page } = opened
      const paragraph = page.locator('.mu-paragraph-content').first()
      await expect(paragraph).toHaveAttribute('contenteditable', 'true')
      await expect(paragraph.locator('[data-critic-kind="addition"]')).toHaveText('added')
      await expect(paragraph.locator('[data-critic-kind="deletion"]')).toHaveText('removed')
      await expect(paragraph.locator('[data-critic-kind="substitution"][data-critic-arm="old"]')).toHaveText('old')
      await expect(paragraph.locator('[data-critic-kind="substitution"][data-critic-arm="new"]')).toHaveText('new')
      await expect(paragraph.locator('[data-critic-kind="highlight"]')).toHaveText('highlight')
      await expect(paragraph).not.toContainText('note')
      for (const kind of ['addition', 'deletion', 'substitution', 'highlight', 'comment']) {
        await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', kind)
        if (kind === 'comment') {
          await expect(page.getByTestId('critic-review-comment-text')).toHaveText('note')
        } else {
          await page.getByTestId('critic-review-next').click()
        }
      }
      expect(await getMarkdownContent(page, app)).toBe(source)
      await saveExact(app, filePath, source)
      await expectHealthy(opened)
      await app.close()

      opened = await openFixture(filePath)
      await expect(opened.page.locator('[data-critic-kind="deletion"]')).toHaveText('removed')
      await saveExact(opened.app, filePath, source)
      await expectHealthy(opened)
    } finally {
      await opened.app.close().catch(() => {})
    }
  })
})

for (const tracked of [false, true]) {
  for (const container of [
    { command: 'ul-bullet', prefix: '- ', selector: 'ul li' },
    { command: 'ol-order', prefix: '1. ', selector: 'ol li' },
    { command: 'ul-task', prefix: '- [ ] ', selector: 'ul li' },
    { command: 'blockquote', prefix: '> ', selector: 'blockquote' }
  ]) {
    test(`formats and edits a multiline addition as ${container.command}, tracked=${tracked}`, async() => {
      const source = '{++first\nsecond++}\n'
      const filePath = fixture(source)
      const opened = await openFixture(filePath)
      const { app, page } = opened
      try {
        if (tracked) await page.getByTestId('critic-review-track-changes').click()
        const paragraph = page.locator('.mu-paragraph-content').first()
        await paragraph.click()
        await paragraph.evaluate(node => {
          const range = document.createRange()
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
          let last = walker.nextNode()
          for (let next = walker.nextNode(); next !== null; next = walker.nextNode()) last = next
          if (last === null) throw new Error('Expected paragraph text')
          range.setStart(last, last.textContent?.length ?? 0)
          range.collapse(true)
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
        })
        await sendIpcToRenderer(app, 'mt::editor-paragraph-action', { type: container.command })
        const formatted = tracked ? `{++${container.prefix}first\nsecond++}\n` : `${container.prefix}${source}`
        await saveExact(app, filePath, formatted)
        await expect(page.locator('.editor-component').locator(container.selector).first()).toBeVisible()
        await page.keyboard.type('!')
        await saveExact(app, filePath, formatted.replace('second', 'second!'))
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await saveExact(app, filePath, formatted)
        await paragraph.click()
        await sendIpcToRenderer(app, 'mt::editor-paragraph-action', { type: container.command })
        await saveExact(app, filePath, source)
        expect(await getMarkdownContent(page, app)).toBe(source)
        expect(await page.evaluate(() => window.electron.ipcRenderer.invoke('mt::core-draft::list'))).toEqual([])
        await expectHealthy(opened)
      } finally {
        await app.close()
      }
    })
  }
}

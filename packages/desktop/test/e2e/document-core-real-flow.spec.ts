import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  closeElectron,
  launchWithMarkdown,
  getMarkdownContent,
  sendIpcToRenderer,
  typeIntoEditor,
  placeCaretInEditor,
  enterSourceMode,
  exitSourceMode
} from './helpers'
import {
  expectCanonicalOnDisk,
  saveCanonicalSnapshot
} from './documentCoreReviewE2e'

/**
 * The document-core engine driving a real tab.
 *
 * Its own spec file on purpose: the interaction helpers do not work against a
 * second Electron instance launched alongside another, so this app has to
 * be the only one here. That is what lets typing and the source-mode round trip
 * exercise the production owner directly.
 *
 * These tests exercise one canonical session from browser input through source
 * reads and the source-mode handoff.
 */

test.describe('document-core engine', () => {
  let app: ElectronApplication
  let page: Page
  let documentPath = ''
  let filePath: string

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(
      '# Document core\n\nPlain paragraph here.\n\nTracked {++insert++}.\n'
    )
    app = launched.app
    page = launched.page
    documentPath = launched.filePath
    filePath = launched.filePath
  })

  test.afterAll(async() => {
    if (app) await closeElectron(app)
  })

  test('runs the tab on document-core', async() => {
    await expect(
      page.locator('.editor-component.document-view-container')
    ).toHaveAttribute('data-document-mode', 'semantic')
  })

  test('serves the document from the engine with markers intact', async() => {
    const markdown = await getMarkdownContent(page, app)
    expect(markdown).toContain('# Document core')
  })

  test('owns one beforeinput DOM history source and file flow', async() => {
    await placeCaretInEditor(page)
    await typeIntoEditor(page, 'Edited ')
    await expect.poll(() => saveCanonicalSnapshot(page, app, documentPath)).toContain('Edited ')
    const markdown = await saveCanonicalSnapshot(page, app, documentPath)
    // The engine reports what the user actually typed, and still holds the
    // tracked change it was not asked to touch.
    expect(markdown).toContain('Edited ')
    expect(markdown).toContain('{++insert++}')
    await expect(page.locator('.editor-component')).toContainText('Edited ')

    await sendIpcToRenderer(app, 'mt::editor-command', 'undo')
    await expect.poll(() => saveCanonicalSnapshot(page, app, documentPath)).not.toContain('Edited ')
    await sendIpcToRenderer(app, 'mt::editor-command', 'redo')
    await expect.poll(() => saveCanonicalSnapshot(page, app, documentPath)).toContain('Edited ')

    await enterSourceMode(page, app)
    await expect(page.locator('.source-code-input')).toHaveValue(/Edited /)
    await exitSourceMode(page, app)
    const canonical = await saveCanonicalSnapshot(page, app, documentPath)
    expect(canonical).toContain('Edited ')

    // A repeated explicit save is byte-idempotent against that snapshot.
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(canonical)
  })

  test('survives the source-mode round trip', async() => {
    const before = await getMarkdownContent(page, app)
    await enterSourceMode(page, app)
    await exitSourceMode(page, app)
    const after = await getMarkdownContent(page, app)
    expect(after).toBe(before)
  })
})

import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

import {
  enterSourceMode,
  exitSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

test('Core mode maps the caret across an edited Source-to-WYSIWYG handoff', async() => {
  const source = 'alpha beta\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await page.waitForFunction(
      () => window.__marktextDocumentCore?.inputPlainText !== undefined
    )
    await page.evaluate(() => {
      const paragraph = document.querySelector('span.mu-paragraph-content')
      const text = paragraph === null
        ? undefined
        : document.createTreeWalker(
          paragraph,
          NodeFilter.SHOW_TEXT
        ).nextNode()
      if (!(text instanceof Text)) throw new Error('Plain paragraph text is unavailable')
      const range = document.createRange()
      range.setStart(text, 6)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    await enterSourceMode(page, app)
    expect(await page.evaluate(() => {
      const host = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { getCursor(): { line: number; ch: number } } })
        | null
      return host?.CodeMirror?.getCursor()
    })).toEqual({ line: 0, ch: 6 })
    await page.evaluate(() => {
      const host = document.querySelector('.source-code .CodeMirror') as
        | (Element & {
          CodeMirror?: {
            replaceRange(
              text: string,
              from: { line: number; ch: number },
              to: { line: number; ch: number },
              origin: string
            ): void
            setCursor(position: { line: number; ch: number }): void
          }
        })
        | null
      const cm = host?.CodeMirror
      if (cm === undefined) throw new Error('Core Source editor is unavailable')
      cm.replaceRange(
        'BETA',
        { line: 0, ch: 6 },
        { line: 0, ch: 10 },
        '+input'
      )
      cm.setCursor({ line: 0, ch: 10 })
    })
    await exitSourceMode(page, app)

    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('alpha BETA')
    expect(await page.evaluate(() => {
      const paragraph = document.querySelector('span.mu-paragraph-content')
      const selection = window.getSelection()
      if (
        paragraph === null || selection === null || !selection.isCollapsed ||
        selection.anchorNode === null || !paragraph.contains(selection.anchorNode)
      ) return undefined
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      range.setEnd(selection.anchorNode, selection.anchorOffset)
      return range.toString().length
    })).toBe(10)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('alpha BETA\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode rebases Source input authored during actor undo', async() => {
  const source = 'abc\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await enterSourceMode(page, app)
    await page.waitForFunction(() => window.__marktextDocumentCore?.mode === 'core')
    await page.evaluate(() => {
      const host = document.querySelector('.source-code .CodeMirror') as
        | (Element & {
          CodeMirror?: {
            replaceRange(
              text: string,
              from: { line: number; ch: number },
              to: { line: number; ch: number },
              origin: string
            ): void
          }
        })
        | null
      host?.CodeMirror?.replaceRange(
        'X',
        { line: 0, ch: 1 },
        { line: 0, ch: 2 },
        '+input'
      )
    })
    await page.evaluate(() => window.__marktextDocumentCore?.settled())

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await page.waitForTimeout(25)
    await page.evaluate(() => {
      const host = document.querySelector('.source-code .CodeMirror') as
        | (Element & {
          CodeMirror?: {
            replaceRange(
              text: string,
              from: { line: number; ch: number },
              to: { line: number; ch: number },
              origin: string
            ): void
            getValue(): string
          }
        })
        | null
      const cm = host?.CodeMirror
      if (cm === undefined) throw new Error('Core Source editor is unavailable')
      cm.replaceRange('P', { line: 0, ch: 1 }, { line: 0, ch: 1 }, '+input')
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())

    expect(await page.evaluate(() => {
      const host = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { getValue(): string } })
        | null
      return host?.CodeMirror?.getValue()
    })).toBe('abPc\n')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('abPc\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode accepts one actor-owned Addition then undoes, redoes, and saves it', async() => {
  const source = 'before {++new++} after\n'
  const acceptedSource = 'before new after\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await enterSourceMode(page, app)
    await page.waitForFunction(() => window.__marktextDocumentCore?.mode === 'core')

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore as typeof window.__marktextDocumentCore & {
        resolveCriticMarkup?(
          kind: 'addition',
          start: number,
          end: number,
          decision: 'accept'
        ): Promise<void>
      }
      if (bridge?.resolveCriticMarkup === undefined) {
        throw new Error('Core Review command bridge is unavailable')
      }
      void bridge.resolveCriticMarkup('addition', 7, 16, 'accept')
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(acceptedSource)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    expect(await page.evaluate(() => {
      const host = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { getValue(): string } })
        | null
      return host?.CodeMirror?.getValue()
    })).toBe(source)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(acceptedSource)
    expect(await page.evaluate(() => {
      const host = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { getValue(): string } })
        | null
      return host?.CodeMirror?.getValue()
    })).toBe(acceptedSource)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode saves a native Source edit from the dedicated Worker authority', async() => {
  const source = 'head\n\nordinary text paragraph\n\ntail\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await enterSourceMode(page, app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await page.waitForFunction(
      () => window.__marktextDocumentCore?.mode === 'core',
      null,
      { timeout: 10_000 }
    )
    await page.evaluate(() => {
      const cm = (
        document.querySelector('.source-code .CodeMirror') as Element & {
          CodeMirror: {
            replaceRange(
              text: string,
              from: { line: number; ch: number },
              to: { line: number; ch: number },
              origin: string
            ): void
          }
        }
      ).CodeMirror
      cm.replaceRange(
        'TEXT',
        { line: 2, ch: 'ordinary '.length },
        { line: 2, ch: 'ordinary text'.length },
        '+input'
      )
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await page.waitForTimeout(100)
    expect(readFileSync(filePath, 'utf8')).toBe(source)

    const acknowledged = await page.evaluate(async() => {
      const bridge = window.__marktextDocumentCore
      if (!bridge) throw new Error('Core-mode diagnostic bridge is unavailable')
      await bridge.settled()
      return bridge.latest()
    })
    expect(acknowledged).toMatchObject({
      mode: 'core',
      worker: 'dedicated',
      revision: 2,
      sourceLength: source.length,
      requestedSourceSnapshots: 0,
      change: {
        appliedEdits: [{
          start: source.indexOf('text'),
          end: source.indexOf('text') + 4,
          insert: 'TEXT'
        }],
        projections: []
      }
    })
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(
      source.replace('text', 'TEXT')
    )
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

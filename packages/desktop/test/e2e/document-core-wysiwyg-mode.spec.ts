import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

import {
  enterSourceMode,
  exitSourceMode,
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchElectron,
  launchWithMarkdown,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady
} from './helpers'

test('Core mode owns a document opened directly in WYSIWYG', async() => {
  const source = 'direct\n'
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
      const bridge = window.__marktextDocumentCore
      if (bridge?.inputPlainText === undefined) {
        throw new Error('Core Muya test operation is unavailable')
      }
      bridge.inputPlainText(0, 'direct WYS', 'direct WYS'.length)
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await page.waitForTimeout(100)
    expect(readFileSync(filePath, 'utf8')).toBe(source)
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('direct WYS\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG tracks one visible insertion through actor history', async() => {
  const source = 'seed\n\nplain\n'
  const visibleTrackedText = 'seed{--X--}'
  const tracked = 'seed{++\\{--X\\--}++}\n\nplain\n'
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

    const track = page.getByTestId('critic-review-track-changes')
    await expect(track).toHaveAttribute('aria-pressed', 'false')
    await track.click()
    await expect(track).toHaveAttribute('aria-pressed', 'true')
    await page.evaluate((text) => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.inputPlainText === undefined) {
        throw new Error('Core Muya test operation is unavailable')
      }
      bridge.inputPlainText(0, text, text.length)
    }, visibleTrackedText)
    const paragraphs = page.locator('span.mu-paragraph-content')
    const renderedParagraphText = (index: number) => paragraphs.nth(index).evaluate(root => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
      let text = ''
      while (walker.nextNode()) {
        const node = walker.currentNode
        const glyph = node instanceof Element && node.matches('.mu-html-escape[data-character]')
          ? node
          : undefined
        if (!(node instanceof Text) && glyph === undefined) continue
        let element = glyph ?? node.parentElement
        let visible = true
        while (element !== null && element !== root.parentElement) {
          const style = getComputedStyle(element)
          if (
            style.display === 'none' || style.visibility === 'hidden' ||
            style.fontSize === '0px'
          ) {
            visible = false
            break
          }
          element = element.parentElement
        }
        if (visible && glyph !== undefined) {
          // Muya preserves source offsets in hidden marker text and renders
          // decoded escapes with its existing CSS ::before glyph.
          const content = getComputedStyle(glyph, '::before').content
          if (content !== 'none' && content !== 'normal') {
            text += glyph.getAttribute('data-character') ?? ''
          }
        } else if (visible && node instanceof Text) text += node.data
      }
      return text
    })
    await expect(paragraphs.nth(0)).toHaveAttribute('contenteditable', 'true')
    await expect(paragraphs.nth(1)).toHaveAttribute('contenteditable', 'true')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(paragraphs.nth(0)).toHaveText('seed\\{--X\\--}')
    await expect.poll(() => renderedParagraphText(0)).toBe(visibleTrackedText)
    const paragraph = paragraphs.first()
    await expect(paragraph).toHaveAttribute('contenteditable', 'true')
    await expect(paragraphs.nth(1)).toHaveAttribute('contenteditable', 'true')
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'addition')
    await expect(track).toHaveAttribute('aria-pressed', 'true')
    await paragraph.click()
    await page.keyboard.press('End')
    // A native word boundary gives continued typing its own undo group,
    // independent of how quickly the preceding save and assertions finish.
    await page.keyboard.type(' ?')
    await expect.poll(() => renderedParagraphText(0)).toBe(`${visibleTrackedText} ?`)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(
      'seed{++\\{--X\\--} ?++}\n\nplain\n'
    )
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect.poll(() => renderedParagraphText(0)).toBe('seed')
    await expect(paragraph).toHaveAttribute('contenteditable', 'true')
    await expect(paragraphs.nth(1)).toHaveAttribute('contenteditable', 'true')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(paragraphs.nth(0)).toHaveText('seed\\{--X\\--}')
    await expect.poll(() => renderedParagraphText(0)).toBe(visibleTrackedText)
    await expect(paragraph).toHaveAttribute('contenteditable', 'true')
    await expect(paragraphs.nth(1)).toHaveAttribute('contenteditable', 'true')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG cancels added text with one tracked backspace', async() => {
  const source = '{++seed++}\n'
  const tracked = '{++see++}\n'
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

    const paragraph = page.locator('span.mu-paragraph-content').first()
    await expect(paragraph).toHaveText('seed')
    await expect(paragraph).toHaveAttribute('contenteditable', 'true')
    await page.getByTestId('critic-review-track-changes').click()
    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.inputPlainText === undefined) {
        throw new Error('Core Muya tracked-backspace operation is unavailable')
      }
      bridge.inputPlainText(0, 'see', 3)
    })
    await expect.poll(() => page.evaluate(() =>
      window.__marktextDocumentCore?.latest()
    )).toMatchObject({ result: 'accepted', tracked: true })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(paragraph).toHaveText('see')
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'addition')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect(paragraph).toHaveText('seed')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(paragraph).toHaveText('see')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG removes an Addition when its final character is deleted', async() => {
  const source = '{++x++}\n'
  const tracked = '\n'
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

    const paragraph = page.locator('span.mu-paragraph-content').first()
    await expect(paragraph).toHaveText('x')
    await page.getByTestId('critic-review-track-changes').click()
    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.inputPlainText === undefined) {
        throw new Error('Core Muya final-addition deletion is unavailable')
      }
      bridge.inputPlainText(0, '', 0)
    })
    await expect.poll(() => page.evaluate(() =>
      window.__marktextDocumentCore?.latest()
    )).toMatchObject({ result: 'accepted', tracked: true })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(page.getByTestId('critic-review-kind')).toHaveCount(0)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect(paragraph).toHaveText('x')
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'addition')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(page.getByTestId('critic-review-kind')).toHaveCount(0)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG tracks one DOM composition as one actor transaction', async() => {
  const source = 'seed\n\nplain\n'
  const tracked = 'seed{++日本++}\n\nplain\n'
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
      () => window.__marktextDocumentCore?.composePlainText !== undefined
    )

    const track = page.getByTestId('critic-review-track-changes')
    await track.click()
    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.composePlainText === undefined) {
        throw new Error('Core Muya composition operation is unavailable')
      }
      bridge.composePlainText(0, ['日', '日本'])
    })
    const paragraphs = page.locator('span.mu-paragraph-content')
    await expect(paragraphs.nth(0)).toHaveAttribute('contenteditable', 'true')
    await expect(paragraphs.nth(1)).toHaveAttribute('contenteditable', 'true')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(paragraphs.nth(0)).toHaveText('seed日本')
    await expect(paragraphs.nth(0)).toHaveAttribute('contenteditable', 'true')
    await expect(paragraphs.nth(1)).toHaveAttribute('contenteditable', 'true')
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'addition')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect(paragraphs.nth(0)).toHaveText('seed')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(paragraphs.nth(0)).toHaveText('seed日本')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode renders all five CriticMarkup forms and preserves their source', async() => {
  const annotated =
    'before {++add++} {--del--} {~~old~>new~~} {==hi==} {>>note<<} after'
  const source = `${annotated}\n\neditable\n`
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
    await expect.poll(() => page.evaluate(() =>
      [...document.querySelectorAll('span.mu-paragraph-content')]
        .map(node => node.textContent)
    )).toEqual(['before add del oldnew hi  after', 'editable'])
    const paragraphs = page.locator('span.mu-paragraph-content')
    await expect(paragraphs.nth(0)).toHaveAttribute('contenteditable', 'true')
    await expect(paragraphs.nth(1)).toHaveAttribute('contenteditable', 'true')

    await page.evaluate(() => {
      window.__marktextDocumentCore?.inputPlainText?.(1, 'edited', 6)
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(
      `${annotated}\n\nedited\n`
    )
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG Review rejects one Deletion then undoes, redoes, and saves it', async() => {
  const source = 'before {--old--} after\n\neditable\n'
  const rejectedSource = 'before old after\n\neditable\n'
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
    const reject = page.getByTestId('critic-review-reject')
    await expect(reject).toBeVisible()
    await reject.click()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(rejectedSource)
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('before old after')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('before old after')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(rejectedSource)
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('before old after')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG Review navigation wraps without hiding its visible controls', async() => {
  const source = 'before {--old--} middle {++new++} after\n'
  const { app, page } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    const kind = page.getByTestId('critic-review-kind')
    const next = page.getByTestId('critic-review-next')
    const previous = page.getByTestId('critic-review-previous')

    await expect(kind).toHaveAttribute('data-kind', 'deletion')
    await next.click()
    await expect(kind).toHaveAttribute('data-kind', 'addition')
    await next.click()
    await expect(kind).toHaveAttribute('data-kind', 'deletion')
    await previous.click()
    await expect(kind).toHaveAttribute('data-kind', 'addition')

    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG Review removes one derived Commented span atomically', async() => {
  const source = 'before {==text==}{>>note<<} after\n'
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
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'commented-span')
    await expect(page.getByTestId('critic-review-accept')).toHaveCount(0)
    await expect(page.getByTestId('critic-review-reject')).toHaveCount(0)
    const remove = page.getByTestId('critic-review-remove')
    await expect(remove).toHaveText('Remove comment')

    await remove.click()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('before text after\n')
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('before text after')
    await expect(page.getByTestId('critic-review-kind')).toHaveCount(0)

    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG transports actor-owned Comment and Substitution author commands', async() => {
  const source = 'alpha selected\n\nomega\n'
  const expected = 'alpha {==selected==}{>>note<<}\n\n{~~omega~>replacement~~}\n'
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  const authorText = async(
    form: 'comment' | 'substitution',
    selectedText: string,
    payload: string
  ): Promise<void> => {
    await page.waitForFunction(
      () => window.__marktextDocumentCore?.authorPlainText !== undefined
    )
    await page.evaluate(({ form, selectedText, payload }) => {
      const paragraphs = Array.from(
        document.querySelectorAll('span.mu-paragraph-content')
      )
      const blockIndex = paragraphs.findIndex(paragraph =>
        paragraph.textContent?.includes(selectedText) === true
      )
      if (blockIndex < 0) throw new Error('Paragraph is unavailable')
      const start = paragraphs[blockIndex]?.textContent?.indexOf(selectedText) ?? -1
      const bridge = window.__marktextDocumentCore
      if (bridge?.authorPlainText === undefined) {
        throw new Error('Core test author bridge is unavailable')
      }
      return bridge.authorPlainText(
        form,
        blockIndex,
        start,
        start + selectedText.length,
        payload
      )
    }, { form, selectedText, payload })
    await expect.poll(() => page.evaluate(() =>
      (window.__marktextDocumentCore?.latest() as { result?: string })?.result
    )).toBe('author')
  }
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)

    const addComment = page.getByTestId('critic-review-add-comment')
    await expect(addComment).toBeVisible()
    await authorText('comment', 'selected', 'note')
    const authorResult = await page.evaluate(() =>
      window.__marktextDocumentCore?.latest()
    ) as { result?: string; form?: string }
    if (authorResult?.result !== 'author') {
      throw new Error(`Unexpected Core author result: ${JSON.stringify(authorResult)}`)
    }
    expect(authorResult).toMatchObject({ result: 'author', form: 'comment' })
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'commented-span')

    const trackReplacement = page.getByTestId('critic-review-track-replacement')
    await expect(trackReplacement).toBeVisible()
    await authorText('substitution', 'omega', 'replacement')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)

    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG authors a Comment through the visible selection control', async() => {
  const source = 'alpha selected omega\n'
  const expected = 'alpha {==selected==}{>>note<<} omega\n'
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
      () => window.__marktextDocumentCore?.selectPlainText !== undefined
    )
    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.selectPlainText === undefined) {
        throw new Error('Core test selection bridge is unavailable')
      }
      bridge.selectPlainText(0, 6, 14)
    })

    const addComment = page.getByTestId('critic-review-add-comment')
    await expect(addComment).toBeEnabled()
    await addComment.click()
    await page.getByTestId('critic-review-comment-input').fill('note')
    await page.getByTestId('critic-review-comment-submit').click()
    await expect.poll(() => page.evaluate(() =>
      (window.__marktextDocumentCore?.latest() as { result?: string })?.result
    )).toBe('author')
    const result = await page.evaluate(() => window.__marktextDocumentCore?.latest())
    if ((result as { outcome?: unknown } | undefined)?.outcome === undefined) {
      throw new Error(`Visible author command was rejected: ${JSON.stringify(result)}`)
    }
    expect(readFileSync(filePath, 'utf8')).toBe(source)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'commented-span')

    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG protects a conflicting Comment closer from the visible author control', async() => {
  const source = 'alpha selected omega\n'
  const comment = 'literal <<} tail'
  const expected = 'alpha {==selected==}{>>literal \\<<} tail<<} omega\n'
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
      () => window.__marktextDocumentCore?.selectPlainText !== undefined
    )
    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.selectPlainText === undefined) {
        throw new Error('Core test selection bridge is unavailable')
      }
      bridge.selectPlainText(0, 6, 14)
    })

    const addComment = page.getByTestId('critic-review-add-comment')
    await expect(addComment).toBeEnabled()
    await addComment.click()
    await page.getByTestId('critic-review-comment-input').fill(comment)
    await page.getByTestId('critic-review-comment-submit').click()
    await expect.poll(() => page.evaluate(() =>
      (window.__marktextDocumentCore?.latest() as {
        outcome?: { type?: string }
      })?.outcome?.type
    )).toBe('applied')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)

    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core completes one CriticMarkup Review lifecycle and reopens exact bytes', async() => {
  const source =
    '{++add++} {--del--} {~~old~>new~~} {==hi==} {>>note<<}\n\n' +
    'comment target\n\nreplace target\n'
  const expected =
    'add del {~~old~>new~~} {==hi==} {>>note<<}\n\n' +
    '{==comment==}{>>review note<<} target\n\n' +
    '{~~replace~>replaced~~} target\n'
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
      () => window.__marktextDocumentCore?.selectPlainText !== undefined
    )

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.selectPlainText === undefined) throw new Error('Selection unavailable')
      bridge.selectPlainText(1, 0, 7)
    })
    await page.getByTestId('critic-review-add-comment').click()
    await page.getByTestId('critic-review-comment-input').fill('review note')
    await page.getByTestId('critic-review-comment-submit').click()
    await expect.poll(() => page.evaluate(() =>
      (window.__marktextDocumentCore?.latest() as {
        outcome?: { type?: string }
      })?.outcome?.type
    )).toBe('applied')

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.selectPlainText === undefined) throw new Error('Selection unavailable')
      bridge.selectPlainText(2, 0, 7)
      window.prompt = () => 'replaced'
    })
    await page.getByTestId('critic-review-track-replacement').click()
    await expect.poll(() => page.evaluate(() =>
      (window.__marktextDocumentCore?.latest() as {
        form?: string
        outcome?: { type?: string }
      })
    )).toMatchObject({ form: 'substitution', outcome: { type: 'applied' } })

    const kind = page.getByTestId('critic-review-kind')
    await expect(kind).toHaveAttribute('data-kind', 'addition')
    await page.getByTestId('critic-review-accept').click()
    await expect(kind).toHaveAttribute('data-kind', 'deletion')
    await page.getByTestId('critic-review-reject').click()
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await expect(kind).toHaveAttribute('data-kind', 'deletion')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await expect(kind).toHaveAttribute('data-kind', 'substitution')

    await enterSourceMode(page, app)
    await page.waitForFunction(() => window.__marktextDocumentCore?.mode === 'core')
    await exitSourceMode(page, app)
    await page.waitForFunction(
      () => window.__marktextDocumentCore?.selectPlainText !== undefined
    )
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }

  const reopened = await launchElectron([filePath], {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  try {
    await waitForEditor(reopened.page)
    await waitForMenuReady(reopened.app)
    await expectEditorWindowHidden(reopened.app)
    expectEditorNotFrontmost(reopened.app)
    await reopened.page.waitForFunction(
      () => window.__marktextDocumentCore?.selectPlainText !== undefined
    )
    await expect(reopened.page.getByTestId('critic-review-kind')).toHaveAttribute(
      'data-kind',
      'substitution'
    )
    await expect.poll(() => reopened.page.evaluate(() =>
      [...document.querySelectorAll('span.mu-paragraph-content')]
        .map(node => node.textContent)
    )).toEqual([
      'add del oldnew hi ',
      'comment target',
      'replacereplaced target'
    ])
    await expectNoRendererErrors(reopened.app)
  } finally {
    await reopened.app.close()
  }
})

test('Core mode parks independent WYSIWYG authority and history per tab', async() => {
  const { app, page } = await launchWithMarkdown('alpha\n', {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    }
  })
  const activeTabId = () => page.evaluate(() =>
    document.querySelector('.tabs-container > li.active')?.getAttribute('data-id') ?? null
  )
  const tabIds = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('.tabs-container > li')).map(
      item => item.getAttribute('data-id') ?? ''
    )
  )
  try {
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    const aId = await activeTabId()
    expect(aId).toBeTruthy()
    await page.waitForFunction(
      id => window.__marktextDocumentCore?.documentId === id,
      aId
    )
    await page.evaluate(() => {
      window.__marktextDocumentCore?.inputPlainText?.(0, 'alpha A', 7)
    })
    await page.evaluate(() => window.__marktextDocumentCore?.settled())

    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'bravo\n')
    await expect.poll(activeTabId).not.toBe(aId)
    const bId = await activeTabId()
    expect(bId).toBeTruthy()
    await page.waitForFunction(
      id => window.__marktextDocumentCore?.documentId === id,
      bId
    )
    await page.evaluate(() => {
      window.__marktextDocumentCore?.inputPlainText?.(0, 'bravo B', 7)
    })
    await page.evaluate(() => window.__marktextDocumentCore?.settled())

    const ids = await tabIds()
    await sendIpcToRenderer(app, 'mt::switch-tab-by-index', ids.indexOf(aId as string))
    await page.waitForFunction(
      id => window.__marktextDocumentCore?.documentId === id,
      aId
    )
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('alpha A')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('alpha')

    await sendIpcToRenderer(app, 'mt::switch-tab-by-index', ids.indexOf(bId as string))
    await page.waitForFunction(
      id => window.__marktextDocumentCore?.documentId === id,
      bId
    )
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('bravo B')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode applies a native blockquote command through acknowledged history', async() => {
  const source = 'plain\n'
  const quoted = '> plain\n'
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
    const initialGeneration = await page.evaluate(() =>
      window.__marktextDocumentCore?.generation
    )
    expect(initialGeneration).toBeDefined()
    await page.locator('span.mu-paragraph-content').first().click()
    await page.keyboard.press('End')
    await sendIpcToRenderer(app, 'mt::editor-paragraph-action', { type: 'blockquote' })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(quoted)
    await expect.poll(() => page.evaluate(() =>
      window.__marktextDocumentCore?.latest()
    )).toMatchObject({ result: 'accepted' })
    await expect(page.locator('.editor-component blockquote')).toHaveText('plain')
    expect(await page.evaluate(() => window.__marktextDocumentCore?.generation))
      .toBe(initialGeneration)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect(page.locator('.editor-component blockquote')).toHaveCount(0)
    await expect(page.locator('span.mu-paragraph-content')).toHaveText('plain')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(quoted)
    const paragraph = page.locator('.editor-component blockquote span.mu-paragraph-content')
    await expect(paragraph).toHaveText('plain')
    await paragraph.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('> plain!\n')
    await expect(paragraph).toHaveText('plain!')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode restarts a failed Worker from acknowledged WYSIWYG history', async() => {
  const source = 'seed\n'
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
    const initialGeneration = await page.evaluate(() =>
      window.__marktextDocumentCore?.generation
    )
    expect(initialGeneration).toBeDefined()

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      bridge?.inputPlainText?.(0, 'accepted', 8)
    })
    await page.evaluate(() => window.__marktextDocumentCore?.settled())

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.crashWorker === undefined) {
        throw new Error('Core Worker failure operation is unavailable')
      }
      bridge.inputPlainText?.(0, 'speculative', 11)
      bridge.crashWorker()
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await page.waitForFunction(generation =>
      window.__marktextDocumentCore?.inputPlainText !== undefined &&
      window.__marktextDocumentCore.generation !== generation,
    initialGeneration)
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('accepted')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('accepted\n')

    await page.evaluate(() => {
      window.__marktextDocumentCore?.inputPlainText?.(0, 'recovered', 9)
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('recovered\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode recovers a typed stale-base WYSIWYG transaction', async() => {
  const source = 'seed\n'
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
    const initialGeneration = await page.evaluate(() =>
      window.__marktextDocumentCore?.generation
    )
    expect(initialGeneration).toBeDefined()

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      bridge?.inputPlainText?.(0, 'accepted', 8)
    })
    await page.evaluate(() => window.__marktextDocumentCore?.settled())
    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.staleNextTransaction === undefined) {
        throw new Error('Core stale-base test operation is unavailable')
      }
      bridge.staleNextTransaction()
      bridge.inputPlainText?.(0, 'speculative', 11)
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await page.waitForFunction(generation =>
      window.__marktextDocumentCore?.inputPlainText !== undefined &&
      window.__marktextDocumentCore.generation !== generation,
    initialGeneration)
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('accepted')
    expect(readFileSync(filePath, 'utf8')).toBe(source)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('accepted\n')
    await page.evaluate(() => {
      window.__marktextDocumentCore?.inputPlainText?.(0, 'after stale', 11)
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('after stale\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode saves a native plain-paragraph WYSIWYG edit', async() => {
  const source = 'head\n\nmiddle\n\ntail\n'
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
    await exitSourceMode(page, app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await page.waitForFunction(
      () => window.__marktextDocumentCore?.inputPlainText !== undefined
    )

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.inputPlainText === undefined) {
        throw new Error('Core Muya test operation is unavailable')
      }
      bridge.inputPlainText(1, 'middle WYS', 'middle WYS'.length)
    })
    await expect.poll(() => page.evaluate(() =>
      document.querySelectorAll('span.mu-paragraph-content')[1]?.textContent
    )).toBe('middle WYS')
    await expect.poll(() => page.evaluate(() =>
      window.__marktextDocumentCore?.latest()
    )).toMatchObject({ result: 'accepted' })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await page.waitForTimeout(100)
    expect(readFileSync(filePath, 'utf8')).toBe(source)
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(
      'head\n\nmiddle WYS\n\ntail\n'
    )
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode orders immediate WYSIWYG undo and redo through actor history', async() => {
  const source = 'seed\n'
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
    await exitSourceMode(page, app)
    await page.waitForFunction(
      () => window.__marktextDocumentCore?.inputPlainText !== undefined
    )

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.inputPlainText === undefined) {
        throw new Error('Core Muya test operation is unavailable')
      }
      bridge.inputPlainText(0, 'seed!', 'seed!'.length)
    })
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())

    await expect.poll(() => page.evaluate(() =>
      window.__marktextDocumentCore?.latest()
    )).toMatchObject({
      result: 'history',
      command: 'undo',
      outcome: { type: 'applied', revision: 3 },
      state: { status: 'ready', revision: 3 }
    })
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('seed')
    await page.waitForTimeout(350)
    expect(readFileSync(filePath, 'utf8')).toBe(source)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await page.evaluate(() => window.__marktextDocumentCore?.settled())

    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('seed!')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('seed!\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode saves a native paragraph-to-heading conversion', async() => {
  const source = 'plain\n'
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
    await exitSourceMode(page, app)
    await page.waitForFunction(
      () => window.__marktextDocumentCore?.inputPlainText !== undefined
    )

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.inputPlainText === undefined) {
        throw new Error('Core Muya test operation is unavailable')
      }
      bridge.inputPlainText(0, '# title', '# title'.length)
    })
    await expect.poll(() => page.evaluate(() =>
      window.__marktextDocumentCore?.latest()
    )).toMatchObject({ result: 'accepted' })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await page.waitForTimeout(100)
    expect(readFileSync(filePath, 'utf8')).toBe(source)
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('# title\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG tracks one paragraph-to-heading format through history', async() => {
  const source = 'plain\n'
  const tracked = '{~~plain~># title~~}\n'
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

    await page.getByTestId('critic-review-track-changes').click()
    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.inputPlainText === undefined) {
        throw new Error('Core Muya heading-format operation is unavailable')
      }
      bridge.inputPlainText(0, '# title', '# title'.length)
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    const heading = page.locator('.editor-component h1')
    await expect(heading).toBeVisible()
    await expect(heading.locator('[data-critic-arm="new"]')).toHaveText('# title')
    await expect(page.locator('.editor-component p [data-critic-arm="old"]')).toHaveText('plain')
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'substitution')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect(page.locator('span.mu-paragraph-content')).toHaveText('plain')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(heading).toBeVisible()
    await expect(heading.locator('[data-critic-arm="new"]')).toHaveText('# title')
    await expect(page.locator('.editor-component p [data-critic-arm="old"]')).toHaveText('plain')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode saves one native cross-paragraph typing replacement', async() => {
  const source = 'alpha\n\nbeta\n\ngamma\n'
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
    await exitSourceMode(page, app)
    await page.waitForFunction(
      () => window.__marktextDocumentCore?.replacePlainTextAcrossBlocks !== undefined
    )

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.replacePlainTextAcrossBlocks === undefined) {
        throw new Error('Core Muya cross-block test operation is unavailable')
      }
      bridge.replacePlainTextAcrossBlocks(0, 2, 2, 2, 'X')
    })
    await expect.poll(() => page.evaluate(() =>
      window.__marktextDocumentCore?.latest()
    )).toMatchObject({ result: 'accepted' })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await page.waitForTimeout(100)
    expect(readFileSync(filePath, 'utf8')).toBe(source)
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('alXmma\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG tracks one cross-paragraph replacement and exact history', async() => {
  const source = 'alpha\n\nbeta\n\ngamma\n'
  const tracked = 'al{~~pha\n\nbeta\n\nga~>X~~}mma\n'
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
      () => window.__marktextDocumentCore?.replacePlainTextAcrossBlocks !== undefined
    )

    await page.getByTestId('critic-review-track-changes').click()
    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.replacePlainTextAcrossBlocks === undefined) {
        throw new Error('Core Muya cross-block test operation is unavailable')
      }
      bridge.replacePlainTextAcrossBlocks(0, 2, 2, 2, 'X')
    })
    const paragraphs = page.locator('span.mu-paragraph-content')
    await expect(paragraphs.first()).toHaveAttribute('contenteditable', 'true')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(paragraphs).toHaveText(['alpha', 'beta', 'gaXmma'])
    await expect(paragraphs.nth(0).locator('[data-critic-arm=old]')).toHaveText('pha')
    await expect(paragraphs.nth(1).locator('[data-critic-arm=old]')).toHaveText('beta')
    await expect(paragraphs.nth(2).locator('[data-critic-arm=old]')).toHaveText('ga')
    await expect(paragraphs.nth(2).locator('[data-critic-arm=new]')).toHaveText('X')
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'substitution')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect(paragraphs).toHaveText(['alpha', 'beta', 'gamma'])
    await expect(paragraphs.locator('[data-critic-kind]')).toHaveCount(0)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(paragraphs).toHaveText(['alpha', 'beta', 'gaXmma'])
    await expect(paragraphs.nth(0).locator('[data-critic-arm=old]')).toHaveText('pha')
    await expect(paragraphs.nth(1).locator('[data-critic-arm=old]')).toHaveText('beta')
    await expect(paragraphs.nth(2).locator('[data-critic-arm=old]')).toHaveText('ga')
    await expect(paragraphs.nth(2).locator('[data-critic-arm=new]')).toHaveText('X')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG tracks one cross-paragraph cut and exact history', async() => {
  const source = 'alpha\n\nbeta\n\ngamma\n'
  const tracked = 'al{--pha\n\nbeta\n\nga--}mma\n'
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
      () => window.__marktextDocumentCore?.replacePlainTextAcrossBlocks !== undefined
    )

    await page.getByTestId('critic-review-track-changes').click()
    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.replacePlainTextAcrossBlocks === undefined) {
        throw new Error('Core Muya cross-block cut operation is unavailable')
      }
      bridge.replacePlainTextAcrossBlocks(0, 2, 2, 2, '')
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    const paragraphs = page.locator('span.mu-paragraph-content')

    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(paragraphs).toHaveText(['alpha', 'beta', 'gamma'])
    await expect(paragraphs.nth(0).locator('[data-critic-kind=deletion]')).toHaveText('pha')
    await expect(paragraphs.nth(1).locator('[data-critic-kind=deletion]')).toHaveText('beta')
    await expect(paragraphs.nth(2).locator('[data-critic-kind=deletion]')).toHaveText('ga')
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'deletion')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect(paragraphs).toHaveText(['alpha', 'beta', 'gamma'])
    await expect(paragraphs.locator('[data-critic-kind]')).toHaveCount(0)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect(paragraphs).toHaveText(['alpha', 'beta', 'gamma'])
    await expect(paragraphs.nth(0).locator('[data-critic-kind=deletion]')).toHaveText('pha')
    await expect(paragraphs.nth(1).locator('[data-critic-kind=deletion]')).toHaveText('beta')
    await expect(paragraphs.nth(2).locator('[data-critic-kind=deletion]')).toHaveText('ga')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode saves only the committed native IME composition', async() => {
  const source = 'seed\n'
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
    await exitSourceMode(page, app)
    await page.waitForFunction(
      () => window.__marktextDocumentCore?.composePlainText !== undefined
    )

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.composePlainText === undefined) {
        throw new Error('Core Muya composition test operation is unavailable')
      }
      bridge.composePlainText(0, ['に', '日本'])
    })
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await page.waitForTimeout(100)
    expect(readFileSync(filePath, 'utf8')).toBe(source)
    await expect.poll(() => page.evaluate(() =>
      window.__marktextDocumentCore?.latest()
    )).toMatchObject({ result: 'accepted' })
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('seed日本\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode renders and saves one native math-block conversion', async() => {
  const source = 'seed\n'
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
    await exitSourceMode(page, app)
    await page.waitForFunction(
      () => window.__marktextDocumentCore?.inputMathBlock !== undefined
    )

    await page.evaluate(() => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.inputMathBlock === undefined) {
        throw new Error('Core Muya math test operation is unavailable')
      }
      bridge.inputMathBlock(0, 'x^2')
    })
    await expect.poll(() => page.evaluate(() =>
      document.querySelectorAll('.mu-math-preview .katex').length
    )).toBe(1)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await page.waitForTimeout(100)
    expect(readFileSync(filePath, 'utf8')).toBe(source)
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('$$\nx^2\n$$\n')
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core mode saves one native Markdown table paste', async() => {
  const source = 'seed\n'
  const table = '| a | b |\n| - | - |\n| 1 | 2 |'
  const canonical = '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n'
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
    await exitSourceMode(page, app)
    await page.waitForFunction(
      () => window.__marktextDocumentCore?.pasteMarkdownTable !== undefined
    )

    await page.evaluate(async(markdown) => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.pasteMarkdownTable === undefined) {
        throw new Error('Core Muya table-paste test operation is unavailable')
      }
      await bridge.pasteMarkdownTable(0, markdown)
    }, table)
    await expect.poll(() => page.evaluate(() =>
      document.querySelectorAll('.editor-component table').length
    )).toBe(1)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await page.waitForTimeout(100)
    expect(readFileSync(filePath, 'utf8')).toBe(source)
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(canonical)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Core WYSIWYG tracks one Markdown table paste through actor history', async() => {
  const source = 'seed\n'
  const table = '| a | b |\n| - | - |\n| 1 | 2 |'
  const canonical = '| a   | b   |\n| --- | --- |\n| 1   | 2   |'
  const tracked = `{~~seed~>${canonical}~~}\n`
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
      () => window.__marktextDocumentCore?.pasteMarkdownTable !== undefined
    )

    await page.getByTestId('critic-review-track-changes').click()
    await page.evaluate(async(markdown) => {
      const bridge = window.__marktextDocumentCore
      if (bridge?.pasteMarkdownTable === undefined) {
        throw new Error('Core Muya table-paste test operation is unavailable')
      }
      await bridge.pasteMarkdownTable(0, markdown)
    }, table)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')

    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect.poll(() => page.evaluate(() =>
      document.querySelectorAll('.editor-component table').length
    )).toBe(1)
    await expect(page.getByTestId('critic-review-kind')).toHaveAttribute('data-kind', 'substitution')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await expect.poll(() => page.evaluate(() =>
      document.querySelector('span.mu-paragraph-content')?.textContent
    )).toBe('seed')

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(tracked)
    await expect.poll(() => page.evaluate(() =>
      document.querySelectorAll('.editor-component table').length
    )).toBe(1)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

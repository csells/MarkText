import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import {
  clickMenuById,
  launchWithMarkdown,
  waitForMenuReady,
  getMarkdownContent,
  sendIpcToRenderer,
  enterSourceMode
} from './helpers'

type SourceCodeMirrorElement = Element & {
  CodeMirror?: {
    getValue(): string
    firstLine(): number
    getLine(line: number): string
    lastLine(): number
    replaceRange(
      replacement: string,
      from: { line: number; ch: number },
      to?: { line: number; ch: number }
    ): void
    setValue(value: string): void
  }
}

const isDirty = (page: Page): Promise<boolean> =>
  page.evaluate(() => !!document.querySelector('.editor-tabs li.unsaved'))

const openCommentsSidebar = async(page: Page, app: Parameters<typeof sendIpcToRenderer>[0]): Promise<void> => {
  if (!(await page.locator('.side-bar').isVisible())) {
    await clickMenuById(app, 'sideBarMenuItem')
  }

  await page.locator('.side-bar .left-column > ul').first().locator('li').nth(3).click()
  await page.waitForSelector('.side-bar-comments', { state: 'visible', timeout: 10000 })
}

const sourceValue = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const cm = document.querySelector('.source-code .CodeMirror') as SourceCodeMirrorElement | null
    return cm?.CodeMirror?.getValue() ?? ''
  })

const setSourceValue = async(page: Page, markdown: string): Promise<void> => {
  await page.evaluate((value) => {
    const cm = document.querySelector('.source-code .CodeMirror') as SourceCodeMirrorElement | null
    if (!cm?.CodeMirror) throw new Error('CodeMirror is not available')
    cm.CodeMirror.setValue(value)
  }, markdown)
}

const replaceSourceValue = async(page: Page, markdown: string): Promise<void> => {
  await page.evaluate((value) => {
    const cm = document.querySelector('.source-code .CodeMirror') as SourceCodeMirrorElement | null
    const editor = cm?.CodeMirror
    if (!editor) throw new Error('CodeMirror is not available')
    const firstLine = editor.firstLine()
    const lastLine = editor.lastLine()
    editor.replaceRange(value, { line: firstLine, ch: 0 }, {
      line: lastLine,
      ch: editor.getLine(lastLine).length
    })
  }, markdown)
}

// Trigger an editor undo through the same IPC channel the Edit › Undo menu item
// uses (`mt::editor-edit-action` → bus `undo` → editor.undo()).
const undo = async(app: Parameters<typeof sendIpcToRenderer>[0]): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
}

const expectMergeConflictPrompt = async(page: Page): Promise<void> => {
  await expect(page.locator('.editor-notifications')).toContainText(
    'Resolve the merge to continue',
    { timeout: 12000 }
  )
  await expect(page.locator('.merge-conflict-dialog')).toBeVisible()
}

const reloadDiskFromMergeConflict = async(page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Reload Disk' }).click()
  await expect(page.locator('.merge-conflict-dialog')).toBeHidden()
}

// Reproduce the watcher's external-change report: the same `mt::update-file`
// payload shape the main-process watcher sends (a `loadMarkdownFile` result in
// `change.data`). Drives the real renderer reload path
// LISTEN_FOR_FILE_CHANGE → loadChange → bus `file-changed` → handleFileChange.
const reportExternalChange = async(
  app: Parameters<typeof sendIpcToRenderer>[0],
  pathname: string,
  markdown: string
): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::update-file', {
    type: 'change',
    change: {
      pathname,
      mtimeMs: 1,
      data: {
        markdown,
        filename: 'note.md',
        pathname,
        encoding: { encoding: 'utf8', hasBOM: false },
        lineEnding: 'lf',
        adjustLineEndingOnSave: false,
        trimTrailingNewline: 1,
        isMixedLineEndings: false
      }
    }
  })
}

test.describe('External disk reload — undo restores the pre-change document', () => {
  // Legacy muyajs kept a full-state snapshot of the pre-reload document so the
  // first Ctrl+Z after an external reload restored it. The @muyajs/core reload
  // path must record the same single invertible undo boundary (via
  // `Muya.replaceContent`) instead of `setContent` (which clears history).
  test('first undo after an external reload restores the old content', async() => {
    const { app, page, filePath } = await launchWithMarkdown('old content here\n')
    await waitForMenuReady(app)

    await reportExternalChange(app, filePath, 'new content here\n')
    await page.waitForTimeout(600)

    // The tab now reflects the new on-disk content...
    expect((await getMarkdownContent(page)).trim()).toBe('new content here')
    // ...and stays clean: the reloaded content matches the file on disk, so the
    // tab must NOT be flagged unsaved (replaceContent fires a json-change that
    // would otherwise mark it dirty against the stale baseline).
    expect(await page.evaluate(() => !!document.querySelector('.editor-tabs li.unsaved'))).toBe(
      false
    )
    await expect(page.locator('.editor-notifications')).toHaveCount(0)

    // The first undo reverts the external change in one step, back to the
    // document as it was before the reload.
    await undo(app)
    await page.waitForTimeout(600)
    expect((await getMarkdownContent(page)).trim()).toBe('old content here')
    // The undone document now diverges from on-disk content, so the tab is dirty.
    await expect
      .poll(() => page.evaluate(() => !!document.querySelector('.editor-tabs li.unsaved')))
      .toBe(true)
    await app.close()
  })

  test('clean reload updates comment highlights, sidebar state, diagnostics, and undo boundary', async() => {
    const before = 'plain content before agent edit\n'
    const after = [
      'Agent added <!--MC:a-->reviewed<!--MC:~a--> content.',
      '',
      '[MC:a]: {"version":2,"status":"open","authors":["Agent"]}',
      '[MC:a.0]: {"author":"Agent","createdAt":"2026-06-30T12:00:00.000Z","body":"Please review this change."}',
      ''
    ].join('\n')
    const { app, page, filePath } = await launchWithMarkdown(before)
    await waitForMenuReady(app)

    await openCommentsSidebar(page, app)
    await expect(page.locator('.side-bar-comments .thread')).toHaveCount(0)
    await expect(page.locator('.side-bar-comments .diagnostic')).toHaveCount(0)

    await reportExternalChange(app, filePath, after)

    await expect.poll(() => getMarkdownContent(page), { timeout: 5000 }).toBe(after)
    await expect(page.locator('.mu-comment-highlight')).toHaveText('reviewed')
    await expect(page.locator('.side-bar-comments .thread')).toHaveCount(1)
    await expect(page.locator('.side-bar-comments .reply p')).toHaveText(
      'Please review this change.'
    )
    await expect(page.locator('.side-bar-comments .diagnostic')).toHaveCount(0)
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)

    await undo(app)

    await expect.poll(() => getMarkdownContent(page), { timeout: 5000 }).toBe(before)
    await expect(page.locator('.mu-comment-highlight')).toHaveCount(0)
    await expect(page.locator('.side-bar-comments .thread')).toHaveCount(0)
    await expect(page.locator('.side-bar-comments .diagnostic')).toHaveCount(0)
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })

  test('clean source-mode reload refreshes sidebar threads and diagnostics', async() => {
    const before = 'plain source content before agent edit\n'
    const after = [
      'Agent added <!--MC:a-->reviewed<!--MC:~a--> content.',
      '',
      'Bad <!--MC:bad.id--> marker.',
      '',
      '[MC:a]: {"version":2,"status":"open","authors":["Agent"]}',
      '[MC:a.0]: {"author":"Agent","createdAt":"2026-06-30T12:00:00.000Z","body":"Please review this source-mode change."}',
      ''
    ].join('\n')
    const { app, page, filePath } = await launchWithMarkdown(before)
    await waitForMenuReady(app)
    await enterSourceMode(page, app)
    await openCommentsSidebar(page, app)

    await reportExternalChange(app, filePath, after)

    await expect.poll(() => sourceValue(page), { timeout: 5000 }).toBe(after)
    await expect(page.locator('.side-bar-comments .thread')).toHaveCount(1)
    await expect(page.locator('.side-bar-comments .reply p')).toHaveText(
      'Please review this source-mode change.'
    )
    await expect(page.locator('.side-bar-comments .diagnostic-code')).toContainText([
      'malformed-marker'
    ])
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)

    await undo(app)

    await expect.poll(() => sourceValue(page), { timeout: 5000 }).toBe(before)
    await expect(page.locator('.side-bar-comments .thread')).toHaveCount(0)
    await expect(page.locator('.side-bar-comments .diagnostic')).toHaveCount(0)
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })
})

test.describe('External disk reload — dirty buffers are not overwritten', () => {
  test('dirty WYSIWYG content prompts and keeps the local buffer', async() => {
    const { app, page, filePath } = await launchWithMarkdown('old content here\n')
    await waitForMenuReady(app)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'selectAll')
    await page.keyboard.type('local dirty content\n', { delay: 0 })
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    await reportExternalChange(app, filePath, 'agent content here\n')
    await page.waitForTimeout(600)

    expect(await getMarkdownContent(page)).toBe('local dirty content\n')
    await expectMergeConflictPrompt(page)
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })

  test('dirty source content prompts and keeps the CodeMirror buffer', async() => {
    const { app, page, filePath } = await launchWithMarkdown('old content here\n')
    await waitForMenuReady(app)
    await enterSourceMode(page, app)

    await setSourceValue(page, 'local source dirty content\n')
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    await reportExternalChange(app, filePath, 'agent source content here\n')
    await page.waitForTimeout(600)

    expect(await sourceValue(page)).toBe('local source dirty content\n')
    await expectMergeConflictPrompt(page)
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })

  test('dirty WYSIWYG conflict can be resolved through the merge dialog', async() => {
    const { app, page, filePath } = await launchWithMarkdown('one\nshared\nthree\n')
    await waitForMenuReady(app)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'selectAll')
    await page.keyboard.type('one\nlocal\nthree\n', { delay: 0 })
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    await reportExternalChange(app, filePath, 'one\nremote\nthree\n')
    await expectMergeConflictPrompt(page)

    await page.getByRole('button', { name: 'Use Disk' }).click()
    await page.getByRole('button', { name: 'Accept Merge' }).click()

    await expect(page.locator('.merge-conflict-dialog')).toBeHidden()
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await expect.poll(() => getMarkdownContent(page), { timeout: 5000 }).toBe(
      'one\nremote\nthree\n'
    )
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })

  test('merge dialog Use Yours resolves a conflict to the local edit', async() => {
    const { app, page, filePath } = await launchWithMarkdown('one\nshared\nthree\n')
    await waitForMenuReady(app)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'selectAll')
    await page.keyboard.type('one\nlocal\nthree\n', { delay: 0 })
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    await reportExternalChange(app, filePath, 'one\nremote\nthree\n')
    await expectMergeConflictPrompt(page)

    await page.getByRole('button', { name: 'Use Yours' }).click()
    await page.getByRole('button', { name: 'Accept Merge' }).click()

    await expect(page.locator('.merge-conflict-dialog')).toBeHidden()
    // Use Yours resolves the conflict to the local edit: local kept, disk
    // dropped, no leftover conflict scaffolding. (Exact bytes depend on the
    // WYSIWYG paragraph round-trip, so assert the resolution, not the layout.)
    const yoursResult = await getMarkdownContent(page)
    expect(yoursResult).toContain('local')
    expect(yoursResult).not.toContain('remote')
    expect(yoursResult).not.toContain('MARKTEXT_LOCAL')
    await app.close()
  })

  test('merge dialog Use Both keeps the local and disk edits', async() => {
    const { app, page, filePath } = await launchWithMarkdown('one\nshared\nthree\n')
    await waitForMenuReady(app)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'selectAll')
    await page.keyboard.type('one\nlocal\nthree\n', { delay: 0 })
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    await reportExternalChange(app, filePath, 'one\nremote\nthree\n')
    await expectMergeConflictPrompt(page)

    await page.getByRole('button', { name: 'Use Both' }).click()
    await page.getByRole('button', { name: 'Accept Merge' }).click()

    await expect(page.locator('.merge-conflict-dialog')).toBeHidden()
    // Use Both keeps local AND disk edits, no leftover conflict scaffolding.
    const bothResult = await getMarkdownContent(page)
    expect(bothResult).toContain('local')
    expect(bothResult).toContain('remote')
    expect(bothResult).not.toContain('MARKTEXT_LOCAL')
    await app.close()
  })

  test('dirty byte-equivalent external content clears the local dirty state', async() => {
    const { app, page, filePath } = await launchWithMarkdown('old content here\n')
    await waitForMenuReady(app)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'selectAll')
    await page.keyboard.type('local content now on disk\n', { delay: 0 })
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    await reportExternalChange(app, filePath, 'local content now on disk\n')

    expect(await getMarkdownContent(page)).toBe('local content now on disk\n')
    await expect(page.locator('.editor-notifications')).toHaveCount(0)
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)
    await app.close()
  })
})

// The flagship agent flow: the user is mid-edit (dirty buffer) while an agent
// rewrites a DIFFERENT part of the file on disk. The disjoint edits must merge
// automatically into the live editor — no dialog — leaving the tab dirty, with
// the auto-merged notification offering Undo (restore the pre-merge local
// buffer) and Review (open the resolver on the clean merge).
test.describe('External disk changes — clean auto-merge into a dirty editor (agent flow)', () => {
  const AGENT_BASE = 'alpha start\n\nbravo middle\n\ncharlie end\n'
  const agentMetaLines = [
    '[MC:agent1]: {"version":2,"status":"open"}',
    '[MC:agent1.0]: {"author":"Agent","createdAt":"2026-07-06T12:00:00.000Z","body":"Please review this section."}'
  ].join('\n')
  const AGENT_DOC =
    `alpha start\n\nbravo middle\n\n<!--MC:agent1-->charlie end<!--MC:~agent1-->\n\n${agentMetaLines}\n`
  const MERGED_DOC =
    `alpha start (edited)\n\nbravo middle\n\n<!--MC:agent1-->charlie end<!--MC:~agent1-->\n\n${agentMetaLines}\n`

  const editorText = (page: Page): Promise<string> =>
    page.evaluate(() => document.querySelector('.mu-editor')?.textContent ?? '')

  const editFirstParagraph = async(page: Page): Promise<void> => {
    await page.locator('.mu-paragraph', { hasText: 'alpha start' }).first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' (edited)', { delay: 0 })
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
  }

  const expectAutoMerged = async(page: Page): Promise<void> => {
    await expect(page.locator('.editor-notifications')).toContainText(
      'Merged disk changes into your unsaved edits',
      { timeout: 12000 }
    )
    await expect(page.locator('.merge-conflict-dialog')).toBeHidden()
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await expect.poll(() => editorText(page), { timeout: 8000 }).toContain('alpha start (edited)')
    // The runtime text is clean — the merged comment shows as a highlight.
    await expect(page.locator('.mu-comment-highlight')).toHaveText('charlie end', {
      timeout: 8000
    })
  }

  test('WYSIWYG: a disjoint agent edit auto-merges into the dirty buffer; Undo restores it', async() => {
    const { app, page, filePath } = await launchWithMarkdown(AGENT_BASE)
    await waitForMenuReady(app)

    await editFirstParagraph(page)
    await reportExternalChange(app, filePath, AGENT_DOC)
    await expectAutoMerged(page)

    // The agent's comment thread is live in the sidebar after the merge.
    await openCommentsSidebar(page, app)
    await expect(page.locator('.side-bar-comments [data-comment-id="agent1"]')).toBeVisible()
    await expect(page.locator('.side-bar-comments')).toContainText('Please review this section.')

    // Undo on the notification restores the pre-merge local buffer, still dirty.
    await page.locator('.editor-notifications').getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.mu-comment-highlight')).toHaveCount(0, { timeout: 8000 })
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    expect(await getMarkdownContent(page)).toBe(
      'alpha start (edited)\n\nbravo middle\n\ncharlie end\n'
    )
    await app.close()
  })

  test('WYSIWYG: Review on the auto-merge notification opens the resolver with no conflicts', async() => {
    const { app, page, filePath } = await launchWithMarkdown(AGENT_BASE)
    await waitForMenuReady(app)

    await editFirstParagraph(page)
    await reportExternalChange(app, filePath, AGENT_DOC)
    await expectAutoMerged(page)

    await page.locator('.editor-notifications').getByRole('button', { name: 'Review' }).click()
    await expect(page.locator('.merge-conflict-dialog')).toBeVisible()
    // A clean merge has no per-conflict rows; the header names the file.
    await expect(page.locator('.merge-conflict-dialog .conflict-row')).toHaveCount(0)
    await expect(page.locator('.merge-conflict-dialog')).toContainText('note.md')

    await page.getByRole('button', { name: 'Keep Editing' }).click()
    await expect(page.locator('.merge-conflict-dialog')).toBeHidden()
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    expect(await getMarkdownContent(page)).toBe(MERGED_DOC)
    await app.close()
  })

  test('source mode: a disjoint agent edit auto-merges into the dirty CodeMirror buffer', async() => {
    const { app, page, filePath } = await launchWithMarkdown(AGENT_BASE)
    await waitForMenuReady(app)
    await enterSourceMode(page, app)

    // Edit only line 0 so the agent's paragraph-3 rewrite stays disjoint.
    await page.evaluate(() => {
      const cm = document.querySelector('.source-code .CodeMirror') as SourceCodeMirrorElement | null
      const editor = cm?.CodeMirror
      if (!editor) throw new Error('CodeMirror is not available')
      editor.replaceRange('alpha start (edited)', { line: 0, ch: 0 }, { line: 0, ch: editor.getLine(0).length })
    })
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    await reportExternalChange(app, filePath, AGENT_DOC)

    await expect(page.locator('.editor-notifications')).toContainText(
      'Merged disk changes into your unsaved edits',
      { timeout: 12000 }
    )
    await expect(page.locator('.merge-conflict-dialog')).toBeHidden()
    await expect.poll(() => sourceValue(page), { timeout: 8000 }).toBe(MERGED_DOC)
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })
})

test.describe('External disk reload — confirmed dirty reloads remain recoverable', () => {
  test('confirmed WYSIWYG reload can be undone back to the local buffer', async() => {
    const { app, page, filePath } = await launchWithMarkdown('old content here\n')
    await waitForMenuReady(app)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'selectAll')
    await page.keyboard.type('local dirty content\n', { delay: 0 })
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    await reportExternalChange(app, filePath, 'agent content here\n')
    await expectMergeConflictPrompt(page)
    await reloadDiskFromMergeConflict(page)
    await page.waitForTimeout(600)

    expect(await getMarkdownContent(page)).toBe('agent content here\n')
    await expect(page.locator('.editor-notifications')).toContainText('kept')
    await expect(page.locator('.editor-tabs li')).toHaveCount(2)
    const recoveryTab = page.locator('.editor-tabs li.unsaved:not(.active)').first()
    await expect(recoveryTab.locator('span').first()).toHaveText(/Untitled-/)
    await recoveryTab.click()
    await expect.poll(() => getMarkdownContent(page), { timeout: 5000 }).toBe(
      'local dirty content\n'
    )
    await page.locator('.editor-tabs li:not(.unsaved)').first().click()
    await expect.poll(() => getMarkdownContent(page), { timeout: 5000 }).toBe(
      'agent content here\n'
    )
    await undo(app)
    await page.waitForTimeout(600)
    expect(await getMarkdownContent(page)).toBe('local dirty content\n')
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })

  test('confirmed source reload can be undone back to the local buffer', async() => {
    const { app, page, filePath } = await launchWithMarkdown('old content here\n')
    await waitForMenuReady(app)
    await enterSourceMode(page, app)

    await replaceSourceValue(page, 'local source dirty content\n')
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    await reportExternalChange(app, filePath, 'agent source content here\n')
    await expectMergeConflictPrompt(page)
    await reloadDiskFromMergeConflict(page)
    await page.waitForTimeout(600)

    expect(await sourceValue(page)).toBe('agent source content here\n')
    const recoveryTab = page.locator('.editor-tabs li.unsaved:not(.active)').first()
    await expect(recoveryTab.locator('span').first()).toHaveText(/Untitled-/)
    await recoveryTab.click()
    await expect.poll(() => sourceValue(page), { timeout: 5000 }).toBe('local source dirty content\n')
    await page.locator('.editor-tabs li:not(.unsaved)').first().click()
    await expect.poll(() => sourceValue(page), { timeout: 5000 }).toBe('agent source content here\n')
    await undo(app)
    await page.waitForTimeout(600)
    expect(await sourceValue(page)).toBe('local source dirty content\n')
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })
})

test.describe('External disk reload — source-mode scroll position survives a same-tab reload', () => {
  test('clean source-mode auto-reload can be undone back to the previous buffer', async() => {
    const { app, page, filePath } = await launchWithMarkdown('old source content\n')
    await waitForMenuReady(app)
    await enterSourceMode(page, app)

    await reportExternalChange(app, filePath, 'new source content\n')
    await expect.poll(() => sourceValue(page), { timeout: 5000 }).toBe('new source content\n')
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)

    await undo(app)
    await expect.poll(() => sourceValue(page), { timeout: 5000 }).toBe('old source content\n')
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })

  // Item 258: a same-id `mt::update-file` reload must not yank the CodeMirror
  // view back to the top. sourceCode.vue handleFileChange snapshots every
  // plausible scroll element on `isSameTabReload`, runs `editor.setValue`, then
  // re-applies the captured scrollTop synchronously, on nextTick, and on the
  // next animation frame (because the muya editor.vue file-changed handler
  // relayouts in the same tick). With `muyaIndexCursor: null` on a freshly
  // loaded tab the restore branch — not setSelection — is the one that runs.
  test('258: same-id reload preserves the source-mode scrollTop', async() => {
    // A long body so the CodeMirror content overflows and is actually
    // scrollable. The exact scroll element depends on CodeMirror's height:auto
    // + the outer .source-code overflow:auto interplay, so we discover whichever
    // element holds the scroll rather than assuming.
    const longBody = 'line\n'.repeat(400)
    const { app, page, filePath } = await launchWithMarkdown(longBody)
    await waitForMenuReady(app)

    await enterSourceMode(page, app)

    // Scroll well down the document. Drive both CodeMirror's own API and the
    // outer .source-code container so the scroll lands on whichever element is
    // the real overflow owner.
    const captured = await page.evaluate(() => {
      const container = document.querySelector('.source-code') as HTMLElement | null
      const cmEl = document.querySelector('.source-code .CodeMirror') as
        | (Element & {
          CodeMirror?: {
            scrollTo(x: number, y: number): void
            getScrollerElement(): HTMLElement
          }
        })
        | null
      const cm = cmEl?.CodeMirror
      if (cm) cm.scrollTo(0, 4000)
      if (container) container.scrollTop = 4000
      const scroller = cm?.getScrollerElement?.() ?? null
      return {
        container: container ? container.scrollTop : 0,
        scroller: scroller ? scroller.scrollTop : 0
      }
    })

    // At least one of the candidate elements must have actually scrolled,
    // otherwise the assertion below would be vacuous.
    const maxCaptured = Math.max(captured.container, captured.scroller)
    expect(maxCaptured).toBeGreaterThan(0)

    // Fire a same-tab external reload with slightly different long content. The
    // body must still match what we hand `loadChange` so the tab stays clean and
    // the reload applies silently.
    const reloadedBody = longBody + 'tail line\n'
    await reportExternalChange(app, filePath, reloadedBody)
    await page.waitForTimeout(600)

    // The reload landed (content updated) and CodeMirror is still mounted.
    expect((await getMarkdownContent(page)).trim().endsWith('tail line')).toBe(true)
    await enterSourceMode(page, app)

    // The scroll position is restored — not reset to the top. The exact pixel
    // value can drift slightly because the new (longer) content changes layout
    // height, so use a generous tolerance but require it to stay well away from
    // 0. We compare against whichever element actually owned the scroll.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const container = document.querySelector('.source-code') as HTMLElement | null
            const cmEl = document.querySelector('.source-code .CodeMirror') as
              | (Element & { CodeMirror?: { getScrollerElement(): HTMLElement } })
              | null
            const scroller = cmEl?.CodeMirror?.getScrollerElement?.() ?? null
            return Math.max(container ? container.scrollTop : 0, scroller ? scroller.scrollTop : 0)
          }),
        { timeout: 4000 }
      )
      .toBeGreaterThan(maxCaptured * 0.5)
    await app.close()
  })

  test('same-id reload preserves the source-mode cursor when no source cursor payload is supplied', async() => {
    const lines = Array.from({ length: 180 }, (_, index) => `paragraph ${index}`).join('\n\n') + '\n'
    const { app, page, filePath } = await launchWithMarkdown(lines)
    await waitForMenuReady(app)
    await enterSourceMode(page, app)

    await page.evaluate(() => {
      const cmEl = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { setCursor(pos: { line: number; ch: number }): void } })
        | null
      if (!cmEl?.CodeMirror) throw new Error('CodeMirror is not available')
      cmEl.CodeMirror.setCursor({ line: 120, ch: 4 })
    })
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const cmEl = document.querySelector('.source-code .CodeMirror') as
              | (Element & { CodeMirror?: { getCursor(): { line: number; ch: number } } })
              | null
            const cursor = cmEl?.CodeMirror?.getCursor() ?? null
            return cursor ? { line: cursor.line, ch: cursor.ch } : null
          }),
        { timeout: 4000 }
      )
      .toEqual({ line: 120, ch: 4 })

    const cleanSourceBaseline = await sourceValue(page)
    await reportExternalChange(app, filePath, cleanSourceBaseline)
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)

    await reportExternalChange(app, filePath, `${cleanSourceBaseline}tail line\n`)
    await expect.poll(() => sourceValue(page), { timeout: 5000 }).toContain('tail line')

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const cmEl = document.querySelector('.source-code .CodeMirror') as
              | (Element & { CodeMirror?: { getCursor(): { line: number; ch: number } } })
              | null
            const cursor = cmEl?.CodeMirror?.getCursor() ?? null
            return cursor ? { line: cursor.line, ch: cursor.ch } : null
          }),
        { timeout: 4000 }
      )
      .toEqual({ line: 120, ch: 4 })
    await app.close()
  })
})

test.describe('External disk reload — real watcher source-mode sync', () => {
  test('clean WYSIWYG file watcher reload updates comments and undo boundary', async() => {
    const before = 'plain content before agent edit\n'
    const after = [
      'Agent wrote <!--MC:realwysiwyg-->reviewed<!--MC:~realwysiwyg--> WYSIWYG content.',
      '',
      '[MC:realwysiwyg]: {"version":2,"status":"open","authors":["Agent"]}',
      '[MC:realwysiwyg.0]: {"author":"Agent","createdAt":"2026-06-30T12:00:00.000Z","body":"Real watcher WYSIWYG update."}',
      ''
    ].join('\n')
    const { app, page, filePath } = await launchWithMarkdown(before)
    await waitForMenuReady(app)
    await openCommentsSidebar(page, app)

    fs.writeFileSync(filePath, after, 'utf-8')

    await expect.poll(() => getMarkdownContent(page), { timeout: 12000 }).toBe(after)
    await expect(page.locator('.mu-comment-highlight')).toHaveText('reviewed')
    await expect(page.locator('.side-bar-comments .thread')).toHaveCount(1)
    await expect(page.locator('.side-bar-comments .reply p')).toHaveText(
      'Real watcher WYSIWYG update.'
    )
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)

    await undo(app)

    await expect.poll(() => getMarkdownContent(page), { timeout: 5000 }).toBe(before)
    await expect(page.locator('.mu-comment-highlight')).toHaveCount(0)
    await expect(page.locator('.side-bar-comments .thread')).toHaveCount(0)
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })

  test('clean source-mode file watcher reload updates comments and undo boundary', async() => {
    const before = 'plain source content before agent edit\n'
    const after = [
      'Agent wrote <!--MC:realwatch-->reviewed<!--MC:~realwatch--> source content.',
      '',
      'Broken <!--MC:bad.id--> source marker.',
      '',
      '[MC:realwatch]: {"version":2,"status":"open","authors":["Agent"]}',
      '[MC:realwatch.0]: {"author":"Agent","createdAt":"2026-06-30T12:00:00.000Z","body":"Real watcher source-mode update."}',
      ''
    ].join('\n')
    const { app, page, filePath } = await launchWithMarkdown(before)
    await waitForMenuReady(app)
    await enterSourceMode(page, app)
    await openCommentsSidebar(page, app)
    await expect.poll(() => sourceValue(page), { timeout: 5000 }).toBe(before)

    fs.writeFileSync(filePath, after, 'utf-8')

    await expect.poll(() => sourceValue(page), { timeout: 12000 }).toBe(after)
    await expect(page.locator('.side-bar-comments .thread')).toHaveCount(1)
    await expect(page.locator('.side-bar-comments .reply p')).toHaveText(
      'Real watcher source-mode update.'
    )
    await expect(page.locator('.side-bar-comments .diagnostic-code')).toContainText([
      'malformed-marker'
    ])
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(false)

    await undo(app)

    await expect.poll(() => sourceValue(page), { timeout: 5000 }).toBe(before)
    await expect(page.locator('.side-bar-comments .thread')).toHaveCount(0)
    await expect(page.locator('.side-bar-comments .diagnostic')).toHaveCount(0)
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })

  test('dirty WYSIWYG file watcher change prompts without overwriting local content', async() => {
    const { app, page, filePath } = await launchWithMarkdown('old content here\n')
    await waitForMenuReady(app)

    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'selectAll')
    await page.keyboard.type('local dirty content\n', { delay: 0 })
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    fs.writeFileSync(filePath, 'agent watcher content\n', 'utf-8')

    await expectMergeConflictPrompt(page)
    expect(await getMarkdownContent(page)).toBe('local dirty content\n')
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })

  test('dirty source-mode file watcher change prompts without overwriting CodeMirror content', async() => {
    const { app, page, filePath } = await launchWithMarkdown('old source content here\n')
    await waitForMenuReady(app)
    await enterSourceMode(page, app)

    await replaceSourceValue(page, 'local source dirty content\n')
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)

    fs.writeFileSync(filePath, 'agent source watcher content\n', 'utf-8')

    await expectMergeConflictPrompt(page)
    expect(await sourceValue(page)).toBe('local source dirty content\n')
    await expect.poll(() => isDirty(page), { timeout: 5000 }).toBe(true)
    await app.close()
  })
})

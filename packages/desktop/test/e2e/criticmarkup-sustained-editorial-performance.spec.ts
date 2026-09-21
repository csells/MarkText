import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown as launchWithMarkdown,
  sendIpcToRenderer,
  waitForMenuReady
} from './helpers'
import { preserveSystemClipboard } from './helpers/systemClipboardFixture'

test('sustains deletion, native paste, navigation and Review resolution without source drift', async() => {
  test.skip(
    process.env.MARKTEXT_WARM_EDITORIAL !== '1',
    'Opt in to the sustained editorial workload.'
  )
  test.skip(process.platform !== 'darwin', 'Clipboard preservation fixture requires macOS.')
  test.setTimeout(180_000)
  const cycles = Number(process.env.MARKTEXT_EDITORIAL_CYCLES ?? 40)
  const source =
    'Editing sentence.\n\n' +
    Array.from(
      { length: 80 },
      (_, index) =>
        `## Section ${index}\n\nReview {++new evidence++} and {--old wording--}.\n\n- Item\n- Another\n\n\`\`\`js\nconst x = 42\n\`\`\`\n\n`
    ).join('')
  const scratch = mkdtempSync(path.join(tmpdir(), 'marktext-sustained-editorial-'))
  const clipboardFixture = preserveSystemClipboard()
  const timings: Array<{ cycle: number; editingMs: number; navigationReviewMs: number }> = []
  let activeCycle = -1
  let activeStage = 'opening'
  let resultWritten = false
  const { app, page, filePath } = await launchWithMarkdown(source, {
    suppressErrorDialog: true,
    env: {
      MARKTEXT_DOCUMENT_CORE_MODE: undefined,
      MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
    }
  })
  try {
    await waitForMenuReady(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    const pasted = ' paste λ'
    await app.evaluate(({ clipboard }, text) => {
      clipboard.writeText(text)
    }, pasted)
    clipboardFixture.rememberOwnedWrite(pasted)
    const paragraph = page.locator('.mu-paragraph-content').first()
    await expect(paragraph).toHaveAttribute('contenteditable', 'true')
    const heap = await page.context().newCDPSession(page)
    await heap.send('HeapProfiler.collectGarbage')
    const before = await heap.send('Runtime.getHeapUsage')
    console.log(`[editorial] ${cycles} cycles; source ${source.length} units; output ${scratch}`)
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      activeCycle = cycle
      activeStage = 'editing'
      await paragraph.click()
      await page.keyboard.press('End')
      const start = performance.now()
      await page.keyboard.type('x')
      await page.waitForTimeout(20)
      await page.keyboard.press('Backspace')
      await page.waitForTimeout(20)
      activeStage = 'paste-dispatch'
      await app.evaluate(({ BrowserWindow, clipboard }, expected) => {
        if (clipboard.readText() !== expected) {
          throw new Error('System clipboard changed; native paste stopped.')
        }
        BrowserWindow.getAllWindows()[0].webContents.paste()
      }, pasted)
      activeStage = 'paste-observation'
      await expect(paragraph).toHaveText('Editing sentence.' + pasted)
      activeStage = 'deleting-paste'
      for (let index = 0; index < pasted.length; index += 1) {
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(20)
      }
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await expect(paragraph).toHaveText('Editing sentence.')
      const editingMs = performance.now() - start
      const navigationStart = performance.now()
      activeStage = 'review-navigation'
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowRight')
      // The passive sidebar refresh can still be pending after Core settles.
      // Observe readiness at the input cadence so click retry backoff does not
      // dominate the sustained session's wall time; retain the real UI click.
      await expect
        .poll(() => page.getByTestId('critic-review-next').isEnabled(), { intervals: [20] })
        .toBe(true)
      await page.getByTestId('critic-review-next').click()
      await page.getByTestId('critic-review-previous').click()
      const suggestions = page.locator('.editor-component [data-critic-kind]')
      const suggestionCount = await suggestions.count()
      expect(suggestionCount).toBeGreaterThan(0)
      activeStage = 'review-accept'
      await page.getByTestId('critic-review-accept').click()
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await expect(suggestions).toHaveCount(suggestionCount - 1)
      activeStage = 'review-undo'
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await page.evaluate(() => window.__marktextDocumentCore?.settled())
      await expect(suggestions).toHaveCount(suggestionCount)
      timings.push({ cycle, editingMs, navigationReviewMs: performance.now() - navigationStart })
      if ((cycle + 1) % 10 === 0) {
        activeStage = 'save-checkpoint'
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
        console.log(`[editorial] ${cycle + 1}/${cycles} cycles; exact source preserved`)
      }
    }
    activeStage = 'final-verification'
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
    await heap.send('HeapProfiler.collectGarbage')
    const after = await heap.send('Runtime.getHeapUsage')
    await heap.detach()
    const authority = await page.evaluate(() => ({
      events: window.__marktextDocumentCore?.performanceEvents?.(),
      status: window.__marktextDocumentCore?.performanceStatus?.()
    }))
    const result = {
      cycles,
      timings,
      retainedHeap: { before, after },
      authority,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      mainBuildSha256: createHash('sha256')
        .update(readFileSync(path.join(__dirname, '../../out/main/index.js')))
        .digest('hex'),
      note: 'Review includes navigation, accept and undo. Cycle wall times include automation, assertions, 20 ms pacing and authority barriers; they are not per-input latency or physical paint. Heap includes retained undo history.'
    }
    writeFileSync(path.join(scratch, 'result.json'), JSON.stringify(result, null, 2), {
      flag: 'wx'
    })
    resultWritten = true
    console.log(
      `[editorial] complete; retained heap ${before.usedSize} -> ${after.usedSize}; ${scratch}`
    )
    expect(
      await page.evaluate(() => window.electron.ipcRenderer.invoke('mt::core-draft::list'))
    ).toEqual([])
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    try {
      if (!resultWritten) {
        writeFileSync(
          path.join(scratch, 'partial-result.json'),
          JSON.stringify(
            {
              completedCycles: timings.length,
              interruptedCycle: activeCycle + 1,
              stage: activeStage,
              timings,
              expectedCommit: process.env.MARKTEXT_EXPECTED_COMMIT,
              note: 'Incomplete run; completed cycle timings include automation, assertions and pacing. This artifact does not establish a passed workload.'
            },
            null,
            2
          ),
          { flag: 'wx' }
        )
      }
    } finally {
      try {
        await app.close()
      } finally {
        clipboardFixture.restore()
      }
    }
  }
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  getMarkdownContent,
  sendIpcToRenderer,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import { expectInstalledArtifactCommit } from './installedArtifactProvenance'
import {
  readInputLatencyTrace,
  startInputLatencyTrace,
  waitForInputLatencyTrace
} from './helpers/inputLatencyTrace'

type InteractionMatrixRow = Readonly<{
  id: string
  source: string
  action:
    | Readonly<{ kind: 'render' }>
    | Readonly<{
      kind: 'resolve'
      decision: 'accept' | 'reject'
      outcome: 'applied' | 'no-target'
    }>
    | Readonly<{
      kind: 'author'
      selection: string
      replacement?: string
      outcome: 'applied' | 'unavailable'
    }>
    | Readonly<{ kind: 'source-round-trip' }>
    | Readonly<{ kind: 'save-reopen' }>
  expectedSource: string
}>

const interactionMatrix = JSON.parse(fs.readFileSync(path.resolve(
  __dirname,
  '../../../../specs/baselines/criticmarkup-interaction-matrix.json'
), 'utf8')) as Readonly<{ rows: readonly InteractionMatrixRow[] }>

const installedResolveCases = [
  {
    id: 'addition.literal.resolve',
    initialKind: null,
    actionTestId: null,
    remainingKind: null
  },
  {
    id: 'comment.reference-footnote.resolve',
    initialKind: 'comment',
    actionTestId: 'critic-review-remove',
    remainingKind: null
  },
  {
    id: 'deletion.block-boundary.resolve',
    initialKind: 'deletion',
    actionTestId: 'critic-review-accept',
    remainingKind: null
  },
  {
    id: 'highlight.nested-comment.resolve',
    initialKind: 'highlight',
    actionTestId: 'critic-review-remove',
    remainingKind: 'comment'
  },
  {
    id: 'substitution.paragraph.resolve',
    initialKind: 'substitution',
    actionTestId: 'critic-review-accept',
    remainingKind: null
  }
] as const

const installedResolveRows = installedResolveCases.map(testCase => {
  const id = testCase.id
  const row = interactionMatrix.rows.find(candidate => candidate.id === id)
  if (row === undefined) throw new Error(`Installed interaction row is absent: ${id}`)
  if (row.action.kind !== 'resolve') {
    throw new Error(`Installed interaction row is not a resolve action: ${id}`)
  }
  return { row, testCase }
})

const installedSaveReopenCases = [
  { id: 'addition.nested-comment.save-reopen', reviewKind: 'addition' },
  { id: 'comment.literal.save-reopen', reviewKind: null },
  { id: 'deletion.paragraph.save-reopen', reviewKind: 'deletion' },
  { id: 'highlight.block-boundary.save-reopen', reviewKind: 'highlight' },
  { id: 'substitution.reference-footnote.save-reopen', reviewKind: 'substitution' }
] as const

const installedSaveReopenRows = installedSaveReopenCases.map(testCase => {
  const id = testCase.id
  const row = interactionMatrix.rows.find(candidate => candidate.id === id)
  if (row === undefined) throw new Error(`Installed interaction row is absent: ${id}`)
  if (row.action.kind !== 'save-reopen') {
    throw new Error(`Installed interaction row is not a save-reopen action: ${id}`)
  }
  return { row, testCase }
})

const installedSourceRoundTripCases = [
  { id: 'addition.reference-footnote.source-round-trip', reviewKind: 'addition' },
  { id: 'comment.block-boundary.source-round-trip', reviewKind: 'comment' },
  { id: 'deletion.literal.source-round-trip', reviewKind: null },
  { id: 'highlight.paragraph.source-round-trip', reviewKind: 'highlight' },
  { id: 'substitution.nested-comment.source-round-trip', reviewKind: 'substitution' }
] as const

const installedSourceRoundTripRows = installedSourceRoundTripCases.map(testCase => {
  const id = testCase.id
  const row = interactionMatrix.rows.find(candidate => candidate.id === id)
  if (row === undefined) throw new Error(`Installed interaction row is absent: ${id}`)
  if (row.action.kind !== 'source-round-trip') {
    throw new Error(`Installed interaction row is not a source-round-trip action: ${id}`)
  }
  return { row, testCase }
})

const installedRenderCases = [
  {
    id: 'addition.paragraph.render',
    initialKind: 'addition',
    revisedText: 'Alpha new words omega.',
    rejectedSource: 'Alpha  omega.'
  },
  {
    id: 'comment.nested-comment.render',
    initialKind: 'comment',
    revisedText: '',
    commentTexts: ['inner note', 'Outer note with {>>inner note<<}.']
  },
  {
    id: 'deletion.reference-footnote.render',
    initialKind: 'deletion',
    revisedText: 'See ',
    rejectedSource: 'See [old][ref].[^n]\n\n[ref]: https://example.com\n[^n]: Note.'
  },
  {
    id: 'highlight.literal.render',
    initialKind: null,
    revisedText: '{==literal==}'
  },
  {
    id: 'substitution.block-boundary.render',
    initialKind: 'substitution',
    revisedText: 'New block.',
    rejectedSource: 'Before.\n\nOld block.\n\nAfter.'
  }
] as const

const installedRenderRows = installedRenderCases.map(testCase => {
  const id = testCase.id
  const row = interactionMatrix.rows.find(candidate => candidate.id === id)
  if (row === undefined) throw new Error(`Installed interaction row is absent: ${id}`)
  if (row.action.kind !== 'render') {
    throw new Error(`Installed interaction row is not a render action: ${id}`)
  }
  return { row, testCase }
})

const installedAuthorCases = [{
  id: 'addition.block-boundary.author',
  mode: 'selection-control',
  renderedSelection: 'Added block.',
  actionTestId: 'critic-review-mark-addition',
  promptText: null,
  reviewKind: 'addition'
}, {
  id: 'comment.paragraph.author',
  mode: 'selection-control',
  renderedSelection: 'review this claim',
  actionTestId: 'critic-review-add-comment',
  promptText: 'note',
  reviewKind: 'commented-span'
}, {
  id: 'deletion.nested-comment.author',
  mode: 'edit-comment',
  promptText: 'A local {--deletion--} in a comment.',
  reviewKind: 'deletion'
}, {
  id: 'highlight.reference-footnote.author',
  mode: 'selection-control',
  renderedSelection: 'important',
  actionTestId: 'critic-review-mark-highlight',
  promptText: null,
  reviewKind: 'highlight'
}, {
  id: 'substitution.literal.author',
  mode: 'selection-control',
  renderedSelection: 'old',
  actionTestId: 'critic-review-track-replacement',
  promptText: 'new',
  reviewKind: null
}] as const

const installedAuthorRows = installedAuthorCases.map(testCase => {
  const id = testCase.id
  const row = interactionMatrix.rows.find(candidate => candidate.id === id)
  if (row === undefined) throw new Error(`Installed interaction row is absent: ${id}`)
  if (row.action.kind !== 'author') {
    throw new Error(`Installed interaction row is not an author action: ${id}`)
  }
  return { row, testCase, actionOutcome: row.action.outcome }
})

const installedBinary = (): string => {
  const configured = process.env.MARKTEXT_PACKAGED_APP
  if (configured === undefined || configured.trim().length === 0) {
    throw new Error('MARKTEXT_PACKAGED_APP must name the installed MarkText executable')
  }
  const absolute = path.resolve(configured)
  if (!fs.existsSync(absolute)) {
    throw new Error(`Installed MarkText executable does not exist: ${absolute}`)
  }
  return absolute
}

const launchInstalled = async(
  binary: string,
  userDataDir: string,
  filePath: string
): Promise<{ app: ElectronApplication, page: Page }> => {
  const app = await electron.launch({
    executablePath: binary,
    args: ['--user-data-dir', userDataDir, filePath],
    env: {
      ...process.env,
      PERF_TESTING: 'true',
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      MARKTEXT_ERROR_INTERACTION: '1'
    },
    timeout: 60_000
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await waitForEditor(page, 60_000)
  await waitForMenuReady(app, 60_000)
  await expectInstalledArtifactCommit(page)
  return { app, page }
}

const selectRenderedText = async(page: Page, text: string): Promise<void> => {
  const selected = await page.evaluate(value => {
    const root = document.querySelector('.editor-component') as HTMLElement | null
    if (root === null) return undefined
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const start = node.textContent?.indexOf(value) ?? -1
      if (start >= 0) {
        root.focus()
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, start + value.length)
        const selection = window.getSelection()
        if (selection === null) return undefined
        selection.removeAllRanges()
        selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        root.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true
        }))
        return selection.toString()
      }
      node = walker.nextNode()
    }
    return undefined
  }, text)
  expect(selected).toBe(text)
  await page.waitForTimeout(150)
}

test.describe('installed Core Review authority', () => {
  test.describe.configure({ timeout: 180_000 })

  for (const { row, testCase } of installedResolveRows) {
    test(`${row.id} follows the installed interaction matrix`, async() => {
      const binary = installedBinary()
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-matrix-'))
      const filePath = path.join(root, 'interaction.md')
      const userDataDir = path.join(root, 'profile')
      fs.writeFileSync(filePath, row.source, 'utf8')
      let launched: { app: ElectronApplication, page: Page } | undefined
      try {
        launched = await launchInstalled(binary, userDataDir, filePath)
        const { app, page } = launched
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
        expect(await page.evaluate(() =>
          window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
        )).toBeUndefined()

        const kind = page.getByTestId('critic-review-kind')
        if (testCase.initialKind === null) {
          await expect(kind).toHaveCount(0)
          await expect(page.getByTestId('critic-review-accept')).toHaveCount(0)
          await expect(page.getByTestId('critic-review-remove')).toHaveCount(0)
          await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
          await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(row.source)
        } else {
          await expect(kind).toHaveText(testCase.initialKind)
          if (testCase.actionTestId === null) {
            throw new Error(`${row.id} requires one visible resolution action`)
          }
          await page.getByTestId(testCase.actionTestId).click()
          await page.evaluate(() => window.__marktextDocumentCore?.settled())
          await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
          await expect.poll(() => fs.readFileSync(filePath, 'utf8'))
            .toBe(row.expectedSource)

          await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
          await page.evaluate(() => window.__marktextDocumentCore?.settled())
          await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
          await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(row.source)

          await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
          await page.evaluate(() => window.__marktextDocumentCore?.settled())
          await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
          await expect.poll(() => fs.readFileSync(filePath, 'utf8'))
            .toBe(row.expectedSource)
        }
        await app.close()
        launched = undefined

        launched = await launchInstalled(binary, userDataDir, filePath)
        await expectEditorWindowHidden(launched.app)
        expectEditorNotFrontmost(launched.app)
        expect(fs.readFileSync(filePath, 'utf8')).toBe(row.expectedSource)
        if (testCase.remainingKind === null) {
          await expect(launched.page.getByTestId('critic-review-kind')).toHaveCount(0)
        } else {
          await expect(launched.page.getByTestId('critic-review-kind'))
            .toHaveText(testCase.remainingKind)
        }
      } finally {
        if (launched !== undefined) await launched.app.close()
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  }

  for (const { row, testCase } of installedSaveReopenRows) {
    test(`${row.id} follows the installed interaction matrix`, async() => {
      const binary = installedBinary()
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-matrix-'))
      const filePath = path.join(root, 'interaction.md')
      const userDataDir = path.join(root, 'profile')
      fs.writeFileSync(filePath, row.source, 'utf8')
      let launched: { app: ElectronApplication, page: Page } | undefined
      const expectReviewKind = async(page: Page): Promise<void> => {
        const kind = page.getByTestId('critic-review-kind')
        if (testCase.reviewKind === null) await expect(kind).toHaveCount(0)
        else await expect(kind).toHaveText(testCase.reviewKind)
      }
      try {
        launched = await launchInstalled(binary, userDataDir, filePath)
        await expectEditorWindowHidden(launched.app)
        expectEditorNotFrontmost(launched.app)
        expect(await launched.page.evaluate(() =>
          window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
        )).toBeUndefined()
        await expectReviewKind(launched.page)
        await sendIpcToRenderer(launched.app, 'mt::editor-ask-file-save')
        await expect.poll(() => fs.readFileSync(filePath, 'utf8'))
          .toBe(row.expectedSource)
        await launched.app.close()
        launched = undefined

        launched = await launchInstalled(binary, userDataDir, filePath)
        await expectEditorWindowHidden(launched.app)
        expectEditorNotFrontmost(launched.app)
        await expectReviewKind(launched.page)
        expect(fs.readFileSync(filePath, 'utf8')).toBe(row.expectedSource)
      } finally {
        if (launched !== undefined) await launched.app.close()
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  }

  for (const { row, testCase } of installedSourceRoundTripRows) {
    test(`${row.id} follows the installed interaction matrix`, async() => {
      const binary = installedBinary()
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-matrix-'))
      const filePath = path.join(root, 'interaction.md')
      const userDataDir = path.join(root, 'profile')
      fs.writeFileSync(filePath, row.source, 'utf8')
      let launched: { app: ElectronApplication, page: Page } | undefined
      const expectReviewKind = async(page: Page): Promise<void> => {
        const kind = page.getByTestId('critic-review-kind')
        if (testCase.reviewKind === null) await expect(kind).toHaveCount(0)
        else await expect(kind).toHaveText(testCase.reviewKind)
      }
      try {
        launched = await launchInstalled(binary, userDataDir, filePath)
        await expectEditorWindowHidden(launched.app)
        expectEditorNotFrontmost(launched.app)
        expect(await launched.page.evaluate(() =>
          window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
        )).toBeUndefined()
        await expectReviewKind(launched.page)
        expect(await getMarkdownContent(launched.page, launched.app)).toBe(row.source)
        await expectReviewKind(launched.page)
        await sendIpcToRenderer(launched.app, 'mt::editor-ask-file-save')
        await expect.poll(() => fs.readFileSync(filePath, 'utf8'))
          .toBe(row.expectedSource)
        await launched.app.close()
        launched = undefined

        launched = await launchInstalled(binary, userDataDir, filePath)
        await expectEditorWindowHidden(launched.app)
        expectEditorNotFrontmost(launched.app)
        expect(await getMarkdownContent(launched.page, launched.app))
          .toBe(row.expectedSource)
        await expectReviewKind(launched.page)
        expect(fs.readFileSync(filePath, 'utf8')).toBe(row.expectedSource)
      } finally {
        if (launched !== undefined) await launched.app.close()
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  }

  for (const { row, testCase } of installedRenderRows) {
    test(`${row.id} follows the installed interaction matrix`, async() => {
      const binary = installedBinary()
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-matrix-'))
      const filePath = path.join(root, 'interaction.md')
      const userDataDir = path.join(root, 'profile')
      fs.writeFileSync(filePath, row.source, 'utf8')
      let launched: { app: ElectronApplication, page: Page } | undefined
      try {
        launched = await launchInstalled(binary, userDataDir, filePath)
        const { app, page } = launched
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
        expect(await page.evaluate(() =>
          window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
        )).toBeUndefined()
        const kind = page.getByTestId('critic-review-kind')
        if (testCase.initialKind === null) await expect(kind).toHaveCount(0)
        else await expect(kind).toHaveText(testCase.initialKind)
        if (testCase.revisedText.length > 0) {
          await expect(page.locator('.editor-component'))
            .toContainText(testCase.revisedText)
        }

        if ('commentTexts' in testCase) {
          const commentText = page.getByTestId('critic-review-comment-text')
          await expect(commentText).toHaveText(testCase.commentTexts[0])
          await page.getByTestId('critic-review-next').click()
          await expect(commentText).toHaveText(testCase.commentTexts[1])
        }
        if ('rejectedSource' in testCase) {
          await page.getByTestId('critic-review-reject').click()
          await page.evaluate(() => window.__marktextDocumentCore?.settled())
          await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
          await expect.poll(() => fs.readFileSync(filePath, 'utf8'))
            .toBe(testCase.rejectedSource)
          await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
          await page.evaluate(() => window.__marktextDocumentCore?.settled())
        }

        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => fs.readFileSync(filePath, 'utf8'))
          .toBe(row.expectedSource)
        await app.close()
        launched = undefined

        launched = await launchInstalled(binary, userDataDir, filePath)
        await expectEditorWindowHidden(launched.app)
        expectEditorNotFrontmost(launched.app)
        expect(fs.readFileSync(filePath, 'utf8')).toBe(row.expectedSource)
      } finally {
        if (launched !== undefined) await launched.app.close()
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  }

  for (const { row, testCase, actionOutcome } of installedAuthorRows) {
    test(`${row.id} follows the installed interaction matrix`, async() => {
      const binary = installedBinary()
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-matrix-'))
      const filePath = path.join(root, 'interaction.md')
      const userDataDir = path.join(root, 'profile')
      fs.writeFileSync(filePath, row.source, 'utf8')
      let launched: { app: ElectronApplication, page: Page } | undefined
      try {
        launched = await launchInstalled(binary, userDataDir, filePath)
        const { app, page } = launched
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
        expect(await page.evaluate(() =>
          window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
        )).toBeUndefined()

        if (testCase.mode === 'selection-control') {
          await selectRenderedText(page, testCase.renderedSelection)
        } else {
          await expect(page.getByTestId('critic-review-kind')).toHaveText('comment')
        }
        if (testCase.promptText !== null) {
          await page.evaluate(text => { window.prompt = () => text }, testCase.promptText)
        }
        const control = page.getByTestId(testCase.mode === 'selection-control'
          ? testCase.actionTestId
          : 'critic-review-edit-comment')
        await expect(control).toBeEnabled()
        await control.click()
        await expect.poll(() => page.evaluate(() =>
          (window.__marktextDocumentCore?.latest() as {
            result?: string
          })?.result
        )).toBe(testCase.mode === 'selection-control' ? 'author' : 'edit-comment')
        const authorResult = await page.evaluate(() =>
          window.__marktextDocumentCore?.latest()
        ) as { outcome?: { type?: string } }
        if (actionOutcome === 'applied') {
          expect(authorResult).toMatchObject({ outcome: { type: 'applied' } })
        } else {
          expect(authorResult.outcome).toBeUndefined()
        }
        await page.evaluate(() => window.__marktextDocumentCore?.settled())
        if (testCase.reviewKind === null) {
          await expect(page.getByTestId('critic-review-kind')).toHaveCount(0)
        } else {
          await expect(page.getByTestId('critic-review-kind'))
            .toHaveText(testCase.reviewKind)
        }
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => fs.readFileSync(filePath, 'utf8'))
          .toBe(row.expectedSource)

        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await page.evaluate(() => window.__marktextDocumentCore?.settled())
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(row.source)

        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
        await page.evaluate(() => window.__marktextDocumentCore?.settled())
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => fs.readFileSync(filePath, 'utf8'))
          .toBe(row.expectedSource)
        await app.close()
        launched = undefined

        launched = await launchInstalled(binary, userDataDir, filePath)
        await expectEditorWindowHidden(launched.app)
        expectEditorNotFrontmost(launched.app)
        expect(fs.readFileSync(filePath, 'utf8')).toBe(row.expectedSource)
        if (testCase.reviewKind === null) {
          await expect(launched.page.getByTestId('critic-review-kind')).toHaveCount(0)
        } else {
          await expect(launched.page.getByTestId('critic-review-kind'))
            .toHaveText(testCase.reviewKind)
        }
      } finally {
        if (launched !== undefined) await launched.app.close()
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  }

  test('tracks continuously, edits a Comment, saves, and reopens exact bytes', async() => {
    const binary = installedBinary()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-core-'))
    const filePath = path.join(root, 'review.md')
    const userDataDir = path.join(root, 'profile')
    const source = 'seed\n\nplain\n\n{==target==}{>>old note<<}\n'
    const saved = 'seed{++!++}\n\nplain{++?++}\n\n{==target==}{>>new note<<}\n'
    fs.writeFileSync(filePath, source, 'utf8')
    let launched: { app: ElectronApplication, page: Page } | undefined
    try {
      launched = await launchInstalled(binary, userDataDir, filePath)
      const { app, page } = launched
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
      expect(await page.evaluate(() =>
        window.electron.process.env.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS
      )).toBeUndefined()

      const track = page.getByTestId('critic-review-track-changes')
      await track.click()
      await expect(track).toHaveAttribute('aria-pressed', 'true')
      const paragraphs = page.locator('span.mu-paragraph-content')
      await startInputLatencyTrace(page, { maxSamples: 1 })
      await paragraphs.nth(0).click()
      await page.keyboard.press('End')
      await page.keyboard.type('!')
      await expect.poll(() => paragraphs.nth(0).textContent()).toBe('seed!')
      await waitForInputLatencyTrace(page, 1)
      const [inputSample] = await readInputLatencyTrace(page)
      await expect.poll(() => page.evaluate(() => {
        const events = window.__marktextDocumentCore?.performanceEvents?.() ?? []
        const dispatch = events.find(event => event.phase === 'dispatch')
        return dispatch !== undefined && events.some(event =>
          event.phase === 'ack' &&
          'transaction' in event && event.transaction === dispatch.transaction
        ) && events.some(event =>
          event.phase === 'reconcile' &&
          'transaction' in event && event.transaction === dispatch.transaction
        )
      })).toBe(true)
      const authorityEvents = await page.evaluate(() =>
        window.__marktextDocumentCore?.performanceEvents?.() ?? []
      )
      const dispatch = authorityEvents.find(event => event.phase === 'dispatch')
      const acknowledgement = authorityEvents.find(event =>
        event.phase === 'ack' && dispatch !== undefined &&
        event.transaction === dispatch.transaction
      )
      const reconciliation = authorityEvents.find(event =>
        event.phase === 'reconcile' && dispatch !== undefined &&
        event.transaction === dispatch.transaction
      )
      const openRequest = authorityEvents.find(event => event.phase === 'open-request')
      const openAcknowledgement = authorityEvents.find(event => event.phase === 'open-ack')
      const firstViewport = authorityEvents.find(
        event => event.phase === 'first-editable-viewport'
      )
      expect(inputSample?.tEvent).toBeLessThanOrEqual(dispatch?.at ?? -1)
      expect(dispatch?.at).toBeLessThanOrEqual(acknowledgement?.at ?? -1)
      expect(acknowledgement?.at).toBeLessThanOrEqual(reconciliation?.at ?? -1)
      expect(openRequest?.at).toBeLessThanOrEqual(openAcknowledgement?.at ?? -1)
      expect(openAcknowledgement?.at).toBeLessThanOrEqual(firstViewport?.at ?? -1)
      expect(reconciliation).toMatchObject({ corrected: true })
      await paragraphs.nth(1).click()
      await page.keyboard.press('End')
      await page.keyboard.type('?')
      await expect.poll(() => paragraphs.nth(1).textContent()).toBe('plain?')
      await expect(track).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => page.evaluate(() =>
        (window.__marktextDocumentCore?.performanceEvents?.() ?? [])
          .filter(event => event.phase === 'reconcile').length
      )).toBeGreaterThanOrEqual(2)
      await page.evaluate(() => window.__marktextDocumentCore?.settled())

      await expect(page.getByTestId('critic-review-kind')).toHaveText('addition')
      const previousReviewItem = page.getByTestId('critic-review-previous')
      for (let remaining = 3; remaining > 0; remaining -= 1) {
        if (await page.getByTestId('critic-review-kind').textContent() === 'commented-span') {
          break
        }
        await previousReviewItem.click()
        await expect(previousReviewItem).toBeDisabled()
        await expect(previousReviewItem).toBeEnabled()
      }
      await expect(page.getByTestId('critic-review-kind')).toHaveText('commented-span')
      await page.evaluate(() => { window.prompt = () => 'new note' })
      const editComment = page.getByTestId('critic-review-edit-comment')
      await expect(editComment).toBeEnabled()
      await editComment.click()

      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(saved)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toContain('old note')
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(saved)
      await app.close()
      launched = undefined

      launched = await launchInstalled(binary, userDataDir, filePath)
      await expect(launched.page.getByTestId('critic-review-kind')).toHaveText('addition')
      await expect(launched.page.locator('span.mu-paragraph-content').nth(0))
        .toHaveText('seed!')
      expect(fs.readFileSync(filePath, 'utf8')).toBe(saved)
    } finally {
      if (launched !== undefined) await launched.app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown
} from './helpers'
import {
  clickReviewMenu,
  clickText,
  expectSaved,
  hiddenCoreEnv as env,
  nativeKey
} from './reviewGestures'

// Review resolution across blocks and in bulk, undone and
// redone with the real ⌘Z and ⇧⌘Z keys. Accept/Reject follow Profile 1 §10
// (the Revised and Original columns); Accept All and Reject All resolve every
// suggestion, including nested and cross-block ones, and leave Highlights and
// Comments as Google Docs leaves comments. The saved file is the oracle.

const undo = (app: ElectronApplication) => nativeKey(app, 'Z', ['meta'])
const redo = (app: ElectronApplication) => nativeKey(app, 'Z', ['meta', 'shift'])

const expectHealthy = async(app: ElectronApplication, page: Page): Promise<void> => {
  await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
  await expectEditorWindowHidden(app)
  expectEditorNotFrontmost(app)
  await expectNoRendererErrors(app)
}

const crossBlockCases: ReadonlyArray<{
  name: string
  source: string
  /** Blocks that must each render part of the annotation. */
  blocks: string
  blockCount: number
  kind: 'addition' | 'deletion'
  /** Text rendered as the change in each block it spans. */
  changed: readonly string[]
  accepted: string
  rejected: string
}> = [
  {
    name: 'an Addition spanning two paragraphs',
    source: 'Alpha {++one\n\ntwo++} omega\n',
    blocks: '.mu-paragraph-content',
    blockCount: 2,
    kind: 'addition',
    changed: ['one', 'two'],
    accepted: 'Alpha one\n\ntwo omega\n',
    rejected: 'Alpha  omega\n'
  },
  {
    name: 'a Deletion spanning two paragraphs',
    source: 'Keep {--this\n\nthat--} end\n',
    blocks: '.mu-paragraph-content',
    blockCount: 2,
    kind: 'deletion',
    changed: ['this', 'that'],
    accepted: 'Keep  end\n',
    rejected: 'Keep this\n\nthat end\n'
  },
  {
    name: 'an Addition spanning list items',
    source: '- item{++\n- next++}\n',
    blocks: 'li .mu-paragraph-content',
    blockCount: 2,
    kind: 'addition',
    changed: ['next'],
    accepted: '- item\n- next\n',
    rejected: '- item\n'
  },
  {
    name: 'a Deletion enclosing a whole table',
    source: 'Intro\n\n{--| a | b |\n| --- | --- |\n| c | d |--}\n\nOutro\n',
    blocks: '.mu-table-cell-content',
    blockCount: 4,
    kind: 'deletion',
    changed: ['a', 'b', 'c', 'd'],
    accepted: 'Intro\n\n\n\nOutro\n',
    rejected: 'Intro\n\n| a | b |\n| --- | --- |\n| c | d |\n\nOutro\n'
  }
]

test.describe('Review resolution with real undo keys', () => {
  test.describe.configure({ timeout: 60_000 })

  for (const testCase of crossBlockCases) {
    test(`${testCase.name} renders, accepts and rejects, with ⌘Z and ⇧⌘Z`, async() => {
      const { app, page, filePath } = await launchWithReviewMarkdown(testCase.source, {
        suppressErrorDialog: true,
        env
      })
      try {
        const blocks = page.locator(`.editor-component ${testCase.blocks}`)
        await expect(blocks).toHaveCount(testCase.blockCount)
        // Every block inside the annotation shows its change.
        for (const text of testCase.changed) {
          await expect(
            page
              .locator(`.editor-component [data-critic-kind="${testCase.kind}"]`)
              .filter({ hasText: new RegExp(`^${text}$`) })
              .first()
          ).toBeVisible()
        }
        const entries = page.getByTestId('critic-review-entry')
        await expect(entries).toHaveCount(1)

        await entries.first().locator(':scope > button').click()
        await page.getByTestId('critic-review-accept').click()
        await expectSaved(app, filePath, testCase.accepted)
        await undo(app)
        await expectSaved(app, filePath, testCase.source)
        await redo(app)
        await expectSaved(app, filePath, testCase.accepted)
        await undo(app)
        await expectSaved(app, filePath, testCase.source)
        await expect(entries).toHaveCount(1)

        await entries.first().locator(':scope > button').click()
        await page.getByTestId('critic-review-reject').click()
        await expectSaved(app, filePath, testCase.rejected)
        await undo(app)
        await expectSaved(app, filePath, testCase.source)
        await expect(blocks).toHaveCount(testCase.blockCount)
        await expectHealthy(app, page)
      } finally {
        await app.close()
      }
    })
  }

  const bulkSource =
    'Intro {++add++} and {--del--} and {~~old~>new~~}.\n\n' +
    'See {==marked {++more++}==} and {==span==}{>>note<<} and {>>solo<<} end.\n\n' +
    'Nest {++foo{--bat--}bar++} and {--a{++b++}c--}.\n\n' +
    'Cross {++one\n\ntwo++} tail.\n'
  const bulkCases = [
    {
      decision: 'Accept All',
      testId: 'critic-review-accept-all',
      expected:
        'Intro add and  and new.\n\n' +
        'See {==marked more==} and {==span==}{>>note<<} and {>>solo<<} end.\n\n' +
        'Nest foobar and .\n\n' +
        'Cross one\n\ntwo tail.\n'
    },
    {
      decision: 'Reject All',
      testId: 'critic-review-reject-all',
      expected:
        'Intro  and del and old.\n\n' +
        'See {==marked ==} and {==span==}{>>note<<} and {>>solo<<} end.\n\n' +
        'Nest  and ac.\n\n' +
        'Cross  tail.\n'
    }
  ] as const

  for (const bulk of bulkCases) {
    test(`${bulk.decision} resolves every suggestion, keeps comments, and is one ⌘Z step`, async() => {
      const { app, page, filePath } = await launchWithReviewMarkdown(bulkSource, {
        suppressErrorDialog: true,
        env
      })
      try {
        await page.getByTestId('critic-review-entry').first().locator(':scope > button').click()
        await page.getByTestId(bulk.testId).click()
        await expectSaved(app, filePath, bulk.expected)
        // Only Highlights and Comments remain for review.
        const kinds = await page
          .getByTestId('critic-review-entry')
          .locator('.core-review-entry-kind')
          .evaluateAll(elements => elements.map(element => element.getAttribute('data-kind')))
        expect(kinds.every(kind => kind === 'highlight' || kind === 'comment' || kind === 'commented-span')).toBe(true)

        await undo(app)
        await expectSaved(app, filePath, bulkSource)
        await redo(app)
        await expectSaved(app, filePath, bulk.expected)
        await undo(app)
        await expectSaved(app, filePath, bulkSource)
        await expectHealthy(app, page)
      } finally {
        await app.close()
      }
    })
  }

  test('⌘Z and ⇧⌘Z step through tracked typing and its acceptance', async() => {
    const source = 'Plain words here.\n'
    const { app, page, filePath } = await launchWithReviewMarkdown(source, {
      suppressErrorDialog: true,
      env
    })
    try {
      await page.getByTestId('critic-review-track-changes').click()
      await clickText(page, 'words', 'end')
      await page.keyboard.type(' new')
      const tracked = 'Plain words{++ new++} here.\n'
      await expectSaved(app, filePath, tracked)
      await undo(app)
      await expectSaved(app, filePath, source)
      await redo(app)
      await expectSaved(app, filePath, tracked)

      await clickText(page, ' new', 2)
      await clickReviewMenu(app, 'accept')
      const accepted = 'Plain words new here.\n'
      await expectSaved(app, filePath, accepted)
      await undo(app)
      await expectSaved(app, filePath, tracked)
      await redo(app)
      await expectSaved(app, filePath, accepted)
      await undo(app)
      await undo(app)
      await expectSaved(app, filePath, source)

      await clickText(page, 'here', 'start')
      await page.keyboard.press('Backspace')
      const deleted = 'Plain words{-- --}here.\n'
      await expectSaved(app, filePath, deleted)
      await clickReviewMenu(app, 'reject')
      await expectSaved(app, filePath, source)
      await undo(app)
      await expectSaved(app, filePath, deleted)
      await redo(app)
      await expectSaved(app, filePath, source)
      await expectHealthy(app, page)
    } finally {
      await app.close()
    }
  })
})

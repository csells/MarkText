import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  expectEditorNotFrontmost,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown,
  launchWithDoc,
  sendIpcToRenderer
} from './helpers'
import {
  expectDefaultCoreAuthority,
  expectInstalledArtifactCommit
} from './installedArtifactProvenance'

test('replacing selected text retains the selection intent when visible text is identical', async() => {
  const { app, page, filePath } = await launchWithMarkdown('a{++bc++}d\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
  })
  try {
    await page.locator('span.mu-paragraph-content').click()
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'selectAll')
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('abcd')
    await page.keyboard.insertText('abcd')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('abcd\n')
    await expect(page.locator('.core-recovery-drafts')).toHaveCount(0)
    await expectNoRendererErrors(app)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
  } finally {
    await app.close()
  }
})

for (const [name, source, expected] of [
  [
    'annotated paragraphs',
    'aaa bbb cc{==c==}{>>comment<<}ddd\n\nsend me a kiss by wire!\n',
    'hello{>>comment<<}\n'
  ],
  ['plain paragraphs', 'aaa bbb ccc ddd\n\nsend me a kiss by wire!\n', 'hello\n'],
  [
    'mixed blocks',
    '# Heading\n\naaa bbb cc{==c==}{>>comment<<}ddd\n\n- send me a kiss by wire!\n',
    'hello{>>comment<<}\n'
  ]
] as const) {
  for (const delay of [0, 30]) {
    test(`Select All then typing replaces ${name} without recovery (delay ${delay})`, async() => {
      const { app, page, filePath } = await launchWithMarkdown(source, {
        suppressErrorDialog: true,
        env: {
          MARKTEXT_E2E_HIDDEN_WINDOW: '1',
          MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined
        }
      })
      try {
        if (process.env.MARKTEXT_PACKAGED_APP) await expectInstalledArtifactCommit(page)
        await expectDefaultCoreAuthority(page)
        await expectEditorWindowHidden(app)
        const paragraphs = page.locator('span.mu-paragraph-content')
        await paragraphs.first().click()
        // Native Select All escalates from the current block to the full document.
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'selectAll')
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'selectAll')
        await expect
          .poll(() => page.evaluate(() => window.getSelection()?.toString()))
          .toContain('send me a kiss by wire!')
        await page.keyboard.type('hello', { delay })
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
        await expect(page.locator('.core-recovery-drafts')).toHaveCount(0)
        await expect(paragraphs).toHaveText(['hello'])
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(source)
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
        await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
        await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
        await expectNoRendererErrors(app)
        await expectEditorWindowHidden(app)
        expectEditorNotFrontmost(app)
      } finally {
        await app.close()
      }
      const reopened = await launchWithDoc(filePath, {
        suppressErrorDialog: true,
        env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }
      })
      try {
        await expect(reopened.page.locator('span.mu-paragraph-content')).toHaveText(['hello'])
        await expect(reopened.page.locator('.core-recovery-drafts')).toHaveCount(0)
        await expectNoRendererErrors(reopened.app)
        await expectEditorWindowHidden(reopened.app)
        expectEditorNotFrontmost(reopened.app)
      } finally {
        await reopened.app.close()
      }
    })
  }
}

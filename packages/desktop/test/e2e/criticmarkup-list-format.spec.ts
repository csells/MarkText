import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  enterSourceMode, exitSourceMode, expectEditorNotFrontmost, expectEditorWindowHidden,
  expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer
} from './helpers'

const simple = '- {++first++}{>>keep<<}\n- second\n'
const multiline = '- {++first++}{>>keep<<}\n\n  ```js\n  let x = 1\n  ```\n- second\n'
const ordered = '1. {++first++}{>>keep<<}\n\n   ```js\n   let x = 1\n   ```\n2. second\n'

for (const example of [
  {
    name: 'nested ordered list',
    source: '- outer\n  - {++first++}{>>keep<<}\n  - second\n',
    command: 'ol-order',
    tracked: false,
    expected: '- outer\n  1. {++first++}{>>keep<<}\n  2. second\n'
  },
  {
    name: 'task list',
    source: simple,
    command: 'ul-task',
    tracked: false,
    expected: '- [ ] {++first++}{>>keep<<}\n- [ ] second\n'
  },
  {
    name: 'tracked list markers',
    source: simple,
    command: 'ol-order',
    tracked: true,
    expected: '{~~- ~>1. ~~}{++first++}{>>keep<<}\n{~~- ~>2. ~~}second\n'
  },
  {
    name: 'tracked fenced list',
    source: multiline,
    command: 'ol-order',
    tracked: true,
    expected: `{~~${multiline.slice(0, multiline.indexOf('- second') + 2)}~>${ordered.slice(0, ordered.indexOf('2. second') + 3)}~~}second\n`
  }
]) {
  test(`converts ${example.name} and retains native typing, save, handoff and undo`, async() => {
    const { app, page, filePath } = await launchWithMarkdown(example.source, {
      suppressErrorDialog: true,
      env: {
        MARKTEXT_DOCUMENT_CORE_MODE: undefined,
        MARKTEXT_DOCUMENT_CORE_SHADOW: undefined,
        MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined,
        MARKTEXT_E2E_HIDDEN_WINDOW: '1'
      }
    })
    const save = async(expected: string) => {
      await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
    }
    try {
      if (example.tracked) await page.getByTestId('critic-review-track-changes').click()
      await page.locator('.mu-paragraph-content').filter({ hasText: 'first' }).click()
      await sendIpcToRenderer(app, 'mt::editor-paragraph-action', { type: example.command })
      await save(example.expected)
      await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
      await page.locator('.mu-paragraph-content').filter({ hasText: 'first' }).last().click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
      await page.waitForTimeout(1100)
      await page.keyboard.type('!')
      const position = example.expected.lastIndexOf('{++first++}')
      const edited = example.expected.slice(0, position) + example.expected.slice(position).replace('{++first++}', '{++first!++}')
      await save(edited)
      await enterSourceMode(page, app)
      await exitSourceMode(page, app)
      await save(edited)
      for (const expected of [example.expected, example.source]) {
        await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
        await save(expected)
      }
      await expectNoRendererErrors(app)
      await expectEditorWindowHidden(app)
      expectEditorNotFrontmost(app)
    } finally {
      await app.close()
    }
  })
}

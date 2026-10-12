import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithReviewMarkdown,
  sendIpcToRenderer
} from './helpers'

// Each CriticMarkup form typed key by key on the real keyboard with bracket and
// Markdown pairing on, as they ship. `{` pairs a `}` that the suggestion's last
// marker character turns into its closer; the typed `}` steps over it, as it
// does over any paired `}`, so the file holds exactly what was typed. `~` in a
// Substitution's syntax pairs with nothing (CriticMarkup keeps the shapes it
// shares with Markdown extensions, owner decision 2026-10-12).

const lineEnd = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'

const forms = [
  {
    typed: '{++crit++}',
    untracked: ['Start {++crit++}\n', 'Start {++crit++}x\n'],
    // An Addition's closer would read a typed `{++` as its own.
    tracked: ['Start{~~~> {++crit++}~~}\n', 'Start{~~~> {++critx++}~~}\n']
  },
  {
    typed: '{--gone--}',
    untracked: ['Start {--gone--}\n', 'Start {--gone--}x\n'],
    tracked: ['Start{++ {--gone--}++}\n', 'Start{++ {--gone--}x++}\n']
  },
  {
    typed: '{==mark==}',
    untracked: ['Start {==mark==}\n', 'Start {==mark==}x\n'],
    tracked: ['Start{++ {==mark==}++}\n', 'Start{++ {==mark==}x++}\n']
  },
  {
    typed: '{>>note<<}',
    untracked: ['Start {>>note<<}\n', 'Start {>>note<<}x\n'],
    tracked: ['Start{++ {>>note<<}++}\n', 'Start{++ {>>note<<}x++}\n']
  },
  {
    typed: '{~~old~>new~~}',
    untracked: ['Start {~~old~>new~~}\n', 'Start {~~old~>new~~}x\n'],
    // Tracked, typing right after one's own suggestion extends it (Google Docs).
    tracked: ['Start{++ {~~old~>new~~}++}\n', 'Start{++ {~~old~>newx~~}++}\n']
  }
]

const save = async(app: ElectronApplication, page: Page, filePath: string, expected: string): Promise<void> => {
  await page.evaluate(() => window.__marktextDocumentCore?.settled())
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect.poll(() => readFileSync(filePath, 'utf8'), { timeout: 10000 }).toBe(expected)
  await expect(page.getByTestId('core-recovery-draft')).toHaveCount(0)
}

for (const tracked of [false, true]) {
  for (const form of forms) {
    test(`types ${form.typed} with pairing on (tracked=${tracked})`, async() => {
      const { app, page, filePath } = await launchWithReviewMarkdown('Start\n', {
        suppressErrorDialog: true,
        env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
      })
      try {
        await page.evaluate(() => {
          window.electron.ipcRenderer.send('mt::set-user-preference', { autoPairBracket: true, autoPairMarkdownSyntax: true })
        })
        if (tracked) await page.getByTestId('critic-review-track-changes').click()
        await page.locator('.editor-component .mu-paragraph-content', { hasText: 'Start' }).click()
        await page.keyboard.press(lineEnd)
        const [suggested, continued] = tracked ? form.tracked : form.untracked
        await page.keyboard.type(` ${form.typed}`, { delay: 25 })
        await save(app, page, filePath, suggested)
        await page.keyboard.type('x')
        await save(app, page, filePath, continued)
        await expectEditorWindowHidden(app)
        await expectNoRendererErrors(app)
      } finally {
        await app.close()
      }
    })
  }
}

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { clickMenuById, expectEditorNotFrontmost, expectEditorWindowHidden, getElectronPath, placeCaretInEditor, waitForEditor, waitForMenuReady } from './helpers'
import { defaultCoreLaunchEnvironment, expectDefaultCoreAuthority, expectInstalledArtifactCommit } from './installedArtifactProvenance'

test('discovers interrupted backups on normal startup and preserves their bytes after recovery', async() => {
  const root = mkdtempSync(join(tmpdir(), 'marktext-orphaned-backups-'))
  const profile = join(root, 'profile')
  const backups = join(profile, 'core-recovery-drafts')
  mkdirSync(backups, { recursive: true })
  const filePath = join(root, 'document.md')
  writeFileSync(filePath, 'saved source\n', { flag: 'wx' })
  const completeId = '00000000-0000-0000-0000-000000000001'
  const complete = JSON.stringify({
    id: completeId,
    createdAt: '2026-09-05T00:00:00.000Z',
    documentId: 'complete.md',
    generation: 1,
    revision: 2,
    reason: 'Worker failure',
    visibleText: 'interrupted unsaved text'
  })
  const partial = '{"visibleText":"partially written text'
  const completePath = join(backups, `${completeId}.json.pending`)
  const partialPath = join(backups, '00000000-0000-0000-0000-000000000002.json.pending')
  writeFileSync(completePath, complete, { flag: 'wx' })
  writeFileSync(partialPath, partial, { flag: 'wx' })
  let app: ElectronApplication | undefined
  const launch = async() => {
    const binary = process.env.MARKTEXT_PACKAGED_APP
    app = await electron.launch({
      executablePath: binary ?? getElectronPath(),
      args: [...(binary ? [] : [resolve(__dirname, '../..')]), '--user-data-dir', profile, filePath],
      env: defaultCoreLaunchEnvironment({ PERF_TESTING: 'true', MARKTEXT_E2E_HIDDEN_WINDOW: '1' })
    })
    const page = await app.firstWindow()
    await waitForEditor(page)
    await expectDefaultCoreAuthority(page)
    if (binary) await expectInstalledArtifactCommit(page)
    await expectEditorWindowHidden(app)
    expectEditorNotFrontmost(app)
    return page
  }
  try {
    const page = await launch()
    const drafts = page.getByTestId('core-recovery-draft')
    await expect(drafts).toHaveCount(2)
    await expect(drafts.getByRole('textbox', { name: 'Recovered draft text' })).toHaveValue('interrupted unsaved text')
    await expect(drafts.getByRole('alert')).toBeVisible()
    if (app === undefined) throw new Error('Electron application is unavailable')
    await waitForMenuReady(app)
    await placeCaretInEditor(page)
    await clickMenuById(app, 'tableMenuItem')
    const dialog = page.locator('.ag-insert-table-dialog')
    await expect(dialog).toBeVisible()
    // Recovery remains available without covering modal controls. A trial click
    // checks actual hit testing while leaving the saved document untouched.
    await dialog.locator('.el-button--primary').click({ trial: true, timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    for (const remaining of [1, 0]) {
      await drafts.getByRole('button', { name: 'I have recovered this draft' }).first().click()
      await expect(drafts).toHaveCount(remaining)
    }
    await app?.close()
    app = undefined
    const reopened = await launch()
    await expect(reopened.getByTestId('core-recovery-draft')).toHaveCount(0)
    expect(readFileSync(completePath, 'utf8')).toBe(complete)
    expect(readFileSync(partialPath, 'utf8')).toBe(partial)
    expect(readFileSync(filePath, 'utf8')).toBe('saved source\n')
  } finally {
    await app?.close()
  }
})

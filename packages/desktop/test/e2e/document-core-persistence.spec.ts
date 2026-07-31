import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  clickMenuById,
  closeElectron,
  expectNoCapturedErrors,
  launchElectron,
  placeCaretInEditor,
  typeIntoEditor,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import { expectCanonicalOnDisk } from './documentCoreReviewE2e'

const INITIAL = [
  '# Durable',
  '',
  'Baseline {++tracked++}.',
  ''
].join('\n')

const launchPersistentFile = async(
  filePath: string,
  userDataDir: string
) => {
  const launched = await launchElectron([filePath], { userDataDir })
  await waitForEditor(launched.page)
  await waitForMenuReady(launched.app)
  return launched
}

const crashApplication = async(app: ElectronApplication): Promise<void> => {
  const electronProcess = app.process()
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Electron did not exit after its forced crash'))
    }, 10_000)
    electronProcess.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    if (!electronProcess.kill('SIGKILL')) {
      clearTimeout(timeout)
      reject(new Error('Could not force the Electron process to crash'))
    }
  })
}

test.describe('document-core exact persistence', () => {
  test.describe.configure({ timeout: 90_000 })

  test('persists the pinned canonical revision through crash and reopen', async() => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'marktext-document-core-persistence-')
    )
    const filePath = path.join(directory, 'durable.md')
    fs.writeFileSync(filePath, INITIAL, 'utf8')
    let app: ElectronApplication | undefined

    try {
      let launched = await launchPersistentFile(
        filePath,
        path.join(directory, 'first-user-data')
      )
      app = launched.app
      let page = launched.page

      await placeCaretInEditor(page)
      await typeIntoEditor(page, ' saved-before-crash')
      // The edit's arrival is observed in the mounted view; the explicit
      // Save below is this test's subject, so nothing may save earlier.
      await expect(page.locator('.editor-component')).toContainText(
        ' saved-before-crash'
      )

      // Save is one main-owned transaction: the renderer supplies only the
      // opaque document id and mode, never document bytes or a claimed
      // revision. The written head is captured from the file it produced,
      // and it carries the canonical markers, not a projection.
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toContain(
        ' saved-before-crash'
      )
      const writtenHead = fs.readFileSync(filePath, 'utf8')
      expect(writtenHead).toContain('{++tracked++}')
      await expectNoCapturedErrors(app)

      await crashApplication(app)
      app = undefined

      // Use a fresh application profile so this is strictly a file reopen,
      // not renderer buffer restoration masquerading as persistence.
      launched = await launchPersistentFile(
        filePath,
        path.join(directory, 'second-user-data')
      )
      app = launched.app
      page = launched.page
      // The reopened session's content is observed through its mounted view
      // (the file equals writtenHead by construction, so a bare file read
      // proves nothing about the session); the canonical assert then pins
      // byte identity through the enablement-guarded observation.
      await expect(page.locator('.editor-component')).toContainText(
        ' saved-before-crash'
      )
      await expectCanonicalOnDisk(page, app, filePath, writtenHead)

      await placeCaretInEditor(page)
      await typeIntoEditor(page, ' second-save')
      await expect(page.locator('.editor-component')).toContainText(
        ' second-save'
      )

      // Unsaved canonical edits do not mutate disk. A second public save
      // persists exactly the later authoritative revision.
      expect(fs.readFileSync(filePath, 'utf8')).toBe(writtenHead)
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toContain(
        ' second-save'
      )
      const secondHead = fs.readFileSync(filePath, 'utf8')
      expect(secondHead).not.toBe(writtenHead)
      expect(secondHead).toContain('{++tracked++}')
      await expectNoCapturedErrors(app)
    } finally {
      if (app !== undefined) {
        await closeElectron(app).catch(() => undefined)
      }
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})

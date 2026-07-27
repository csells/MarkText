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
  readCanonicalMarkdown,
  typeIntoEditor,
  waitForEditor,
  waitForMenuReady
} from './helpers'

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
      await expect.poll(() => readCanonicalMarkdown(page)).toContain(
        ' saved-before-crash'
      )
      const writtenHead = await readCanonicalMarkdown(page)

      // Save is one main-owned transaction: the renderer supplies only the
      // opaque document id and mode, never document bytes or a claimed
      // revision.
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(
        writtenHead
      )
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
      await expect.poll(() => readCanonicalMarkdown(page)).toBe(writtenHead)

      await placeCaretInEditor(page)
      await typeIntoEditor(page, ' second-save')
      await expect.poll(() => readCanonicalMarkdown(page)).toContain(
        ' second-save'
      )
      const secondHead = await readCanonicalMarkdown(page)
      expect(secondHead).not.toBe(writtenHead)

      // Unsaved canonical edits do not mutate disk. A second public save
      // persists exactly the later authoritative revision.
      expect(fs.readFileSync(filePath, 'utf8')).toBe(writtenHead)
      await clickMenuById(app, 'fileSaveMenuItem')
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe(
        secondHead
      )
      await expectNoCapturedErrors(app)
    } finally {
      if (app !== undefined) {
        await closeElectron(app).catch(() => undefined)
      }
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeElectron,
  closeElectronAfterStartupFailure,
  expectNoCapturedErrors,
  waitForEditor,
  waitForMenuReady
} from './helpers'
import { expectInstalledArtifactCommit } from './installedArtifactProvenance'

interface InstalledLaunch {
  readonly app: ElectronApplication
  readonly page: Page
}

export interface InstalledFixture {
  readonly filePath: string
  readonly launch: () => Promise<InstalledLaunch>
  readonly cleanup: () => void
}

function installedBinary(): string {
  const configured = process.env.MARKTEXT_PACKAGED_APP
  if (configured === undefined || configured.trim().length === 0) {
    throw new Error(
      'MARKTEXT_PACKAGED_APP must name the mounted or installed MarkText executable'
    )
  }
  const absolute = path.resolve(configured)
  if (!fs.existsSync(absolute)) {
    throw new Error(`Installed MarkText executable does not exist: ${absolute}`)
  }
  return absolute
}

export function createInstalledFixture(markdown: string): InstalledFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-installed-core-'))
  const filePath = path.join(root, 'review.md')
  const userDataDir = path.join(root, 'profile')
  fs.writeFileSync(filePath, markdown, 'utf8')

  const launch = async(): Promise<InstalledLaunch> => {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value
    }
    env.MARKTEXT_TEST_BACKGROUND = '1'
    env.MARKTEXT_ERROR_INTERACTION = '1'
    env.MARKTEXT_E2E_READONLY_BRIDGE = '1'
    env.PERF_TESTING = 'true'

    const app = await electron.launch({
      executablePath: installedBinary(),
      args: ['--user-data-dir', userDataDir, filePath],
      env,
      timeout: 60_000
    })
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await waitForEditor(page, 60_000)
      await waitForMenuReady(app, 60_000)
      await expectInstalledArtifactCommit(page)
      return { app, page }
    } catch (error) {
      return closeElectronAfterStartupFailure(app, error)
    }
  }

  return Object.freeze({
    filePath,
    launch,
    cleanup(): void {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}

export async function closeInstalled(app: ElectronApplication): Promise<void> {
  await expectNoCapturedErrors(app)
  await closeElectron(app)
}

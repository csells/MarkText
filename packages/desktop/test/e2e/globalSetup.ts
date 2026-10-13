import { verifyPackagedApp } from '../../../../scripts/verifyPackagedApp'
import { requiredExpectedBuildCommit } from './installedArtifactProvenance'
import { PACKAGED_ARTIFACT_ENV, prepareInstalledTestCopy } from './installedTestCopy'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LEGACY_MARKDOWN_GUARD_ENV } from '../../src/shared/legacyMarkdownReach'
import { LEGACY_MARKDOWN_LOG_ENV, launchElectron } from './helpers'

export default async function globalSetup(): Promise<void> {
  const executable = process.env.MARKTEXT_PACKAGED_APP
  if (executable) {
    requiredExpectedBuildCommit(process.env.MARKTEXT_EXPECTED_COMMIT)
    verifyPackagedApp(executable)
    // Workers launch the copy; the artifact launch spec reads the original.
    process.env[PACKAGED_ARTIFACT_ENV] = path.resolve(executable)
    process.env.MARKTEXT_PACKAGED_APP = prepareInstalledTestCopy(
      executable,
      path.join(__dirname, '../../test-results/installed-test-copy')
    )
  }
  // Workers inherit this variable; globalTeardown reads the file and removes it.
  const legacyMarkdownLog = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-e2e-legacy-markdown-')),
    'reaches.log'
  )
  fs.writeFileSync(legacyMarkdownLog, '')
  process.env[LEGACY_MARKDOWN_LOG_ENV] = legacyMarkdownLog
  // Launches that copy this environment instead of using launchElectron keep the guard.
  process.env[LEGACY_MARKDOWN_GUARD_ENV] = '1'
  // The run's first launch pages the Electron framework and the app bundle in
  // from disk. On a loaded machine running at background priority that alone
  // has exceeded the first spec's 30s hook budget, so it is paid here instead.
  const { app } = await launchElectron()
  await app.close()
}

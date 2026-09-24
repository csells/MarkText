import { verifyPackagedApp } from '../../../../scripts/verifyPackagedApp'
import { requiredExpectedBuildCommit } from './installedArtifactProvenance'
import { launchElectron } from './helpers'

export default async function globalSetup(): Promise<void> {
  const executable = process.env.MARKTEXT_PACKAGED_APP
  if (executable) {
    requiredExpectedBuildCommit(process.env.MARKTEXT_EXPECTED_COMMIT)
    verifyPackagedApp(executable)
  }
  // The run's first launch pages the Electron framework and the app bundle in
  // from disk. On a loaded machine running at background priority that alone
  // has exceeded the first spec's 30s hook budget, so it is paid here instead.
  const { app } = await launchElectron()
  await app.close()
}

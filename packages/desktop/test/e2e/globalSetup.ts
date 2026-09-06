import { verifyPackagedApp } from '../../../../scripts/verifyPackagedApp'
import { requiredExpectedBuildCommit } from './installedArtifactProvenance'

export default function globalSetup(): void {
  const executable = process.env.MARKTEXT_PACKAGED_APP
  if (!executable) return
  requiredExpectedBuildCommit(process.env.MARKTEXT_EXPECTED_COMMIT)
  verifyPackagedApp(executable)
}

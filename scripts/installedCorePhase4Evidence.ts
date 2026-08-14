import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createInstalledCorePhase4Evidence,
  publishInstalledCorePhase4Artifact,
  validateInstalledCorePhase4Evidence,
  writeInstalledCorePhase4Evidence
} from '../packages/desktop/test/e2e/helpers/installedCorePhase4Evidence'

const required = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`Installed Core Phase 4 evidence requires ${name}`)
  }
  return value
}

const booleanValue = (name: string): boolean => {
  const value = required(name)
  if (value !== 'true' && value !== 'false') {
    throw new Error(`Installed Core Phase 4 evidence ${name} must be true or false`)
  }
  return value === 'true'
}

const integerValue = (name: string): number => {
  const value = Number(required(name))
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Installed Core Phase 4 evidence ${name} must be a nonnegative integer`)
  }
  return value
}

export const runInstalledCorePhase4EvidenceCli = (): void => {
  const [, , command, outputPath] = process.argv
  if (command === '--publish-artifact') {
    const [, , , sourcePath, artifactPath] = process.argv
    if (sourcePath === undefined || artifactPath === undefined) {
      throw new Error(
        'Usage: tsx scripts/installedCorePhase4Evidence.ts ' +
        '--publish-artifact <source> <output>'
      )
    }
    const artifactSha256 = publishInstalledCorePhase4Artifact(
      path.resolve(sourcePath),
      path.resolve(artifactPath)
    )
    process.stdout.write(`${JSON.stringify({ artifactSha256 })}\n`)
    return
  }
  if (!(['--write', '--validate'] as const).includes(command as '--write' | '--validate') ||
    outputPath === undefined) {
    throw new Error(
      'Usage: tsx scripts/installedCorePhase4Evidence.ts ' +
      '--write <output> | --validate <record>'
    )
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const matrix = JSON.parse(readFileSync(path.join(
    repoRoot,
    'specs/baselines/criticmarkup-interaction-matrix.json'
  ), 'utf8')) as Readonly<{ rows: ReadonlyArray<Readonly<{ id: string }>> }>
  if (command === '--validate') {
    const record = JSON.parse(readFileSync(path.resolve(outputPath), 'utf8')) as unknown
    validateInstalledCorePhase4Evidence({
      repoRoot,
      interactionIds: matrix.rows.map(row => row.id),
      record
    })
    return
  }
  const playwrightReportPath = required('MARKTEXT_PHASE4_PLAYWRIGHT_REPORT_PATH')
  JSON.parse(readFileSync(path.resolve(repoRoot, playwrightReportPath), 'utf8'))
  const record = createInstalledCorePhase4Evidence({
    repoRoot,
    interactionIds: matrix.rows.map(row => row.id),
    metadata: {
      buildCommit: required('MARKTEXT_PHASE4_BUILD_COMMIT'),
      harnessCommit: required('MARKTEXT_PHASE4_HARNESS_COMMIT'),
      recordedAt: required('MARKTEXT_PHASE4_RECORDED_AT'),
      package: {
        name: required('MARKTEXT_PHASE4_PACKAGE_NAME'),
        sha256: required('MARKTEXT_PHASE4_PACKAGE_SHA256')
      },
      executable: {
        path: required('MARKTEXT_PHASE4_EXECUTABLE_PATH'),
        sha256: required('MARKTEXT_PHASE4_EXECUTABLE_SHA256')
      },
      platform: {
        name: required('MARKTEXT_PHASE4_PLATFORM'),
        arch: required('MARKTEXT_PHASE4_ARCH'),
        release: required('MARKTEXT_PHASE4_PLATFORM_RELEASE')
      },
      cleanup: {
        result: required('MARKTEXT_PHASE4_CLEANUP_RESULT'),
        applicationProcessCount: integerValue('MARKTEXT_PHASE4_APPLICATION_PROCESS_COUNT'),
        mountedImageDetached: booleanValue('MARKTEXT_PHASE4_MOUNT_DETACHED'),
        packageRemoved: booleanValue('MARKTEXT_PHASE4_PACKAGE_REMOVED'),
        temporaryPathsRemoved: booleanValue('MARKTEXT_PHASE4_TEMPORARY_PATHS_REMOVED')
      },
      playwrightReportPath,
      runnerLogPath: required('MARKTEXT_PHASE4_RUNNER_LOG_PATH')
    }
  })
  const recordSha256 = writeInstalledCorePhase4Evidence({
    repoRoot,
    interactionIds: matrix.rows.map(row => row.id),
    outputPath: path.resolve(outputPath),
    record
  })
  process.stdout.write(`${JSON.stringify({
    recordPath: path.relative(repoRoot, path.resolve(outputPath)),
    recordSha256,
    totalTests: record.totalTests
  })}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runInstalledCorePhase4EvidenceCli()
}

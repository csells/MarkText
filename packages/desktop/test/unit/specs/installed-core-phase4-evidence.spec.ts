import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  INSTALLED_CORE_PHASE4_PROJECT,
  INSTALLED_CORE_PHASE4_MATRIX_PATH,
  INSTALLED_CORE_PHASE4_TEST_SOURCES,
  INSTALLED_CORE_PHASE4_WORKFLOWS,
  createInstalledCorePhase4Evidence,
  validateInstalledCorePhase4Evidence,
  writeInstalledCorePhase4Evidence
} from '../../e2e/helpers/installedCorePhase4Evidence'

const repoRoot = path.resolve(import.meta.dirname, '../../../../..')
const matrix = JSON.parse(readFileSync(path.join(
  repoRoot,
  'specs/baselines/criticmarkup-interaction-matrix.json'
), 'utf8')) as Readonly<{ rows: ReadonlyArray<Readonly<{ id: string }>> }>
const interactionIds = matrix.rows.map(row => row.id)
const commit = '0123456789abcdef0123456789abcdef01234567'
const recordedAt = '2026-08-14T18:19:20.000Z'
let evidenceRoot = ''
let playwrightReportPath = ''
let runnerLogPath = ''

const readCommittedSource = (_commit: string, sourcePath: string): Buffer =>
  readFileSync(path.join(repoRoot, sourcePath))

const passingSpec = (file: string, title: string) => ({
  title,
  file,
  ok: true,
  tests: [{
    projectName: INSTALLED_CORE_PHASE4_PROJECT,
    expectedStatus: 'passed',
    results: [{ status: 'passed', retry: 0 }]
  }]
})

const passingReport = () => ({
  config: {
    workers: 1,
    projects: [{ name: INSTALLED_CORE_PHASE4_PROJECT, retries: 0 }]
  },
  errors: [],
  suites: [{
    title: 'installed Core Phase 4 consumers',
    specs: [
      ...interactionIds.map(id => passingSpec(
        'test/e2e/installed-core-review.spec.ts',
        `${id} follows the installed interaction matrix`
      )),
      ...INSTALLED_CORE_PHASE4_WORKFLOWS.map(workflow => passingSpec(
        `test/e2e/${path.basename(workflow.specPath)}`,
        workflow.testTitle
      ))
    ]
  }]
})

const writeReport = (report: ReturnType<typeof passingReport>): void => {
  writeFileSync(path.join(repoRoot, playwrightReportPath), `${JSON.stringify(report)}\n`)
}

const metadata = () => ({
  buildCommit: commit,
  harnessCommit: commit,
  recordedAt,
  package: {
    name: 'marktext-mac-arm64-0.20.0-dev.dmg',
    sha256: 'a'.repeat(64)
  },
  executable: {
    path: 'marktext.app/Contents/MacOS/marktext',
    sha256: 'b'.repeat(64)
  },
  platform: {
    name: 'darwin',
    arch: 'arm64',
    release: '25.6.0'
  },
  cleanup: {
    result: 'pass' as const,
    applicationProcessCount: 0,
    mountedImageDetached: true,
    packageRemoved: true,
    temporaryPathsRemoved: true
  },
  playwrightReportPath,
  runnerLogPath
})

describe('installed Core Phase 4 consumer evidence', () => {
  beforeAll(() => {
    evidenceRoot = mkdtempSync(path.join(repoRoot, '.phase4-evidence-test-'))
    playwrightReportPath = path.relative(
      repoRoot,
      path.join(evidenceRoot, 'playwright-report.json')
    )
    runnerLogPath = path.relative(repoRoot, path.join(evidenceRoot, 'runner.log'))
    writeFileSync(path.join(repoRoot, runnerLogPath), 'installed runner completed\n')
  })

  beforeEach(() => {
    writeReport(passingReport())
    writeFileSync(path.join(repoRoot, runnerLogPath), 'installed runner completed\n')
  })

  afterAll(() => rmSync(evidenceRoot, { recursive: true, force: true }))

  it('materializes the exact passing 25-row matrix and eight workflow denominator', () => {
    const record = createInstalledCorePhase4Evidence({
      repoRoot,
      interactionIds,
      metadata: metadata(),
      readCommittedSource
    })

    expect(() => validateInstalledCorePhase4Evidence({
      repoRoot,
      interactionIds,
      record,
      readCommittedSource
    })).not.toThrow()
    expect(record.schema).toBe('marktext-installed-core-phase4-evidence-v1')
    expect(record.result).toBe('pass')
    expect(record.totalTests).toBe(33)
    expect(record.tests).toHaveLength(33)
    expect(record.interactionMatrixRowIds).toEqual([...interactionIds].sort())
    expect(record.workflowIds).toEqual(
      INSTALLED_CORE_PHASE4_WORKFLOWS.map(workflow => workflow.id).sort()
    )
    expect(record.buildCommit).toBe(commit)
    expect(record.harnessCommit).toBe(commit)
    expect(record.interactionMatrix).toEqual({
      path: INSTALLED_CORE_PHASE4_MATRIX_PATH,
      sha256: createHash('sha256')
        .update(readFileSync(path.join(repoRoot, INSTALLED_CORE_PHASE4_MATRIX_PATH)))
        .digest('hex')
    })
    expect(record.executionArtifacts).toEqual({
      playwrightReport: {
        path: playwrightReportPath,
        sha256: createHash('sha256')
          .update(readFileSync(path.join(repoRoot, playwrightReportPath)))
          .digest('hex')
      },
      runnerLog: {
        path: runnerLogPath,
        sha256: createHash('sha256')
          .update(readFileSync(path.join(repoRoot, runnerLogPath)))
          .digest('hex')
      }
    })
    expect(record.testSources.map(source => source.path)).toEqual(
      [...INSTALLED_CORE_PHASE4_TEST_SOURCES]
    )
    for (const source of record.testSources) {
      const actual = createHash('sha256')
        .update(readFileSync(path.join(repoRoot, source.path)))
        .digest('hex')
      expect(source.sha256).toBe(actual)
    }
  })

  it.each([
    ['a missing test', (report: ReturnType<typeof passingReport>) => {
      report.suites[0]?.specs.pop()
    }],
    ['a duplicate test', (report: ReturnType<typeof passingReport>) => {
      const first = report.suites[0]?.specs[0]
      if (first !== undefined) report.suites[0]?.specs.push(structuredClone(first))
    }],
    ['a failed test', (report: ReturnType<typeof passingReport>) => {
      const result = report.suites[0]?.specs[0]?.tests[0]?.results[0]
      if (result !== undefined) result.status = 'failed'
    }],
    ['a retried test', (report: ReturnType<typeof passingReport>) => {
      const test = report.suites[0]?.specs[0]?.tests[0]
      if (test !== undefined) test.results.push({ status: 'passed', retry: 1 })
    }],
    ['a wrong project', (report: ReturnType<typeof passingReport>) => {
      const test = report.suites[0]?.specs[0]?.tests[0]
      if (test !== undefined) test.projectName = 'unpacked'
    }],
    ['a retry-enabled project', (report: ReturnType<typeof passingReport>) => {
      const project = report.config.projects[0]
      if (project !== undefined) project.retries = 1
    }]
  ])('refuses Playwright output containing %s', (_label, mutate) => {
    const report = passingReport()
    mutate(report)
    writeReport(report)
    expect(() => createInstalledCorePhase4Evidence({
      repoRoot,
      interactionIds,
      metadata: metadata(),
      readCommittedSource
    })).toThrow(/Phase 4/)
  })

  it.each([
    ['cleanup failure', () => {
      const value = metadata()
      value.cleanup.result = 'fail' as 'pass'
      return value
    }],
    ['a live application', () => {
      const value = metadata()
      value.cleanup.applicationProcessCount = 1
      return value
    }],
    ['a mounted image', () => {
      const value = metadata()
      value.cleanup.mountedImageDetached = false
      return value
    }],
    ['a stale harness checkout', () => {
      const value = metadata()
      value.harnessCommit = 'f'.repeat(40)
      return value
    }]
  ])('refuses evidence before exact cleanup: %s', (_label, mutate) => {
    expect(() => createInstalledCorePhase4Evidence({
      repoRoot,
      interactionIds,
      metadata: mutate(),
      readCommittedSource
    })).toThrow(/Phase 4/)
  })

  it('writes the authenticated record create-only', () => {
    const record = createInstalledCorePhase4Evidence({
      repoRoot,
      interactionIds,
      metadata: metadata(),
      readCommittedSource
    })
    const root = mkdtempSync(path.join(os.tmpdir(), 'mt-phase4-evidence-'))
    const outputPath = path.join(root, 'record.json')
    try {
      const digest = writeInstalledCorePhase4Evidence({
        repoRoot,
        interactionIds,
        outputPath,
        record,
        readCommittedSource
      })
      expect(digest).toMatch(/^[0-9a-f]{64}$/u)
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(record)
      expect(() => writeInstalledCorePhase4Evidence({
        repoRoot,
        interactionIds,
        outputPath,
        record,
        readCommittedSource
      })).toThrow(/already exists/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['Playwright report', () => {
      writeFileSync(path.join(repoRoot, playwrightReportPath), '{}\n')
    }],
    ['runner log', () => {
      writeFileSync(path.join(repoRoot, runnerLogPath), 'tampered\n')
    }]
  ])('rejects a stale or tampered pinned %s', (label, tamper) => {
    const record = createInstalledCorePhase4Evidence({
      repoRoot,
      interactionIds,
      metadata: metadata(),
      readCommittedSource
    })
    tamper()
    expect(() => validateInstalledCorePhase4Evidence({
      repoRoot,
      interactionIds,
      record,
      readCommittedSource
    })).toThrow(new RegExp(`${label} digest is stale`, 'u'))
  })

  it('rejects a stale interaction-matrix digest even when all 25 IDs are unchanged', () => {
    const valid = createInstalledCorePhase4Evidence({
      repoRoot,
      interactionIds,
      metadata: metadata(),
      readCommittedSource
    })
    const record = {
      ...valid,
      interactionMatrix: {
        ...valid.interactionMatrix,
        sha256: '0'.repeat(64)
      }
    }
    expect(() => validateInstalledCorePhase4Evidence({
      repoRoot,
      interactionIds,
      record,
      readCommittedSource
    })).toThrow(/interaction matrix digest is stale/)
  })
})

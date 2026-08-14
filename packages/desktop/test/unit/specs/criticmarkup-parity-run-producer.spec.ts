import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  type CriticMarkupParityBaseline,
  type CriticMarkupParityDispositionOverlay,
  type CriticMarkupParityEvidenceFileLifecycle,
  type CriticMarkupParityRowManifest,
  CriticMarkupParityTestCommandError,
  parseCriticMarkupParityRunArguments,
  requireGreenCriticMarkupParityDispositions,
  runCriticMarkupParityTestCommand
} from '../../../../../scripts/criticmarkupParityBaseline'

const baselineCommit = 'a'.repeat(40)
const baseline: CriticMarkupParityBaseline = {
  schema: 'marktext-criticmarkup-parity-baseline-v1',
  baselineCommit,
  sources: [],
  items: [{
    id: 'command:test',
    kind: 'command',
    source: 'commands.ts',
    label: 'test'
  }]
}
const overlay: CriticMarkupParityDispositionOverlay = {
  schema: 'marktext-criticmarkup-parity-dispositions-v1',
  baselineCommit,
  dispositions: {
    'command:test': { kind: 'parity-row', ref: 'editing.test' }
  }
}
const plannedManifest = (): CriticMarkupParityRowManifest => ({
  schema: 'marktext-criticmarkup-parity-rows-v1',
  baselineCommit,
  rows: [{
    id: 'editing.test',
    upstreamBehavior: 'The ordinary test command proves the installed behavior.',
    existingOracle: 'tests/test.spec.ts',
    productionPathTest: 'named-production-path-test: tests/test.spec.ts#ordinary command',
    status: 'planned'
  }]
})
const sha256 = (value: string | Buffer): string => createHash('sha256')
  .update(value)
  .digest('hex')

const roots: string[] = []
const cleanFixture = (
  manifest: CriticMarkupParityRowManifest = plannedManifest()
): Readonly<{
  root: string
  buildCommit: string
  manifest: CriticMarkupParityRowManifest
  manifestPath: string
}> => {
  const root = mkdtempSync(join(tmpdir(), 'marktext-parity-producer-'))
  roots.push(root)
  const manifestPath = 'parity-rows.json'
  mkdirSync(resolve(root, 'tests'), { recursive: true })
  writeFileSync(
    resolve(root, 'tests/test.spec.ts'),
    'test("ordinary command", () => expect(true).toBe(true))\n'
  )
  writeFileSync(
    resolve(root, manifestPath),
    `${JSON.stringify(manifest, null, 2)}\n`
  )
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', [
    '-c',
    'user.name=Parity Test',
    '-c',
    'user.email=parity@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'fixture'
  ], { cwd: root })
  const buildCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  }).trim()
  return { root, buildCommit, manifest, manifestPath }
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true })
  }
})

describe('CriticMarkup parity run producer', () => {
  it('parses an explicit ordinary test command without rewriting its arguments', () => {
    expect(parseCriticMarkupParityRunArguments([
      'b'.repeat(40),
      '2026-08-14T18:00:00.000Z',
      'specs/evidence/run-1',
      'editing.zeta,editing.alpha',
      '--',
      'node_modules/.bin/vitest',
      'run',
      'tests/test.spec.ts',
      '--reporter=verbose'
    ])).toEqual({
      expectedBuildCommit: 'b'.repeat(40),
      recordedAt: '2026-08-14T18:00:00.000Z',
      outputDirectory: 'specs/evidence/run-1',
      rowIds: ['editing.zeta', 'editing.alpha'],
      command: 'node_modules/.bin/vitest',
      args: ['run', 'tests/test.spec.ts', '--reporter=verbose']
    })
  })

  it('runs an ordinary passing command and writes bound create-only evidence', () => {
    const fixture = cleanFixture()
    const outputDirectory = resolve(fixture.root, 'evidence')

    const result = runCriticMarkupParityTestCommand({
      repoRoot: fixture.root,
      baseline,
      overlay,
      manifest: fixture.manifest,
      rowManifestPath: fixture.manifestPath,
      expectedBuildCommit: fixture.buildCommit,
      recordedAt: '2026-08-14T18:00:00.000Z',
      outputDirectory,
      rowIds: ['editing.test'],
      command: process.execPath,
      args: [
        '-e',
        'process.stdout.write("ordinary pass\\n"); process.stderr.write("diagnostic\\n")',
        'tests/test.spec.ts'
      ]
    })

    expect(result).toMatchObject({
      recordPath: 'evidence/run.json',
      transcriptPath: 'evidence/transcript.json'
    })
    const transcript = readFileSync(resolve(fixture.root, result.transcriptPath), 'utf8')
    expect(JSON.parse(transcript)).toMatchObject({
      schema: 'marktext-criticmarkup-parity-transcript-v1',
      buildCommit: fixture.buildCommit,
      exitStatus: 0,
      stdout: 'ordinary pass\n',
      stderr: 'diagnostic\n'
    })
    expect(result.transcriptSha256).toBe(sha256(transcript))

    const record = readFileSync(resolve(fixture.root, result.recordPath), 'utf8')
    expect(JSON.parse(record)).toMatchObject({
      schema: 'marktext-criticmarkup-parity-execution-v1',
      baselineCommit,
      buildCommit: fixture.buildCommit,
      recordedAt: '2026-08-14T18:00:00.000Z',
      result: 'pass',
      rowIds: ['editing.test'],
      transcript: {
        path: result.transcriptPath,
        sha256: result.transcriptSha256
      }
    })
    expect(result.recordSha256).toBe(sha256(record))
  })

  it('records requested row IDs once in deterministic order', () => {
    const manifest = plannedManifest()
    manifest.rows.push({
      ...manifest.rows[0],
      id: 'editing.alpha',
      upstreamBehavior: 'The alpha behavior also passes.'
    })
    const fixture = cleanFixture(manifest)
    const twoItemBaseline: CriticMarkupParityBaseline = {
      ...baseline,
      items: [
        ...baseline.items,
        { id: 'command:alpha', kind: 'command', source: 'commands.ts', label: 'alpha' }
      ]
    }
    const twoRowOverlay: CriticMarkupParityDispositionOverlay = {
      ...overlay,
      dispositions: {
        ...overlay.dispositions,
        'command:alpha': { kind: 'parity-row', ref: 'editing.alpha' }
      }
    }

    const result = runCriticMarkupParityTestCommand({
      repoRoot: fixture.root,
      baseline: twoItemBaseline,
      overlay: twoRowOverlay,
      manifest,
      rowManifestPath: fixture.manifestPath,
      expectedBuildCommit: fixture.buildCommit,
      recordedAt: '2026-08-14T18:00:00.000Z',
      outputDirectory: resolve(fixture.root, 'evidence'),
      rowIds: ['editing.test', 'editing.alpha'],
      command: process.execPath,
      args: ['-e', 'process.exit(0)', 'tests/test.spec.ts']
    })
    const record = JSON.parse(readFileSync(
      resolve(fixture.root, result.recordPath),
      'utf8'
    )) as { rowIds: string[] }

    expect(record.rowIds).toEqual(['editing.alpha', 'editing.test'])
  })

  it('refuses to credit a row whose exact test source is absent from the command', () => {
    const fixture = cleanFixture()

    expect(() => runCriticMarkupParityTestCommand({
      repoRoot: fixture.root,
      baseline,
      overlay,
      manifest: fixture.manifest,
      rowManifestPath: fixture.manifestPath,
      expectedBuildCommit: fixture.buildCommit,
      recordedAt: '2026-08-14T18:00:00.000Z',
      outputDirectory: resolve(fixture.root, 'evidence'),
      rowIds: ['editing.test'],
      command: process.execPath,
      args: ['-e', 'process.exit(0)']
    })).toThrow(
      'CriticMarkup parity row editing.test source tests/test.spec.ts is absent from the test command'
    )
  })

  it('produces transcript-authenticated evidence accepted by the deep green gate', () => {
    const fixture = cleanFixture()
    const result = runCriticMarkupParityTestCommand({
      repoRoot: fixture.root,
      baseline,
      overlay,
      manifest: fixture.manifest,
      rowManifestPath: fixture.manifestPath,
      expectedBuildCommit: fixture.buildCommit,
      recordedAt: '2026-08-14T18:00:00.000Z',
      outputDirectory: resolve(fixture.root, 'evidence'),
      rowIds: ['editing.test'],
      command: process.execPath,
      args: ['-e', 'process.stdout.write("pass\\n")', 'tests/test.spec.ts']
    })
    const greenManifest: CriticMarkupParityRowManifest = {
      ...fixture.manifest,
      rows: [{
        ...fixture.manifest.rows[0],
        status: 'green',
        execution: {
          buildCommit: fixture.buildCommit,
          sourcePath: 'tests/test.spec.ts',
          sourceSha256: sha256(readFileSync(
            resolve(fixture.root, 'tests/test.spec.ts')
          )),
          recordPath: result.recordPath,
          recordSha256: result.recordSha256
        }
      }]
    }
    writeFileSync(
      resolve(fixture.root, fixture.manifestPath),
      `${JSON.stringify(greenManifest, null, 2)}\n`
    )

    expect(() => requireGreenCriticMarkupParityDispositions(
      baseline,
      overlay,
      greenManifest,
      fixture.root,
      fixture.manifestPath
    )).not.toThrow()
  })

  it('captures a failing command and writes no evidence', () => {
    const fixture = cleanFixture()
    const outputDirectory = resolve(fixture.root, 'evidence')
    let failure: unknown

    try {
      runCriticMarkupParityTestCommand({
        repoRoot: fixture.root,
        baseline,
        overlay,
        manifest: fixture.manifest,
        rowManifestPath: fixture.manifestPath,
        expectedBuildCommit: fixture.buildCommit,
        recordedAt: '2026-08-14T18:00:00.000Z',
        outputDirectory,
        rowIds: ['editing.test'],
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write("failed out\\n"); ' +
          'process.stderr.write("failed err\\n"); process.exit(7)',
          'tests/test.spec.ts'
        ]
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(CriticMarkupParityTestCommandError)
    expect(failure).toMatchObject({
      exitStatus: 7,
      stdout: 'failed out\n',
      stderr: 'failed err\n'
    })
    expect(existsSync(outputDirectory)).toBe(false)
  })

  it('publishes neither file when staging the second evidence file fails', () => {
    const fixture = cleanFixture()
    const outputDirectory = resolve(fixture.root, 'evidence')
    let writes = 0
    const lifecycle: CriticMarkupParityEvidenceFileLifecycle = {
      createTempDirectory: prefix => mkdtempSync(prefix),
      writeCreateOnly: (path, data) => {
        writes += 1
        if (writes === 2) throw new Error('forced second write failure')
        writeFileSync(path, data, { flag: 'wx' })
      },
      publishDirectory: (stagedDirectory, finalDirectory) => {
        renameSync(stagedDirectory, finalDirectory)
      },
      removeDirectory: path => rmSync(path, { recursive: true, force: true })
    }

    expect(() => runCriticMarkupParityTestCommand({
      repoRoot: fixture.root,
      baseline,
      overlay,
      manifest: fixture.manifest,
      rowManifestPath: fixture.manifestPath,
      expectedBuildCommit: fixture.buildCommit,
      recordedAt: '2026-08-14T18:00:00.000Z',
      outputDirectory,
      rowIds: ['editing.test'],
      command: process.execPath,
      args: ['-e', 'process.exit(0)', 'tests/test.spec.ts']
    }, lifecycle)).toThrow('forced second write failure')
    expect(existsSync(outputDirectory)).toBe(false)
    expect(readdirSync(fixture.root)).not.toContainEqual(
      expect.stringMatching(/^\.evidence-staging-/u)
    )
  })

  it.each([
    {
      violation: 'duplicate rows',
      rowIds: ['editing.test', 'editing.test'],
      expected: 'duplicate row IDs'
    },
    {
      violation: 'an unknown row',
      rowIds: ['editing.unknown'],
      expected: 'unknown row editing.unknown'
    }
  ])('rejects $violation before executing', ({ rowIds, expected }) => {
    const fixture = cleanFixture()
    const marker = resolve(fixture.root, 'command-ran')

    expect(() => runCriticMarkupParityTestCommand({
      repoRoot: fixture.root,
      baseline,
      overlay,
      manifest: fixture.manifest,
      rowManifestPath: fixture.manifestPath,
      expectedBuildCommit: fixture.buildCommit,
      recordedAt: '2026-08-14T18:00:00.000Z',
      outputDirectory: resolve(fixture.root, 'evidence'),
      rowIds,
      command: process.execPath,
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`,
        'tests/test.spec.ts'
      ]
    })).toThrow(expected)
    expect(existsSync(marker)).toBe(false)
  })

  it('rejects a placeholder row before executing', () => {
    const fixture = cleanFixture()
    fixture.manifest.rows[0].productionPathTest =
      'required-new-production-path-test: command:test'
    writeFileSync(
      resolve(fixture.root, fixture.manifestPath),
      `${JSON.stringify(fixture.manifest, null, 2)}\n`
    )
    const marker = resolve(fixture.root, 'command-ran')

    expect(() => runCriticMarkupParityTestCommand({
      repoRoot: fixture.root,
      baseline,
      overlay,
      manifest: fixture.manifest,
      rowManifestPath: fixture.manifestPath,
      expectedBuildCommit: fixture.buildCommit,
      recordedAt: '2026-08-14T18:00:00.000Z',
      outputDirectory: resolve(fixture.root, 'evidence'),
      rowIds: ['editing.test'],
      command: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`]
    })).toThrow('placeholder row editing.test')
    expect(existsSync(marker)).toBe(false)
  })

  it('rejects dirty and nonmatching checkouts before executing', () => {
    const dirty = cleanFixture()
    writeFileSync(resolve(dirty.root, 'dirty.txt'), 'dirty\n')
    expect(() => runCriticMarkupParityTestCommand({
      repoRoot: dirty.root,
      baseline,
      overlay,
      manifest: dirty.manifest,
      rowManifestPath: dirty.manifestPath,
      expectedBuildCommit: dirty.buildCommit,
      recordedAt: '2026-08-14T18:00:00.000Z',
      outputDirectory: resolve(dirty.root, 'evidence'),
      rowIds: ['editing.test'],
      command: process.execPath,
      args: ['-e', 'process.exit(0)', 'tests/test.spec.ts']
    })).toThrow('checkout is dirty')

    const nonmatching = cleanFixture()
    expect(() => runCriticMarkupParityTestCommand({
      repoRoot: nonmatching.root,
      baseline,
      overlay,
      manifest: nonmatching.manifest,
      rowManifestPath: nonmatching.manifestPath,
      expectedBuildCommit: 'f'.repeat(40),
      recordedAt: '2026-08-14T18:00:00.000Z',
      outputDirectory: resolve(nonmatching.root, 'evidence'),
      rowIds: ['editing.test'],
      command: process.execPath,
      args: ['-e', 'process.exit(0)', 'tests/test.spec.ts']
    })).toThrow('does not match')
  })

  it('refuses an existing output without executing the command', () => {
    const fixture = cleanFixture()
    const outputDirectory = resolve(fixture.root, 'evidence')
    mkdirSync(outputDirectory)
    const marker = resolve(fixture.root, 'command-ran')

    expect(() => runCriticMarkupParityTestCommand({
      repoRoot: fixture.root,
      baseline,
      overlay,
      manifest: fixture.manifest,
      rowManifestPath: fixture.manifestPath,
      expectedBuildCommit: fixture.buildCommit,
      recordedAt: '2026-08-14T18:00:00.000Z',
      outputDirectory,
      rowIds: ['editing.test'],
      command: process.execPath,
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`,
        'tests/test.spec.ts'
      ]
    })).toThrow('output already exists')
    expect(existsSync(marker)).toBe(false)
  })
})

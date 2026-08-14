import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  collectCriticMarkupParityBaseline,
  type CriticMarkupParityDisposition,
  type CriticMarkupParityDispositionOverlay,
  type CriticMarkupParityExecutionRunRecord,
  type CriticMarkupParityRowManifest,
  requireGreenCriticMarkupParityDispositions,
  validateCriticMarkupParityDispositions
} from '../../../../../scripts/criticmarkupParityBaseline'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const baselineCommit = 'e52106fd1cdcbd33c1258b7b0cdc7013c4c5d86c'
const baseline = collectCriticMarkupParityBaseline(repoRoot, baselineCommit)
const emptyRows = {
  schema: 'marktext-criticmarkup-parity-rows-v1' as const,
  baselineCommit,
  rows: []
}
const sha256 = (value: string | Buffer): string => createHash('sha256')
  .update(value)
  .digest('hex')
const writeParityManifest = (
  root: string,
  path: string,
  manifest: CriticMarkupParityRowManifest
): void => writeFileSync(
  resolve(root, path),
  `${JSON.stringify(manifest, null, 2)}\n`
)

const createParityExecutionFixture = (): {
  root: string
  execution: NonNullable<CriticMarkupParityRowManifest['rows'][number]['execution']>
} => {
  const root = mkdtempSync(join(tmpdir(), 'marktext-parity-execution-'))
  const sourcePath = 'tests/undo.spec.ts'
  const source = 'test("installed undo", () => expect(true).toBe(true))\n'
  mkdirSync(resolve(root, 'tests'), { recursive: true })
  writeFileSync(resolve(root, sourcePath), source)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['add', sourcePath], { cwd: root })
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
  const command = {
    executable: process.execPath,
    args: ['--test', sourcePath],
    cwd: '.' as const
  }
  const runner = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version
  }
  const transcriptPath = 'runs/transcript.json'
  const transcript = `${JSON.stringify({
    schema: 'marktext-criticmarkup-parity-transcript-v1',
    buildCommit,
    command,
    runner,
    exitStatus: 0,
    stdout: 'pass\n',
    stderr: ''
  }, null, 2)}\n`
  const recordPath = 'runs/parity.json'
  const record = `${JSON.stringify({
    schema: 'marktext-criticmarkup-parity-execution-v1',
    buildCommit,
    recordedAt: '2026-08-14T17:00:00.000Z',
    result: 'pass',
    rowIds: ['editing.undo']
  }, null, 2)}\n`
  mkdirSync(resolve(root, 'runs'), { recursive: true })
  writeFileSync(resolve(root, transcriptPath), transcript)
  writeFileSync(resolve(root, recordPath), record)

  return {
    root,
    execution: {
      buildCommit,
      sourcePath,
      sourceSha256: sha256(source),
      recordPath,
      recordSha256: sha256(record)
    }
  }
}

const bindParityExecutionFixture = (
  fixture: ReturnType<typeof createParityExecutionFixture>,
  row: CriticMarkupParityRowManifest['rows'][number],
  recordOverrides: Partial<CriticMarkupParityExecutionRunRecord> = {}
): {
  manifest: CriticMarkupParityRowManifest
  manifestPath: string
  record: string
} => {
  const evidenceFreeManifest = {
    schema: 'marktext-criticmarkup-parity-rows-v1' as const,
    baselineCommit,
    rows: [{
      id: row.id,
      upstreamBehavior: row.upstreamBehavior,
      existingOracle: row.existingOracle,
      productionPathTest: row.productionPathTest
    }]
  }
  const record = `${JSON.stringify({
    schema: 'marktext-criticmarkup-parity-execution-v1',
    baselineCommit,
    rowManifestSha256: sha256(`${JSON.stringify(evidenceFreeManifest, null, 2)}\n`),
    buildCommit: fixture.execution.buildCommit,
    recordedAt: '2026-08-14T17:00:00.000Z',
    result: 'pass',
    rowIds: [row.id],
    command: {
      executable: process.execPath,
      args: ['--test', fixture.execution.sourcePath],
      cwd: '.'
    },
    runner: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version
    },
    transcript: {
      path: 'runs/transcript.json',
      sha256: sha256(readFileSync(resolve(
        fixture.root,
        'runs/transcript.json'
      )))
    },
    ...recordOverrides
  }, null, 2)}\n`
  writeFileSync(resolve(fixture.root, fixture.execution.recordPath), record)
  const manifest: CriticMarkupParityRowManifest = {
    schema: 'marktext-criticmarkup-parity-rows-v1',
    baselineCommit,
    rows: [{
      ...row,
      execution: {
        ...fixture.execution,
        recordSha256: sha256(record)
      }
    }]
  }
  const manifestPath = 'parity-rows.json'
  writeParityManifest(fixture.root, manifestPath, manifest)
  return { manifest, manifestPath, record }
}
const artifactSchemaCases = [
  {
    artifact: 'baseline',
    validate: (schema?: string) => validateCriticMarkupParityDispositions(
      {
        ...(schema === undefined ? {} : { schema }),
        baselineCommit,
        sources: [],
        items: []
      },
      {
        schema: 'marktext-criticmarkup-parity-dispositions-v1',
        baselineCommit,
        dispositions: {}
      },
      emptyRows
    ),
    expected: /CriticMarkup parity baseline schema is invalid/
  },
  {
    artifact: 'disposition overlay',
    validate: (schema?: string) => validateCriticMarkupParityDispositions(
      baseline,
      {
        ...(schema === undefined ? {} : { schema }),
        baselineCommit,
        dispositions: {}
      },
      emptyRows
    ),
    expected: /Parity disposition overlay schema is invalid/
  },
  {
    artifact: 'row manifest',
    validate: (schema?: string) => validateCriticMarkupParityDispositions(
      baseline,
      {
        schema: 'marktext-criticmarkup-parity-dispositions-v1',
        baselineCommit,
        dispositions: {}
      },
      {
        ...(schema === undefined ? {} : { schema }),
        baselineCommit,
        rows: []
      }
    ),
    expected: /Parity row manifest schema is invalid/
  }
]

const completeParityRowFixture = (): {
  overlay: CriticMarkupParityDispositionOverlay
  validRow: CriticMarkupParityRowManifest['rows'][number]
} => {
  const dispositions: Record<string, CriticMarkupParityDisposition> =
    Object.fromEntries(baseline.items.map(entry => [
      entry.id,
      {
        kind: 'unaffected' as const,
        rationale: 'The item does not cross the document authority seam.'
      }
    ]))
  dispositions['command:edit.undo'] = {
    kind: 'parity-row',
    ref: 'editing.undo'
  }
  return {
    overlay: {
      schema: 'marktext-criticmarkup-parity-dispositions-v1',
      baselineCommit,
      dispositions
    },
    validRow: {
      id: 'editing.undo',
      upstreamBehavior: 'Undo restores the previous editor state.',
      existingOracle: 'packages/desktop/test/e2e/editor-undo.spec.ts',
      productionPathTest: 'planned: installed Core-mode undo/redo parity',
      status: 'planned'
    }
  }
}

describe('CriticMarkup upstream parity baseline', () => {
  it('derives a finite denominator from every recorded upstream surface', () => {
    const counts = Object.fromEntries(
      baseline.sources.map(source => [source.kind, source.count])
    )

    expect(counts).toEqual({
      command: 99,
      preference: 72,
      editorPlugin: 17,
      route: 11,
      menuEntry: 146,
      readmeFeature: 8,
      muyaReadmeFeature: 11,
      desktopUnitTest: 50,
      desktopE2eTest: 59,
      muyaUnitTest: 216,
      muyaE2eTest: 70,
      deferredTest: 25,
      backlogItem: 39,
      manualParityCase: 4,
      disabledCommand: 2
    })
    expect(baseline.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'command:edit.undo' }),
      expect.objectContaining({ id: 'preference:endOfLine' }),
      expect.objectContaining({ id: 'editor-plugin:TableChessboard' }),
      expect.objectContaining({ id: 'route:/editor' }),
      expect.objectContaining({ id: 'menu-entry:menu.file.save' }),
      expect.objectContaining({
        id: 'test:packages/muya/e2e/tests/typing/ime.spec.ts'
      })
    ]))
  })

  it('rejects an inventory until every upstream item has a disposition', () => {
    const overlay: CriticMarkupParityDispositionOverlay = {
      schema: 'marktext-criticmarkup-parity-dispositions-v1',
      baselineCommit,
      dispositions: {}
    }

    expect(() => validateCriticMarkupParityDispositions(baseline, overlay, emptyRows)).toThrow(
      /829 upstream parity items are undisposed/
    )
  })

  it('rejects stale or unsubstantiated dispositions', () => {
    const dispositions: Record<string, CriticMarkupParityDisposition> =
      Object.fromEntries(baseline.items.map(entry => [
        entry.id,
        {
          kind: 'unaffected' as const,
          rationale: 'The item does not cross the document authority seam.'
        }
      ]))
    const overlay: CriticMarkupParityDispositionOverlay = {
      schema: 'marktext-criticmarkup-parity-dispositions-v1',
      baselineCommit,
      dispositions: {
        ...dispositions,
        'command:removed-upstream-command': {
          kind: 'parity-row',
          ref: 'specs/parity/removed-upstream-command.md'
        }
      }
    }

    expect(() => validateCriticMarkupParityDispositions(baseline, overlay, emptyRows)).toThrow(
      /1 stale parity disposition/
    )

    delete overlay.dispositions['command:removed-upstream-command']
    overlay.dispositions[baseline.items[0].id] = { kind: 'unaffected' }
    expect(() => validateCriticMarkupParityDispositions(baseline, overlay, emptyRows)).toThrow(
      /requires a rationale/
    )
  })

  it('rejects a parity-row disposition whose human-owned row does not exist', () => {
    const dispositions: Record<string, CriticMarkupParityDisposition> =
      Object.fromEntries(baseline.items.map(entry => [
        entry.id,
        {
          kind: 'unaffected' as const,
          rationale: 'The item does not cross the document authority seam.'
        }
      ]))
    dispositions[baseline.items[0].id] = {
      kind: 'parity-row' as const,
      ref: 'phase-0-core-source-edit'
    }
    const overlay: CriticMarkupParityDispositionOverlay = {
      schema: 'marktext-criticmarkup-parity-dispositions-v1',
      baselineCommit,
      dispositions
    }

    expect(() => validateCriticMarkupParityDispositions(
      baseline,
      overlay,
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: []
      }
    )).toThrow(/unresolved parity row phase-0-core-source-edit/)
  })

  it('rejects a human-owned row that does not name the upstream behavior', () => {
    const dispositions: Record<string, CriticMarkupParityDisposition> =
      Object.fromEntries(baseline.items.map(entry => [
        entry.id,
        {
          kind: 'unaffected' as const,
          rationale: 'The item does not cross the document authority seam.'
        }
      ]))
    dispositions['command:edit.undo'] = {
      kind: 'parity-row',
      ref: 'editing.undo'
    }

    expect(() => validateCriticMarkupParityDispositions(
      baseline,
      {
        schema: 'marktext-criticmarkup-parity-dispositions-v1',
        baselineCommit,
        dispositions
      },
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: [{
          id: 'editing.undo',
          upstreamBehavior: '',
          existingOracle: 'packages/desktop/test/e2e/editor-undo.spec.ts',
          productionPathTest: 'planned: installed Core-mode undo/redo parity',
          status: 'planned'
        }]
      }
    )).toThrow(/Parity row editing.undo requires an upstream behavior/)
  })

  it('rejects parity rows frozen for a different upstream baseline', () => {
    const dispositions: Record<string, CriticMarkupParityDisposition> =
      Object.fromEntries(baseline.items.map(entry => [
        entry.id,
        {
          kind: 'unaffected' as const,
          rationale: 'The item does not cross the document authority seam.'
        }
      ]))
    const rows: CriticMarkupParityRowManifest = {
      schema: 'marktext-criticmarkup-parity-rows-v1',
      baselineCommit: 'different-upstream-baseline',
      rows: []
    }

    expect(() => validateCriticMarkupParityDispositions(
      baseline,
      {
        schema: 'marktext-criticmarkup-parity-dispositions-v1',
        baselineCommit,
        dispositions
      },
      rows
    )).toThrow(/Parity row manifest targets a different upstream baseline/)
  })

  it('accepts a complete human-owned row referenced by an upstream item', () => {
    const dispositions: Record<string, CriticMarkupParityDisposition> =
      Object.fromEntries(baseline.items.map(entry => [
        entry.id,
        {
          kind: 'unaffected' as const,
          rationale: 'The item does not cross the document authority seam.'
        }
      ]))
    dispositions['command:edit.undo'] = {
      kind: 'parity-row',
      ref: 'editing.undo'
    }

    expect(() => validateCriticMarkupParityDispositions(
      baseline,
      {
        schema: 'marktext-criticmarkup-parity-dispositions-v1',
        baselineCommit,
        dispositions
      },
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: [{
          id: 'editing.undo',
          upstreamBehavior: 'Undo restores the previous editor state.',
          existingOracle: 'packages/desktop/test/e2e/editor-undo.spec.ts',
          productionPathTest: 'planned: installed Core-mode undo/redo parity',
          status: 'planned'
        }]
      }
    )).not.toThrow()
  })

  it('rejects a structurally valid planned row with its count and ID', () => {
    const { overlay, validRow } = completeParityRowFixture()

    expect(() => requireGreenCriticMarkupParityDispositions(
      baseline,
      overlay,
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: [validRow]
      }
    )).toThrow(
      'CriticMarkup parity completion is not green: 1 planned row [editing.undo]'
    )
  })

  it('reports planned and red row counts and IDs in deterministic order', () => {
    const { overlay, validRow } = completeParityRowFixture()
    overlay.dispositions['command:edit.redo'] = {
      kind: 'parity-row',
      ref: 'editing.redo'
    }

    expect(() => requireGreenCriticMarkupParityDispositions(
      baseline,
      overlay,
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: [
          { ...validRow, id: 'editing.redo', status: 'red' },
          { ...validRow, id: 'editing.undo' }
        ]
      }
    )).toThrow(
      'CriticMarkup parity completion is not green: ' +
      '1 planned row [editing.undo]; 1 red row [editing.redo]'
    )
  })

  it('rejects green rows whose production-path oracle is still a placeholder', () => {
    const { overlay, validRow } = completeParityRowFixture()
    overlay.dispositions['command:edit.redo'] = {
      kind: 'parity-row',
      ref: 'editing.redo'
    }

    expect(() => requireGreenCriticMarkupParityDispositions(
      baseline,
      overlay,
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: [
          {
            ...validRow,
            id: 'editing.undo',
            productionPathTest: 'required-new-production-path-test: command:edit.undo',
            status: 'green'
          },
          {
            ...validRow,
            id: 'editing.redo',
            productionPathTest: 'retained-upstream-test: redo.spec.ts; release-candidate execution pending',
            status: 'green'
          }
        ]
      }
    )).toThrow(
      'CriticMarkup parity completion is not green: ' +
      '2 placeholder production-path tests [editing.redo, editing.undo]'
    )
  })

  it('rejects a hand-edited green row with no authenticated execution', () => {
    const { overlay, validRow } = completeParityRowFixture()

    expect(() => requireGreenCriticMarkupParityDispositions(
      baseline,
      overlay,
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: [{
          ...validRow,
          productionPathTest: 'named-production-path-test: undo.spec.ts#installed undo',
          status: 'green'
        }]
      }
    )).toThrow(
      'CriticMarkup parity completion is not green: ' +
      '1 green row lacks authenticated execution evidence [editing.undo]'
    )
  })

  it('rejects a green row with malformed execution metadata', () => {
    const { overlay, validRow } = completeParityRowFixture()

    expect(() => requireGreenCriticMarkupParityDispositions(
      baseline,
      overlay,
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: [{
          ...validRow,
          productionPathTest: 'named-production-path-test: undo.spec.ts#installed undo',
          status: 'green',
          execution: {
            buildCommit: 'hand-edited',
            sourcePath: 'undo.spec.ts',
            sourceSha256: 'not-a-digest',
            recordPath: 'run.json',
            recordSha256: 'not-a-digest'
          }
        }]
      }
    )).toThrow('Parity row editing.undo execution evidence is invalid')
  })

  it('rejects non-string execution metadata at the artifact boundary', () => {
    const { overlay, validRow } = completeParityRowFixture()

    expect(() => requireGreenCriticMarkupParityDispositions(
      baseline,
      overlay,
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: [{
          ...validRow,
          productionPathTest: 'named-production-path-test: undo.spec.ts#installed undo',
          status: 'green',
          execution: {
            buildCommit: '0'.repeat(40),
            sourcePath: null as unknown as string,
            sourceSha256: '1'.repeat(64),
            recordPath: 'run.json',
            recordSha256: '2'.repeat(64)
          }
        }]
      }
    )).toThrow('Parity row editing.undo execution evidence is invalid')
  })

  it('does not trust well-shaped execution metadata without repository authentication', () => {
    const { overlay, validRow } = completeParityRowFixture()

    expect(() => requireGreenCriticMarkupParityDispositions(
      baseline,
      overlay,
      {
        schema: 'marktext-criticmarkup-parity-rows-v1',
        baselineCommit,
        rows: [{
          ...validRow,
          productionPathTest: 'named-production-path-test: undo.spec.ts#installed undo',
          status: 'green',
          execution: {
            buildCommit: '0'.repeat(40),
            sourcePath: 'undo.spec.ts',
            sourceSha256: '1'.repeat(64),
            recordPath: 'run.json',
            recordSha256: '2'.repeat(64)
          }
        }]
      }
    )).toThrow(
      'CriticMarkup parity completion cannot authenticate green execution evidence without a repository root'
    )
  })

  it('rejects a green row whose execution record digest does not match', () => {
    const fixture = createParityExecutionFixture()
    const { overlay, validRow } = completeParityRowFixture()
    const bound = bindParityExecutionFixture(fixture, {
      ...validRow,
      productionPathTest: `named-production-path-test: ${fixture.execution.sourcePath}#installed undo`,
      status: 'green'
    })
    const execution = bound.manifest.rows[0].execution
    if (execution === undefined || execution === null) throw new Error('Fixture lost execution')
    bound.manifest.rows[0].execution = {
      ...execution,
      recordSha256: '0'.repeat(64)
    }
    writeParityManifest(fixture.root, bound.manifestPath, bound.manifest)
    try {
      expect(() => requireGreenCriticMarkupParityDispositions(
        baseline,
        overlay,
        bound.manifest,
        fixture.root,
        bound.manifestPath
      )).toThrow('Parity row editing.undo execution record digest does not match')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects a green row whose test source digest does not match its build commit', () => {
    const fixture = createParityExecutionFixture()
    const { overlay, validRow } = completeParityRowFixture()
    const bound = bindParityExecutionFixture(fixture, {
      ...validRow,
      productionPathTest: `named-production-path-test: ${fixture.execution.sourcePath}#installed undo`,
      status: 'green'
    })
    const execution = bound.manifest.rows[0].execution
    if (execution === undefined || execution === null) throw new Error('Fixture lost execution')
    bound.manifest.rows[0].execution = {
      ...execution,
      sourceSha256: '0'.repeat(64)
    }
    writeParityManifest(fixture.root, bound.manifestPath, bound.manifest)
    try {
      expect(() => requireGreenCriticMarkupParityDispositions(
        baseline,
        overlay,
        bound.manifest,
        fixture.root,
        bound.manifestPath
      )).toThrow(
        'Parity row editing.undo test source digest does not match build commit'
      )
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects a digest-authenticated run record that does not prove a passing row', () => {
    const fixture = createParityExecutionFixture()
    const { overlay, validRow } = completeParityRowFixture()
    const bound = bindParityExecutionFixture(fixture, {
      ...validRow,
      productionPathTest: `named-production-path-test: ${fixture.execution.sourcePath}#installed undo`,
      status: 'green'
    }, { result: 'fail' })
    try {
      expect(() => requireGreenCriticMarkupParityDispositions(
        baseline,
        overlay,
        bound.manifest,
        fixture.root,
        bound.manifestPath
      )).toThrow(
        'Parity row editing.undo execution record does not prove a passing execution'
      )
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects a passing record without baseline and row-manifest bindings', () => {
    const fixture = createParityExecutionFixture()
    const { overlay, validRow } = completeParityRowFixture()
    const manifest: CriticMarkupParityRowManifest = {
      schema: 'marktext-criticmarkup-parity-rows-v1',
      baselineCommit,
      rows: [{
        ...validRow,
        productionPathTest: `named-production-path-test: ${fixture.execution.sourcePath}#installed undo`,
        status: 'green',
        execution: fixture.execution
      }]
    }
    const manifestPath = 'parity-rows.json'
    writeParityManifest(fixture.root, manifestPath, manifest)
    try {
      expect(() => requireGreenCriticMarkupParityDispositions(
        baseline,
        overlay,
        manifest,
        fixture.root,
        manifestPath
      )).toThrow('Parity row editing.undo execution record is invalid')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects a passing record from a stale parity baseline', () => {
    const fixture = createParityExecutionFixture()
    const { overlay, validRow } = completeParityRowFixture()
    const bound = bindParityExecutionFixture(fixture, {
      ...validRow,
      productionPathTest: `named-production-path-test: ${fixture.execution.sourcePath}#installed undo`,
      status: 'green'
    }, { baselineCommit: 'f'.repeat(40) })
    try {
      expect(() => requireGreenCriticMarkupParityDispositions(
        baseline,
        overlay,
        bound.manifest,
        fixture.root,
        bound.manifestPath
      )).toThrow('Parity row editing.undo execution record targets a stale baseline')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects a passing record from a stale parity row manifest', () => {
    const fixture = createParityExecutionFixture()
    const { overlay, validRow } = completeParityRowFixture()
    const bound = bindParityExecutionFixture(fixture, {
      ...validRow,
      productionPathTest: `named-production-path-test: ${fixture.execution.sourcePath}#installed undo`,
      status: 'green'
    }, { rowManifestSha256: 'f'.repeat(64) })
    try {
      expect(() => requireGreenCriticMarkupParityDispositions(
        baseline,
        overlay,
        bound.manifest,
        fixture.root,
        bound.manifestPath
      )).toThrow('Parity row editing.undo execution record targets a stale row manifest')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects a passing record whose command omits the named test source', () => {
    const fixture = createParityExecutionFixture()
    const { overlay, validRow } = completeParityRowFixture()
    const bound = bindParityExecutionFixture(fixture, {
      ...validRow,
      productionPathTest: `named-production-path-test: ${fixture.execution.sourcePath}#installed undo`,
      status: 'green'
    }, {
      command: {
        executable: process.execPath,
        args: ['--test'],
        cwd: '.'
      }
    })
    try {
      expect(() => requireGreenCriticMarkupParityDispositions(
        baseline,
        overlay,
        bound.manifest,
        fixture.root,
        bound.manifestPath
      )).toThrow(
        `Parity row editing.undo source ${fixture.execution.sourcePath} ` +
        'is absent from the test command'
      )
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects non-canonical checked-in row-manifest bytes', () => {
    const fixture = createParityExecutionFixture()
    const { overlay, validRow } = completeParityRowFixture()
    const bound = bindParityExecutionFixture(fixture, {
      ...validRow,
      productionPathTest: `named-production-path-test: ${fixture.execution.sourcePath}#installed undo`,
      status: 'green'
    })
    writeFileSync(
      resolve(fixture.root, bound.manifestPath),
      JSON.stringify(bound.manifest)
    )
    try {
      expect(() => requireGreenCriticMarkupParityDispositions(
        baseline,
        overlay,
        bound.manifest,
        fixture.root,
        bound.manifestPath
      )).toThrow('CriticMarkup parity row manifest is not canonical')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('accepts execution bound to the exact baseline and canonical row manifest', () => {
    const fixture = createParityExecutionFixture()
    const { overlay, validRow } = completeParityRowFixture()
    const bound = bindParityExecutionFixture(fixture, {
      ...validRow,
      productionPathTest: `named-production-path-test: ${fixture.execution.sourcePath}#installed undo`,
      status: 'green'
    })
    try {
      expect(() => requireGreenCriticMarkupParityDispositions(
        baseline,
        overlay,
        bound.manifest,
        fixture.root,
        bound.manifestPath
      )).not.toThrow()
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('keeps the current empty final overlays red at the deep completion gate', () => {
    const overlay = JSON.parse(readFileSync(resolve(
      repoRoot,
      'specs/baselines/criticmarkup-parity-dispositions.json'
    ), 'utf8')) as CriticMarkupParityDispositionOverlay
    const rows = JSON.parse(readFileSync(resolve(
      repoRoot,
      'specs/baselines/criticmarkup-parity-rows.json'
    ), 'utf8')) as CriticMarkupParityRowManifest

    expect(Object.keys(overlay.dispositions)).toHaveLength(0)
    expect(rows.rows).toHaveLength(0)
    expect(() => requireGreenCriticMarkupParityDispositions(
      baseline,
      overlay,
      rows
    )).toThrow('829 upstream parity items are undisposed')
  })

  it('exposes the deep completion gate through --require-green', () => {
    const result = spawnSync(
      resolve(repoRoot, 'node_modules/.bin/tsx'),
      ['scripts/criticmarkupParityBaseline.ts', '--require-green'],
      { cwd: repoRoot, encoding: 'utf8' }
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('829 upstream parity items are undisposed')
    expect(result.stderr).not.toContain('Usage:')
  })

  it.each(artifactSchemaCases)(
    'rejects a wrong $artifact schema',
    ({ validate, expected }) => {
      expect(() => validate('wrong-schema')).toThrow(expected)
    }
  )

  it.each(artifactSchemaCases)(
    'rejects a missing $artifact schema',
    ({ validate, expected }) => {
      expect(() => validate()).toThrow(expected)
    }
  )

  it.each([
    {
      artifact: 'baseline',
      validate: () => validateCriticMarkupParityDispositions(
        null as unknown as typeof baseline,
        {
          schema: 'marktext-criticmarkup-parity-dispositions-v1',
          baselineCommit,
          dispositions: {}
        },
        emptyRows
      ),
      expected: /CriticMarkup parity baseline schema is invalid/
    },
    {
      artifact: 'disposition overlay',
      validate: () => validateCriticMarkupParityDispositions(
        baseline,
        null as unknown as CriticMarkupParityDispositionOverlay,
        emptyRows
      ),
      expected: /Parity disposition overlay schema is invalid/
    },
    {
      artifact: 'row manifest',
      validate: () => validateCriticMarkupParityDispositions(
        baseline,
        {
          schema: 'marktext-criticmarkup-parity-dispositions-v1',
          baselineCommit,
          dispositions: {}
        },
        null as unknown as CriticMarkupParityRowManifest
      ),
      expected: /Parity row manifest schema is invalid/
    }
  ])('rejects a missing $artifact at the runtime boundary', ({ validate, expected }) => {
    expect(validate).toThrow(expected)
  })

  it.each([
    {
      violation: 'duplicate human-owned row IDs',
      rows: (validRow: CriticMarkupParityRowManifest['rows'][number]) => [validRow, validRow],
      expected: /Parity row ID is missing or duplicated/
    },
    {
      violation: 'an orphan human-owned row',
      rows: (validRow: CriticMarkupParityRowManifest['rows'][number]) => [
        validRow,
        { ...validRow, id: 'orphan.row' }
      ],
      expected: /Parity row orphan.row is not referenced/
    },
    {
      violation: 'a missing existing oracle',
      rows: (validRow: CriticMarkupParityRowManifest['rows'][number]) => [
        { ...validRow, existingOracle: '' }
      ],
      expected: /requires an existing oracle/
    },
    {
      violation: 'a missing production-path test',
      rows: (validRow: CriticMarkupParityRowManifest['rows'][number]) => [
        { ...validRow, productionPathTest: '' }
      ],
      expected: /requires a production-path test/
    },
    {
      violation: 'an invalid row status',
      rows: (validRow: CriticMarkupParityRowManifest['rows'][number]) => [{
        ...validRow,
        status: 'greenish'
      }],
      expected: /has invalid status greenish/
    }
  ])('rejects $violation', ({ rows, expected }) => {
    const { overlay, validRow } = completeParityRowFixture()
    expect(() => validateCriticMarkupParityDispositions(baseline, overlay, {
      schema: 'marktext-criticmarkup-parity-rows-v1',
      baselineCommit,
      rows: rows(validRow)
    })).toThrow(expected)
  })

  it('rejects an invalid parity disposition kind', () => {
    const { overlay, validRow } = completeParityRowFixture()
    overlay.dispositions['command:edit.undo'] = {
      kind: 'bogus',
      ref: 'editing.undo'
    } as unknown as CriticMarkupParityDisposition
    expect(() => validateCriticMarkupParityDispositions(baseline, overlay, {
      schema: 'marktext-criticmarkup-parity-rows-v1',
      baselineCommit,
      rows: [validRow]
    })).toThrow(/has invalid kind bogus/)
  })
})

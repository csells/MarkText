import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ParityDispositionKind =
  | 'parity-row'
  | 'unaffected'
  | 'approved-decision'

export interface CriticMarkupParityItem {
  id: string
  kind: string
  source: string
  label: string
  attributes?: Record<string, string | boolean | number>
}

export interface CriticMarkupParitySource {
  kind: string
  paths: string[]
  count: number
}

export interface CriticMarkupParityBaseline {
  schema: 'marktext-criticmarkup-parity-baseline-v1'
  baselineCommit: string
  sources: CriticMarkupParitySource[]
  items: CriticMarkupParityItem[]
}

export interface CriticMarkupParityDisposition {
  kind: ParityDispositionKind
  ref?: string
  rationale?: string
}

export interface CriticMarkupParityDispositionOverlay {
  schema: 'marktext-criticmarkup-parity-dispositions-v1'
  baselineCommit: string
  dispositions: Record<string, CriticMarkupParityDisposition>
}

export interface CriticMarkupParityRow {
  id: string
  upstreamBehavior: string
  existingOracle: string
  productionPathTest: string
  status: 'planned' | 'red' | 'green'
  execution?: CriticMarkupParityExecutionEvidence | null
}

export interface CriticMarkupParityExecutionEvidence {
  buildCommit: string
  sourcePath: string
  sourceSha256: string
  recordPath: string
  recordSha256: string
}

export interface CriticMarkupParityExecutionRunRecord {
  schema: 'marktext-criticmarkup-parity-execution-v1'
  baselineCommit: string
  rowManifestSha256: string
  buildCommit: string
  recordedAt: string
  result: 'pass' | 'fail'
  rowIds: string[]
}

export interface CriticMarkupParityRowManifest {
  schema: 'marktext-criticmarkup-parity-rows-v1'
  baselineCommit: string
  rows: CriticMarkupParityRow[]
}

const requireArtifactSchema = <Artifact>(
  artifact: unknown,
  schema: string,
  errorMessage: string
): Artifact => {
  if (
    typeof artifact !== 'object' ||
    artifact === null ||
    !('schema' in artifact) ||
    artifact.schema !== schema
  ) {
    throw new Error(errorMessage)
  }
  return artifact as Artifact
}

const readAtCommit = (
  repoRoot: string,
  baselineCommit: string,
  path: string
): string => execFileSync(
  'git',
  ['show', `${baselineCommit}:${path}`],
  { cwd: repoRoot, encoding: 'utf8' }
)

const listAtCommit = (
  repoRoot: string,
  baselineCommit: string,
  directory: string
): string[] => execFileSync(
  'git',
  ['ls-tree', '-r', '--name-only', baselineCommit, '--', directory],
  { cwd: repoRoot, encoding: 'utf8' }
).split(/\r?\n/u).filter(Boolean).sort()

const grepAtCommit = (
  repoRoot: string,
  baselineCommit: string,
  pattern: string,
  paths: string[]
): string[] => {
  const result = spawnSync(
    'git',
    ['grep', '-n', '-E', pattern, baselineCommit, '--', ...paths],
    { cwd: repoRoot, encoding: 'utf8' }
  )
  if (result.status === 1) {
    return []
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git grep failed while collecting parity baseline')
  }
  return result.stdout.split(/\r?\n/u).filter(Boolean)
}

const item = (
  id: string,
  kind: string,
  source: string,
  label: string,
  attributes?: CriticMarkupParityItem['attributes']
): CriticMarkupParityItem => ({
  id,
  kind,
  source,
  label,
  ...(attributes ? { attributes } : {})
})

const contentId = (prefix: string, source: string, label: string): string => {
  const digest = createHash('sha256')
    .update(`${source}\0${label}`)
    .digest('hex')
    .slice(0, 12)
  return `${prefix}:${digest}`
}

const repositoryPath = (
  repoRoot: string,
  path: string,
  label: string
): string => {
  const absolutePath = resolve(repoRoot, path)
  const pathWithinRepository = relative(repoRoot, absolutePath)
  if (
    pathWithinRepository.startsWith('..') ||
    isAbsolute(pathWithinRepository)
  ) {
    throw new Error(`${label} path escapes the repository`)
  }
  return absolutePath
}

const canonicalParityRowManifest = (
  manifest: CriticMarkupParityRowManifest,
  includeExecution: boolean
): string => `${JSON.stringify({
  schema: manifest.schema,
  baselineCommit: manifest.baselineCommit,
  rows: manifest.rows.map(row => ({
    id: row.id,
    upstreamBehavior: row.upstreamBehavior,
    existingOracle: row.existingOracle,
    productionPathTest: row.productionPathTest,
    status: row.status,
    ...(includeExecution && row.execution !== undefined
      ? {
        execution: row.execution === null
          ? null
          : {
            buildCommit: row.execution.buildCommit,
            sourcePath: row.execution.sourcePath,
            sourceSha256: row.execution.sourceSha256,
            recordPath: row.execution.recordPath,
            recordSha256: row.execution.recordSha256
          }
      }
      : {})
  }))
}, null, 2)}\n`

const uniqueMatches = (source: string, pattern: RegExp): string[] =>
  [...new Set([...source.matchAll(pattern)].map(match => match[1]))].sort()

const collectTestItems = (
  files: string[],
  kind: string
): CriticMarkupParityItem[] => files
  .filter(path => path.endsWith('.spec.ts'))
  .map(path => item(`test:${path}`, kind, path, path))

const collectDeferredTests = (
  baselineCommit: string,
  matches: string[]
): CriticMarkupParityItem[] => {
  const deferred: CriticMarkupParityItem[] = []
  const pattern = /^\s*(?:test|it|describe)\.(?:skip|fixme|todo)\s*\(|^\s*(?:test|it)\.skipIf\s*\(/

  for (const match of matches) {
    const parsed = match.match(new RegExp(`^${baselineCommit}:([^:]+):(\\d+):(.*)$`, 'u'))
    if (!parsed) {
      throw new Error(`Cannot parse git grep result: ${match}`)
    }
    const [, path, lineNumber, line] = parsed
    if (pattern.test(line)) {
      deferred.push(item(
        `deferred:${path}:${lineNumber}`,
        'deferredTest',
        path,
        line.trim()
      ))
    }
  }

  return deferred
}

const collectBacklogItems = (
  readSource: (path: string) => string,
  path: string
): CriticMarkupParityItem[] => {
  const backlog: CriticMarkupParityItem[] = []
  readSource(path).split(/\r?\n/u).forEach((line, index) => {
    const match = line.match(/^\s*[-*] \[([ xX])\]\s+(.+)$/u)
    if (match) {
      const [, status, label] = match
      backlog.push(item(
        contentId('backlog', path, label),
        'backlogItem',
        path,
        label,
        { completed: status.toLowerCase() === 'x', line: index + 1 }
      ))
    }
  })
  return backlog
}

const collectFeatureItems = (
  readSource: (path: string) => string,
  path: string,
  kind: string,
  idPrefix: string
): CriticMarkupParityItem[] => {
  const features: CriticMarkupParityItem[] = []
  let inFeatures = false
  readSource(path).split(/\r?\n/u).forEach(line => {
    if (line === '## Features') {
      inFeatures = true
      return
    }
    if (inFeatures && /^## /u.test(line)) {
      inFeatures = false
    }
    if (inFeatures && line.startsWith('- ')) {
      const label = line.slice(2)
      features.push(item(contentId(idPrefix, path, label), kind, path, label))
    }
  })
  return features
}

const collectManualParityCases = (
  readSource: (path: string) => string,
  path: string
): CriticMarkupParityItem[] => readSource(path)
  .split(/\r?\n/u)
  .filter(line => line.startsWith('### Steps'))
  .map(line => item(
    contentId('manual-parity', path, line),
    'manualParityCase',
    path,
    line.replace(/^###\s+/u, '')
  ))

export const collectCriticMarkupParityBaseline = (
  repoRoot: string,
  baselineCommit: string
): CriticMarkupParityBaseline => {
  const readSource = (path: string): string =>
    readAtCommit(repoRoot, baselineCommit, path)
  const listSource = (directory: string): string[] =>
    listAtCommit(repoRoot, baselineCommit, directory)
  const commandPath = 'packages/desktop/src/common/commands/constants.ts'
  const preferencePath = 'packages/desktop/src/main/preferences/schema.json'
  const preferenceDefaultPath = 'packages/desktop/static/preference.json'
  const pluginPath = 'packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue'
  const routePath = 'packages/desktop/src/renderer/src/router/index.ts'
  const readmePath = 'README.md'
  const muyaReadmePath = 'packages/muya/README.md'
  const backlogPath = 'packages/muya/e2e/BACKLOG.md'
  const manualQaPath = 'packages/desktop/test/PARITY_QA.md'
  const rendererCommandPath = 'packages/desktop/src/renderer/src/commands/index.ts'

  const commands = uniqueMatches(
    readSource(commandPath),
    /^\s*[A-Z0-9_]+:\s*'([^']+)'/gmu
  ).map(value => item(`command:${value}`, 'command', commandPath, value))

  const preferenceSchema = JSON.parse(readSource(preferencePath)) as object
  const preferenceDefaults = JSON.parse(readSource(preferenceDefaultPath)) as object
  const preferences = [...new Set([
    ...Object.keys(preferenceSchema),
    ...Object.keys(preferenceDefaults)
  ])].sort().map(value => item(
    `preference:${value}`,
    'preference',
    Object.hasOwn(preferenceSchema, value) ? preferencePath : preferenceDefaultPath,
    value,
    {
      inSchema: Object.hasOwn(preferenceSchema, value),
      inDefaults: Object.hasOwn(preferenceDefaults, value)
    }
  ))

  const plugins = uniqueMatches(
    readSource(pluginPath),
    /\bMuya\.use\(\s*([A-Za-z_$][\w$]*)/gu
  ).map(value => item(`editor-plugin:${value}`, 'editorPlugin', pluginPath, value))

  const routes = uniqueMatches(
    readSource(routePath),
    /\bpath:\s*'([^']*)'/gu
  ).map(value => item(`route:${value}`, 'route', routePath, value || '(index route)'))

  const menuRoots = [
    'packages/desktop/src/main/menu',
    'packages/desktop/src/main/contextMenu',
    'packages/desktop/src/renderer/src/contextMenu'
  ]
  const menuFiles = menuRoots.flatMap(path => listSource(path))
    .filter(path => /\.(?:ts|vue)$/u.test(path))
  const menuKeys = new Map<string, string>()
  for (const path of menuFiles) {
    for (const key of uniqueMatches(
      readSource(path),
      /\bt\(\s*'((?:menu|contextMenu)\.[^']+)'/gu
    )) {
      if (!menuKeys.has(key)) {
        menuKeys.set(key, path)
      }
    }
  }
  const menuEntries = [...menuKeys.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, path]) => item(`menu-entry:${key}`, 'menuEntry', path, key))

  const readmeFeatures = collectFeatureItems(
    readSource,
    readmePath,
    'readmeFeature',
    'readme-feature'
  )
  const muyaReadmeFeatures = collectFeatureItems(
    readSource,
    muyaReadmePath,
    'muyaReadmeFeature',
    'muya-readme-feature'
  )

  const desktopTestFiles = listSource('packages/desktop/test')
  const muyaFiles = listSource('packages/muya')
  const desktopUnitTests = collectTestItems(
    desktopTestFiles.filter(path => path.startsWith('packages/desktop/test/unit/')),
    'desktopUnitTest'
  )
  const desktopE2eTests = collectTestItems(
    desktopTestFiles.filter(path => path.startsWith('packages/desktop/test/e2e/')),
    'desktopE2eTest'
  )
  const muyaE2eTests = collectTestItems(
    muyaFiles.filter(path => path.startsWith('packages/muya/e2e/tests/')),
    'muyaE2eTest'
  )
  const muyaUnitTests = collectTestItems(
    muyaFiles.filter(path => !path.startsWith('packages/muya/e2e/')),
    'muyaUnitTest'
  )
  const deferredTests = collectDeferredTests(
    baselineCommit,
    grepAtCommit(
      repoRoot,
      baselineCommit,
      '(^|[^A-Za-z])(test|it|describe)\\.(skip|fixme|todo|skipIf)',
      [
        'packages/desktop/test',
        'packages/muya/e2e',
        'packages/muya/test',
        'packages/muya/src'
      ]
    )
  )
  const backlogItems = collectBacklogItems(readSource, backlogPath)
  const manualParityCases = collectManualParityCases(readSource, manualQaPath)
  const disabledCommands = uniqueMatches(
    readSource(rendererCommandPath),
    /^\s*\/\/\s+id:\s*'([^']+)'/gmu
  ).map(value => item(
    `disabled-command:${value}`,
    'disabledCommand',
    rendererCommandPath,
    value
  ))

  const groups: Array<[string, string[], CriticMarkupParityItem[]]> = [
    ['command', [commandPath], commands],
    ['preference', [preferencePath, preferenceDefaultPath], preferences],
    ['editorPlugin', [pluginPath], plugins],
    ['route', [routePath], routes],
    ['menuEntry', menuFiles, menuEntries],
    ['readmeFeature', [readmePath], readmeFeatures],
    ['muyaReadmeFeature', [muyaReadmePath], muyaReadmeFeatures],
    ['desktopUnitTest', ['packages/desktop/test/unit/**/*.spec.ts'], desktopUnitTests],
    ['desktopE2eTest', ['packages/desktop/test/e2e/**/*.spec.ts'], desktopE2eTests],
    ['muyaUnitTest', ['packages/muya/**/*.spec.ts', '!packages/muya/e2e/**'], muyaUnitTests],
    ['muyaE2eTest', ['packages/muya/e2e/tests/**/*.spec.ts'], muyaE2eTests],
    ['deferredTest', [
      'packages/desktop/test/**/*.ts',
      'packages/muya/{src,test,e2e}/**/*.ts'
    ], deferredTests],
    ['backlogItem', [backlogPath], backlogItems],
    ['manualParityCase', [manualQaPath], manualParityCases],
    ['disabledCommand', [rendererCommandPath], disabledCommands]
  ]

  const items = groups.flatMap(([, , entries]) => entries)
    .sort((left, right) => left.id.localeCompare(right.id))

  const ids = new Set(items.map(entry => entry.id))
  if (ids.size !== items.length) {
    throw new Error('Parity inventory contains duplicate item IDs')
  }

  return {
    schema: 'marktext-criticmarkup-parity-baseline-v1',
    baselineCommit,
    sources: groups.map(([kind, paths, entries]) => ({
      kind,
      paths,
      count: entries.length
    })),
    items
  }
}

export const validateCriticMarkupParityDispositions = (
  baselineArtifact: unknown,
  overlayArtifact: unknown,
  manifestArtifact: unknown
): void => {
  const baseline = requireArtifactSchema<CriticMarkupParityBaseline>(
    baselineArtifact,
    'marktext-criticmarkup-parity-baseline-v1',
    'CriticMarkup parity baseline schema is invalid'
  )
  const overlay = requireArtifactSchema<CriticMarkupParityDispositionOverlay>(
    overlayArtifact,
    'marktext-criticmarkup-parity-dispositions-v1',
    'Parity disposition overlay schema is invalid'
  )
  const manifest = requireArtifactSchema<CriticMarkupParityRowManifest>(
    manifestArtifact,
    'marktext-criticmarkup-parity-rows-v1',
    'Parity row manifest schema is invalid'
  )
  if (baseline.baselineCommit !== overlay.baselineCommit) {
    throw new Error('Parity disposition overlay targets a different upstream baseline')
  }
  if (baseline.baselineCommit !== manifest.baselineCommit) {
    throw new Error('Parity row manifest targets a different upstream baseline')
  }

  const rowById = new Map<string, CriticMarkupParityRow>()
  for (const row of manifest.rows) {
    if (!row.id.trim() || rowById.has(row.id)) {
      throw new Error(`Parity row ID is missing or duplicated: ${row.id}`)
    }
    if (!row.upstreamBehavior.trim()) {
      throw new Error(`Parity row ${row.id} requires an upstream behavior`)
    }
    if (!row.existingOracle.trim()) {
      throw new Error(`Parity row ${row.id} requires an existing oracle`)
    }
    if (!row.productionPathTest.trim()) {
      throw new Error(`Parity row ${row.id} requires a production-path test`)
    }
    if (!(['planned', 'red', 'green'] as const).includes(row.status)) {
      throw new Error(`Parity row ${row.id} has invalid status ${String(row.status)}`)
    }
    if (row.execution != null) {
      const executionKeys = Object.keys(row.execution).sort()
      const expectedExecutionKeys = [
        'buildCommit',
        'recordPath',
        'recordSha256',
        'sourcePath',
        'sourceSha256'
      ]
      if (
        executionKeys.length !== expectedExecutionKeys.length ||
        executionKeys.some((key, index) => key !== expectedExecutionKeys[index]) ||
        typeof row.execution.buildCommit !== 'string' ||
        !/^[0-9a-f]{40}$/u.test(row.execution.buildCommit) ||
        typeof row.execution.sourcePath !== 'string' ||
        !row.execution.sourcePath.trim() ||
        typeof row.execution.sourceSha256 !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(row.execution.sourceSha256) ||
        typeof row.execution.recordPath !== 'string' ||
        !row.execution.recordPath.trim() ||
        typeof row.execution.recordSha256 !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(row.execution.recordSha256)
      ) {
        throw new Error(`Parity row ${row.id} execution evidence is invalid`)
      }
    }
    rowById.set(row.id, row)
  }

  const itemIds = new Set(baseline.items.map(entry => entry.id))
  const dispositionIds = Object.keys(overlay.dispositions)
  const stale = dispositionIds.filter(id => !itemIds.has(id))
  if (stale.length > 0) {
    throw new Error(`${stale.length} stale parity disposition${stale.length === 1 ? '' : 's'}`)
  }

  const undisposed = baseline.items.filter(entry => !overlay.dispositions[entry.id])
  if (undisposed.length > 0) {
    throw new Error(`${undisposed.length} upstream parity items are undisposed`)
  }

  const referencedRows = new Set<string>()
  for (const [id, disposition] of Object.entries(overlay.dispositions)) {
    if (!(['parity-row', 'unaffected', 'approved-decision'] as const).includes(disposition.kind)) {
      throw new Error(`Parity disposition ${id} has invalid kind ${String(disposition.kind)}`)
    }
    if (disposition.kind === 'unaffected' && !disposition.rationale?.trim()) {
      throw new Error(`Unaffected parity disposition ${id} requires a rationale`)
    }
    if (disposition.kind !== 'unaffected' && !disposition.ref?.trim()) {
      throw new Error(`Parity disposition ${id} requires a reference`)
    }
    if (
      disposition.kind === 'parity-row' &&
      !rowById.has(disposition.ref ?? '')
    ) {
      throw new Error(`Parity disposition ${id} has unresolved parity row ${disposition.ref}`)
    }
    if (disposition.kind === 'parity-row') referencedRows.add(disposition.ref ?? '')
  }

  for (const rowId of rowById.keys()) {
    if (!referencedRows.has(rowId)) {
      throw new Error(`Parity row ${rowId} is not referenced by an upstream item`)
    }
  }
}

export const requireGreenCriticMarkupParityDispositions = (
  baselineArtifact: unknown,
  overlayArtifact: unknown,
  manifestArtifact: unknown,
  repoRoot?: string,
  rowManifestPath?: string
): void => {
  validateCriticMarkupParityDispositions(
    baselineArtifact,
    overlayArtifact,
    manifestArtifact
  )
  const baseline = baselineArtifact as CriticMarkupParityBaseline
  const manifest = manifestArtifact as CriticMarkupParityRowManifest
  const planned = manifest.rows
    .filter(row => row.status === 'planned')
    .map(row => row.id)
    .sort()
  const red = manifest.rows
    .filter(row => row.status === 'red')
    .map(row => row.id)
    .sort()
  const placeholderOracles = manifest.rows
    .filter(row => (
      row.productionPathTest.startsWith('required-new-production-path-test:') ||
      row.productionPathTest.includes('execution pending') ||
      row.productionPathTest.includes('release-execution-pending')
    ))
    .map(row => row.id)
    .sort()
  const unauthenticatedGreen = manifest.rows
    .filter(row => row.status === 'green' && row.execution == null)
    .map(row => row.id)
    .sort()
  const failures: string[] = []
  if (planned.length > 0) {
    failures.push(
      `${planned.length} planned row${planned.length === 1 ? '' : 's'} ` +
      `[${planned.join(', ')}]`
    )
  }
  if (red.length > 0) {
    failures.push(
      `${red.length} red row${red.length === 1 ? '' : 's'} ` +
      `[${red.join(', ')}]`
    )
  }
  if (placeholderOracles.length > 0) {
    failures.push(
      `${placeholderOracles.length} placeholder production-path ` +
      `test${placeholderOracles.length === 1 ? '' : 's'} ` +
      `[${placeholderOracles.join(', ')}]`
    )
  }
  if (unauthenticatedGreen.length > 0) {
    failures.push(
      `${unauthenticatedGreen.length} green ` +
      `row${unauthenticatedGreen.length === 1 ? '' : 's'} ` +
      `${unauthenticatedGreen.length === 1 ? 'lacks' : 'lack'} authenticated ` +
      `execution evidence [${unauthenticatedGreen.join(', ')}]`
    )
  }
  if (failures.length > 0) {
    throw new Error(
      `CriticMarkup parity completion is not green: ${failures.join('; ')}`
    )
  }
  if (repoRoot === undefined) {
    if (manifest.rows.some(row => row.status === 'green' && row.execution != null)) {
      throw new Error(
        'CriticMarkup parity completion cannot authenticate green execution ' +
        'evidence without a repository root'
      )
    }
    return
  }
  if (rowManifestPath === undefined) {
    throw new Error(
      'CriticMarkup parity completion cannot authenticate green execution ' +
      'evidence without a canonical row manifest'
    )
  }
  let recordedManifest: string
  try {
    recordedManifest = readFileSync(repositoryPath(
      repoRoot,
      rowManifestPath,
      'CriticMarkup parity row manifest'
    ), 'utf8')
  } catch (error) {
    if (error instanceof Error && error.message.includes('escapes the repository')) {
      throw error
    }
    throw new Error('CriticMarkup parity row manifest is missing')
  }
  if (recordedManifest !== canonicalParityRowManifest(manifest, true)) {
    throw new Error(
      'CriticMarkup parity row manifest is not canonical or does not match ' +
      'the validated artifact'
    )
  }
  const rowManifestSha256 = createHash('sha256')
    .update(canonicalParityRowManifest(manifest, false))
    .digest('hex')
  for (const row of manifest.rows.filter(row => row.status === 'green')) {
    const execution = row.execution as CriticMarkupParityExecutionEvidence
    let record: Buffer
    try {
      record = readFileSync(repositoryPath(
        repoRoot,
        execution.recordPath,
        `Parity row ${row.id} execution record`
      ))
    } catch (error) {
      if (error instanceof Error && error.message.includes('escapes the repository')) {
        throw error
      }
      throw new Error(`Parity row ${row.id} execution record is missing`)
    }
    if (createHash('sha256').update(record).digest('hex') !== execution.recordSha256) {
      throw new Error(`Parity row ${row.id} execution record digest does not match`)
    }
    let runRecord: unknown
    try {
      runRecord = JSON.parse(record.toString('utf8')) as unknown
    } catch {
      throw new Error(`Parity row ${row.id} execution record is invalid`)
    }
    const runRecordKeys = typeof runRecord === 'object' && runRecord !== null
      ? Object.keys(runRecord).sort()
      : []
    const expectedRunRecordKeys = [
      'baselineCommit',
      'buildCommit',
      'recordedAt',
      'result',
      'rowIds',
      'rowManifestSha256',
      'schema'
    ]
    const candidate = runRecord as Partial<CriticMarkupParityExecutionRunRecord>
    if (
      runRecordKeys.length !== expectedRunRecordKeys.length ||
      runRecordKeys.some((key, index) => key !== expectedRunRecordKeys[index]) ||
      candidate.schema !== 'marktext-criticmarkup-parity-execution-v1' ||
      typeof candidate.baselineCommit !== 'string' ||
      !/^[0-9a-f]{40}$/u.test(candidate.baselineCommit) ||
      typeof candidate.rowManifestSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(candidate.rowManifestSha256) ||
      typeof candidate.buildCommit !== 'string' ||
      !/^[0-9a-f]{40}$/u.test(candidate.buildCommit) ||
      typeof candidate.recordedAt !== 'string' ||
      Number.isNaN(Date.parse(candidate.recordedAt)) ||
      (candidate.result !== 'pass' && candidate.result !== 'fail') ||
      !Array.isArray(candidate.rowIds) ||
      candidate.rowIds.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(candidate.rowIds).size !== candidate.rowIds.length
    ) {
      throw new Error(`Parity row ${row.id} execution record is invalid`)
    }
    if (
      candidate.buildCommit !== execution.buildCommit ||
      candidate.result !== 'pass' ||
      !candidate.rowIds.includes(row.id)
    ) {
      throw new Error(
        `Parity row ${row.id} execution record does not prove a passing execution`
      )
    }
    if (candidate.baselineCommit !== baseline.baselineCommit) {
      throw new Error(
        `Parity row ${row.id} execution record targets a stale baseline`
      )
    }
    if (candidate.rowManifestSha256 !== rowManifestSha256) {
      throw new Error(
        `Parity row ${row.id} execution record targets a stale row manifest`
      )
    }
    const sourcePath = relative(
      repoRoot,
      repositoryPath(
        repoRoot,
        execution.sourcePath,
        `Parity row ${row.id} test source`
      )
    ).split(sep).join('/')
    if (!row.productionPathTest.includes(execution.sourcePath)) {
      throw new Error(
        `Parity row ${row.id} execution source is not named by its production-path test`
      )
    }
    let source: Buffer
    try {
      source = execFileSync(
        'git',
        ['show', `${execution.buildCommit}:${sourcePath}`],
        { cwd: repoRoot }
      )
    } catch {
      throw new Error(`Parity row ${row.id} test source is missing at build commit`)
    }
    if (createHash('sha256').update(source).digest('hex') !== execution.sourceSha256) {
      throw new Error(`Parity row ${row.id} test source digest does not match build commit`)
    }
  }
}

const readBaseline = (path: string): CriticMarkupParityBaseline =>
  requireArtifactSchema<CriticMarkupParityBaseline>(
    JSON.parse(readFileSync(path, 'utf8')),
    'marktext-criticmarkup-parity-baseline-v1',
    'CriticMarkup parity baseline schema is invalid'
  )

const readDispositionOverlay = (path: string): CriticMarkupParityDispositionOverlay =>
  requireArtifactSchema<CriticMarkupParityDispositionOverlay>(
    JSON.parse(readFileSync(path, 'utf8')),
    'marktext-criticmarkup-parity-dispositions-v1',
    'Parity disposition overlay schema is invalid'
  )

const readParityRowManifest = (path: string): CriticMarkupParityRowManifest =>
  requireArtifactSchema<CriticMarkupParityRowManifest>(
    JSON.parse(readFileSync(path, 'utf8')),
    'marktext-criticmarkup-parity-rows-v1',
    'Parity row manifest schema is invalid'
  )

const writeBaseline = (
  repoRoot: string,
  path: string,
  baselineCommit: string
): void => {
  const generated = collectCriticMarkupParityBaseline(repoRoot, baselineCommit)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(generated, null, 2)}\n`)
}

const checkBaseline = (repoRoot: string, path: string): CriticMarkupParityBaseline => {
  const recorded = readBaseline(path)
  const generated = collectCriticMarkupParityBaseline(repoRoot, recorded.baselineCommit)
  if (JSON.stringify(recorded) !== JSON.stringify(generated)) {
    throw new Error('CriticMarkup parity baseline is stale; regenerate it')
  }
  return recorded
}

const runCli = (): void => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const path = resolve(repoRoot, 'specs/baselines/criticmarkup-upstream-parity.json')
  const overlayPath = resolve(repoRoot, 'specs/baselines/criticmarkup-parity-dispositions.json')
  const rowManifestPath = resolve(repoRoot, 'specs/baselines/criticmarkup-parity-rows.json')
  const [command, baselineCommit] = process.argv.slice(2)

  if (command === '--write' && baselineCommit) {
    writeBaseline(repoRoot, path, baselineCommit)
    return
  }
  if (command === '--check') {
    checkBaseline(repoRoot, path)
    return
  }
  if (command === '--validate') {
    validateCriticMarkupParityDispositions(
      checkBaseline(repoRoot, path),
      readDispositionOverlay(overlayPath),
      readParityRowManifest(rowManifestPath)
    )
    return
  }
  if (command === '--require-green') {
    requireGreenCriticMarkupParityDispositions(
      checkBaseline(repoRoot, path),
      readDispositionOverlay(overlayPath),
      readParityRowManifest(rowManifestPath),
      repoRoot,
      rowManifestPath
    )
    return
  }
  throw new Error(
    'Usage: tsx scripts/criticmarkupParityBaseline.ts ' +
    '--write <baseline-commit> | --check | --validate | --require-green'
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}

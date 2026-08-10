import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
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
  baseline: CriticMarkupParityBaseline,
  overlay: CriticMarkupParityDispositionOverlay
): void => {
  if (baseline.baselineCommit !== overlay.baselineCommit) {
    throw new Error('Parity disposition overlay targets a different upstream baseline')
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

  for (const [id, disposition] of Object.entries(overlay.dispositions)) {
    if (disposition.kind === 'unaffected' && !disposition.rationale?.trim()) {
      throw new Error(`Unaffected parity disposition ${id} requires a rationale`)
    }
    if (disposition.kind !== 'unaffected' && !disposition.ref?.trim()) {
      throw new Error(`Parity disposition ${id} requires a reference`)
    }
  }
}

const readBaseline = (path: string): CriticMarkupParityBaseline =>
  JSON.parse(readFileSync(path, 'utf8')) as CriticMarkupParityBaseline

const readDispositionOverlay = (path: string): CriticMarkupParityDispositionOverlay =>
  JSON.parse(readFileSync(path, 'utf8')) as CriticMarkupParityDispositionOverlay

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
      readDispositionOverlay(overlayPath)
    )
    return
  }
  throw new Error('Usage: tsx scripts/criticmarkupParityBaseline.ts --write <baseline-commit> | --check | --validate')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}

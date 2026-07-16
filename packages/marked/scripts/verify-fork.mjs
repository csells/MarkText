#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_FORK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPOSITORY_ROOT = resolve(SCRIPT_FORK_ROOT, '../..')
const MANIFEST_NAME = 'FORK_MANIFEST.json'
const REVIEWED_UPSTREAM = Object.freeze({
  repository: 'https://github.com/markedjs/marked.git',
  tag: 'v18.0.5',
  commit: '4063c638cb621c09091d41b26f323ff074416bb9',
  rootTree: '560c79fb2d4974f82d07a80e4920a39adfbe4a0c',
  sourceTree: '9041f66b4ef9752f787d4f9ef8f9175c847b32a4',
  licenseBlob: '4bd2d4a084987ab634893a29f72ff6d1a67bf658',
  packageJsonBlob: '4527f223c5196c8b8db037d2c6f29f4b303c7d71',
})

function fail (message) {
  throw new Error(`Marked fork contract violation: ${message}`)
}

function assert (condition, message) {
  if (!condition) {
    fail(message)
  }
}

function readJson (path, label) {
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return value
}

function normalizedRelative (root, path) {
  return relative(root, path).split(sep).join('/')
}

function listFiles (root, directory = root) {
  const result = []
  const entries = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      fail(`fork surface contains a symbolic link: ${normalizedRelative(root, path)}`)
    }
    if (entry.isDirectory()) {
      result.push(...listFiles(root, path))
    } else if (entry.isFile()) {
      result.push(normalizedRelative(root, path))
    } else {
      fail(`fork surface contains an unsupported filesystem entry: ${normalizedRelative(root, path)}`)
    }
  }
  return result.sort()
}

function sortedUniqueStrings (value, label) {
  assert(Array.isArray(value), `${label} must be an array.`)
  assert(value.every(item => typeof item === 'string' && item.length), `${label} must contain non-empty strings.`)
  for (const path of value) {
    assert(
      !isAbsolute(path) &&
      normalize(path).split(sep).join('/') === path &&
      path !== '..' &&
      !path.startsWith('../'),
      `${label} contains an unsafe or non-canonical path: ${path}`
    )
  }
  const sorted = [...value].sort()
  assert(new Set(sorted).size === sorted.length, `${label} contains a duplicate path.`)
  assert(JSON.stringify(value) === JSON.stringify(sorted), `${label} must be sorted.`)
  return sorted
}

function assertSameList (actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} differs.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`)
  }
}

function runGit (args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr).trim()
      : ''
    fail(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : '.'}`)
  }
}

function gitBlob (path) {
  return runGit(['hash-object', '--', path], dirname(path))
}

function gitTree (directory) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'marktext-marked-tree-'))
  const worktree = join(temporaryRoot, 'tree')
  try {
    cpSync(directory, worktree, { recursive: true })
    runGit(['init', '--quiet'], worktree)
    runGit([
      '-c',
      'core.autocrlf=false',
      '-c',
      'core.safecrlf=false',
      '-c',
      'core.excludesFile=/dev/null',
      'add',
      '--all',
      '--',
      '.',
    ], worktree)
    return runGit(['write-tree'], worktree)
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true })
  }
}

function copySurface (sourceRoot, destinationRoot, paths) {
  for (const path of paths) {
    const source = join(sourceRoot, path)
    assert(existsSync(source), `manifest surface path is missing: ${path}`)
    const destination = join(destinationRoot, path)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(source, destination)
  }
}

function fileBytesEqual (left, right) {
  return readFileSync(left).equals(readFileSync(right))
}

function validateIdentifier (value, label) {
  assert(typeof value === 'string' && /^[0-9a-f]{40}$/.test(value), `${label} must be a 40-character lowercase Git object id.`)
}

function validateManifest (manifest) {
  assert(manifest && typeof manifest === 'object', 'manifest must be an object.')
  assert(manifest.schemaVersion === 1, 'manifest schemaVersion must be 1.')
  assert(manifest.upstream && typeof manifest.upstream === 'object', 'manifest upstream contract is missing.')
  assert(manifest.fork && typeof manifest.fork === 'object', 'manifest fork contract is missing.')
  assert(manifest.consumers && typeof manifest.consumers === 'object', 'manifest consumer contract is missing.')

  for (const property of Object.keys(REVIEWED_UPSTREAM)) {
    assert(
      manifest.upstream[property] === REVIEWED_UPSTREAM[property],
      `upstream.${property} differs from the reviewed source.`
    )
  }
  for (const property of ['commit', 'rootTree', 'sourceTree', 'licenseBlob', 'packageJsonBlob']) {
    validateIdentifier(manifest.upstream[property], `upstream.${property}`)
  }

  assert(typeof manifest.fork.version === 'string' && manifest.fork.version.length, 'fork version is missing.')
  assert(typeof manifest.fork.canonicalPatch === 'string' && manifest.fork.canonicalPatch.length, 'canonical patch path is missing.')
  assert(manifest.fork.canonicalPatch === `patches/v${manifest.fork.version}.patch`, 'canonical patch filename must carry the exact fork version.')
  const files = sortedUniqueStrings(manifest.fork.files, 'fork.files')
  const modified = sortedUniqueStrings(manifest.fork.surface?.modified, 'fork.surface.modified')
  const added = sortedUniqueStrings(manifest.fork.surface?.added, 'fork.surface.added')
  const unchanged = sortedUniqueStrings(manifest.fork.surface?.unchanged, 'fork.surface.unchanged')
  const surface = [...modified, ...added, ...unchanged].sort()
  assert(new Set(surface).size === surface.length, 'fork surface classifications overlap.')
  for (const path of surface) {
    assert(files.includes(path), `fork surface path is absent from fork.files: ${path}`)
  }
  assert(files.includes(MANIFEST_NAME), `fork.files must include ${MANIFEST_NAME}.`)
  assert(files.includes(manifest.fork.canonicalPatch), 'fork.files must include the canonical patch.')
  assert(files.includes('scripts/verify-fork.mjs'), 'fork.files must include the verifier.')

  assert(manifest.consumers.muyaMarkedSpecifier === 'workspace:*', 'Muya marked dependency contract must use workspace:*.')
  assert(manifest.consumers.commonmarkSpecVersion === '0.31.2', 'CommonMark fixture contract must pin 0.31.2.')
  return { added, files, modified, surface, unchanged }
}

function validatePackageContract (forkRoot, manifest) {
  const packageJson = readJson(join(forkRoot, 'package.json'), 'fork package.json')
  assert(packageJson.name === 'marked', 'fork package name must be marked.')
  assert(packageJson.version === manifest.fork.version, `fork package version ${String(packageJson.version)} differs from manifest version ${manifest.fork.version}.`)
  assert(packageJson.private === true, 'fork package must remain private.')
  assert(packageJson.type === 'module', 'fork package must remain an ES module.')
  assert(packageJson.license === 'MIT', 'fork package must declare its preserved MIT license.')
  assert(packageJson.repository?.type === 'git', 'fork package repository type must be git.')
  assert(packageJson.repository?.url === manifest.upstream.repository, 'fork package repository URL differs from the upstream contract.')
  assert(packageJson.types === './src/marked.ts', 'fork package types entry differs.')
  assert(packageJson.exports?.['.']?.types === './src/marked.ts', 'fork package type export differs.')
  assert(packageJson.exports?.['.']?.default === './src/marked.ts', 'fork package runtime export differs.')
  assert(packageJson.scripts?.['verify:fork'] === 'node scripts/verify-fork.mjs --self-test', 'fork verification script differs.')
}

function yamlBlock (source, header, label) {
  const lines = source.split(/\r?\n/)
  const matches = []
  for (let index = 0; index < lines.length; index++) {
    if (lines[index] === header) {
      matches.push(index)
    }
  }
  assert(matches.length === 1, `${label} must contain exactly one ${header.trim()} block.`)
  const start = matches[0]
  const indentation = /^ */.exec(header)[0].length
  let end = lines.length
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]
    if (!line.trim()) {
      continue
    }
    const nextIndentation = /^ */.exec(line)[0].length
    if (nextIndentation <= indentation) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

function validateConsumerContracts (repositoryRoot, manifest) {
  const muyaPackage = readJson(join(repositoryRoot, 'packages/muya/package.json'), 'Muya package.json')
  assert(muyaPackage.dependencies?.marked === manifest.consumers.muyaMarkedSpecifier, 'Muya does not consume the authenticated workspace fork.')
  assert(muyaPackage.devDependencies?.['commonmark-spec'] === manifest.consumers.commonmarkSpecVersion, 'Muya CommonMark fixture version is not exact.')

  const lockfile = readFileSync(join(repositoryRoot, 'pnpm-lock.yaml'), 'utf8')
  const importers = yamlBlock(lockfile, 'importers:', 'pnpm lockfile')
  const muyaImporter = yamlBlock(
    importers,
    '  packages/muya:',
    'Muya lockfile importer'
  )
  const dependencies = yamlBlock(
    muyaImporter,
    '    dependencies:',
    'Muya lockfile importer dependencies'
  )
  const devDependencies = yamlBlock(
    muyaImporter,
    '    devDependencies:',
    'Muya lockfile importer devDependencies'
  )
  const commonmarkVersion = manifest.consumers.commonmarkSpecVersion.replaceAll('.', '\\.')
  assert(new RegExp(`^      commonmark-spec:\\n        specifier: ${commonmarkVersion}\\n        version: ${commonmarkVersion}$`, 'm').test(devDependencies), 'Muya lockfile importer does not pin the exact CommonMark fixture version.')
  assert(/^      marked:\n        specifier: workspace:\*\n        version: link:\.\.\/marked$/m.test(dependencies), 'Muya lockfile importer does not bind Muya to the workspace Marked fork.')
}

export function verifyMarkedFork ({
  forkRoot = SCRIPT_FORK_ROOT,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  const resolvedForkRoot = resolve(forkRoot)
  const manifest = readJson(join(resolvedForkRoot, MANIFEST_NAME), 'Marked fork manifest')
  const contract = validateManifest(manifest)
  assertSameList(listFiles(resolvedForkRoot), contract.files, 'checked-in fork file inventory')
  validatePackageContract(resolvedForkRoot, manifest)
  validateConsumerContracts(repositoryRoot, manifest)

  const patch = join(resolvedForkRoot, manifest.fork.canonicalPatch)
  const reconstruction = mkdtempSync(join(tmpdir(), 'marktext-marked-upstream-'))
  try {
    copySurface(resolvedForkRoot, reconstruction, contract.surface)
    runGit(['apply', '--reverse', '--check', '--', patch], reconstruction)
    runGit(['apply', '--reverse', '--', patch], reconstruction)

    const reconstructedPaths = listFiles(reconstruction)
    const expectedUpstreamPaths = [...contract.modified, ...contract.unchanged].sort()
    assertSameList(reconstructedPaths, expectedUpstreamPaths, 'reconstructed upstream file inventory')
    assert(gitTree(join(reconstruction, 'src')) === manifest.upstream.sourceTree, 'reconstructed upstream src tree differs from the pinned Git tree.')
    assert(gitBlob(join(reconstruction, 'LICENSE')) === manifest.upstream.licenseBlob, 'reconstructed upstream LICENSE blob differs.')
    assert(gitBlob(join(reconstruction, 'package.json')) === manifest.upstream.packageJsonBlob, 'reconstructed upstream package.json blob differs.')

    const actualModified = []
    const actualUnchanged = []
    for (const path of expectedUpstreamPaths) {
      if (fileBytesEqual(join(reconstruction, path), join(resolvedForkRoot, path))) {
        actualUnchanged.push(path)
      } else {
        actualModified.push(path)
      }
    }
    assertSameList(actualModified.sort(), contract.modified, 'canonical patch modified-file classification')
    assertSameList(actualUnchanged.sort(), contract.unchanged, 'canonical patch unchanged-file classification')

    runGit(['apply', '--check', '--', patch], reconstruction)
    runGit(['apply', '--', patch], reconstruction)
    assertSameList(listFiles(reconstruction), contract.surface, 'forward-applied fork surface inventory')
    for (const path of contract.surface) {
      assert(
        fileBytesEqual(join(reconstruction, path), join(resolvedForkRoot, path)),
        `forward-applied canonical patch differs at ${path}.`
      )
    }
  } finally {
    rmSync(reconstruction, { force: true, recursive: true })
  }

  return manifest
}

function expectContractFailure (action, label) {
  try {
    action()
  } catch (error) {
    assert(error instanceof Error && /Marked fork contract violation/.test(error.message), `${label} failed for an unrelated reason.`)
    return
  }
  fail(`${label} was accepted.`)
}

function runSelfTest (forkRoot, repositoryRoot) {
  const temporaryRoots = []
  const copyFork = () => {
    const directory = mkdtempSync(join(tmpdir(), 'marktext-marked-self-test-'))
    temporaryRoots.push(directory)
    const copy = join(directory, 'marked')
    cpSync(forkRoot, copy, { recursive: true })
    return copy
  }
  const copyConsumers = () => {
    const copy = mkdtempSync(join(tmpdir(), 'marktext-marked-consumers-'))
    temporaryRoots.push(copy)
    mkdirSync(join(copy, 'packages/muya'), { recursive: true })
    cpSync(
      join(repositoryRoot, 'packages/muya/package.json'),
      join(copy, 'packages/muya/package.json')
    )
    cpSync(
      join(repositoryRoot, 'pnpm-lock.yaml'),
      join(copy, 'pnpm-lock.yaml')
    )
    return copy
  }

  try {
    const sourceDrift = copyFork()
    appendFileSync(join(sourceDrift, 'src/rules.ts'), '\n// verifier self-test drift\n')
    expectContractFailure(
      () => verifyMarkedFork({ forkRoot: sourceDrift, repositoryRoot }),
      'unrecorded source drift'
    )

    const versionDrift = copyFork()
    const packagePath = join(versionDrift, 'package.json')
    const packageJson = readJson(packagePath, 'self-test package.json')
    packageJson.version = '18.0.5-marktext.999'
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    expectContractFailure(
      () => verifyMarkedFork({ forkRoot: versionDrift, repositoryRoot }),
      'package-version drift'
    )

    const consumerDrift = copyConsumers()
    const lockPath = join(consumerDrift, 'pnpm-lock.yaml')
    const lockfile = readFileSync(lockPath, 'utf8')
    const importers = yamlBlock(lockfile, 'importers:', 'self-test lockfile')
    const muyaImporter = yamlBlock(
      importers,
      '  packages/muya:',
      'self-test Muya importer'
    )
    const corruptedImporter = muyaImporter
      .replace(
        '      marked:\n        specifier: workspace:*\n        version: link:../marked',
        '      marked:\n        specifier: 18.0.5\n        version: 18.0.5'
      )
      .replace(
        '      commonmark-spec:\n        specifier: 0.31.2\n        version: 0.31.2',
        '      commonmark-spec:\n        specifier: 0.31.1\n        version: 0.31.1'
      )
    assert(corruptedImporter !== muyaImporter, 'consumer-drift self-test did not change the Muya importer.')
    const decoyImporter = [
      '  packages/verifier-decoy:',
      '    dependencies:',
      '      marked:',
      '        specifier: workspace:*',
      '        version: link:../marked',
      '    devDependencies:',
      '      commonmark-spec:',
      '        specifier: 0.31.2',
      '        version: 0.31.2',
    ].join('\n')
    const corruptedImporters = `${importers.trimEnd()}\n\n${decoyImporter}\n`
      .replace(muyaImporter, corruptedImporter)
    writeFileSync(lockPath, lockfile.replace(importers, corruptedImporters))
    expectContractFailure(
      () => verifyMarkedFork({ forkRoot, repositoryRoot: consumerDrift }),
      'decoy consumer importer drift'
    )

    const manifestDrift = copyFork()
    const manifestPath = join(manifestDrift, MANIFEST_NAME)
    const manifest = readJson(manifestPath, 'self-test manifest')
    const [reclassified, ...remainingModified] = manifest.fork.surface.modified
    assert(reclassified, 'manifest-drift self-test found no modified surface file.')
    manifest.fork.surface.modified = remainingModified
    manifest.fork.surface.unchanged = [
      ...manifest.fork.surface.unchanged,
      reclassified,
    ].sort()
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    expectContractFailure(
      () => verifyMarkedFork({ forkRoot: manifestDrift, repositoryRoot }),
      'manifest reclassification drift'
    )

    const patchDrift = copyFork()
    const patchManifest = readJson(join(patchDrift, MANIFEST_NAME), 'self-test manifest')
    const patchPath = join(patchDrift, patchManifest.fork.canonicalPatch)
    const patchLines = readFileSync(patchPath, 'utf8').split('\n')
    const additionIndex = patchLines.findIndex(line =>
      line.startsWith('+') && !line.startsWith('+++'))
    assert(additionIndex > 0, 'patch-drift self-test found no addition line to corrupt.')
    patchLines[additionIndex] = `${patchLines[additionIndex]} /* self-test drift */`
    writeFileSync(patchPath, patchLines.join('\n'))
    expectContractFailure(
      () => verifyMarkedFork({ forkRoot: patchDrift, repositoryRoot }),
      'canonical patch drift'
    )
  } finally {
    for (const directory of temporaryRoots) {
      rmSync(directory, { force: true, recursive: true })
    }
  }
}

function parseArguments (args) {
  let forkRoot = SCRIPT_FORK_ROOT
  let repositoryRoot = REPOSITORY_ROOT
  let selfTest = false
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--self-test') {
      selfTest = true
    } else if (argument === '--fork-root') {
      const value = args[++index]
      assert(value, '--fork-root requires a path.')
      forkRoot = resolve(value)
    } else if (argument === '--repository-root') {
      const value = args[++index]
      assert(value, '--repository-root requires a path.')
      repositoryRoot = resolve(value)
    } else {
      fail(`unknown argument: ${argument}`)
    }
  }
  return { forkRoot, repositoryRoot, selfTest }
}

function main () {
  const { forkRoot, repositoryRoot, selfTest } = parseArguments(process.argv.slice(2))
  verifyMarkedFork({ forkRoot, repositoryRoot })
  console.log('Marked fork contract: PASS')
  if (selfTest) {
    runSelfTest(forkRoot, repositoryRoot)
    console.log('Marked fork contract self-test: PASS')
  }
}

try {
  main()
} catch (error) {
  console.error('Marked fork contract: FAIL')
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
}

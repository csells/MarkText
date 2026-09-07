import { spawnSync } from 'node:child_process'
import {
  existsSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

interface PackageManifest {
  name: string
  main?: string
  module?: string
  types?: string
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
  publishConfig?: {
    main?: string
    module?: string
    types?: string
    exports?: Record<string, unknown>
  }
}

export interface MuyaPackedTypeScriptConsumerEvidence {
  packageName: string
  typesEntry: string
  exportsTypesEntry: string
  consumerDependencies: string[]
  consumerDeclaredAtTypesDependencies: string[]
  importedPublicSymbols: string[]
  compilerCommand: 'tsc --noEmit'
}

const run = (
  command: string,
  args: string[],
  cwd: string
): string => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with status ${result.status}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n'))
  }
  return result.stdout
}

const readJson = <Value>(path: string): Value => JSON.parse(
  readFileSync(path, 'utf8')
) as Value

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const resolvePinnedPnpm = (repoRoot: string): string => {
  const rootManifest = readJson<{ packageManager?: string }>(resolve(repoRoot, 'package.json'))
  const match = rootManifest.packageManager?.match(/^pnpm@(\d+\.\d+\.\d+)$/)
  if (!match?.[1]) throw new Error('Repository packageManager must pin an exact pnpm version')
  const pnpm = resolve(
    repoRoot,
    'node_modules/.cache/corepack/v1/pnpm',
    match[1],
    'bin/pnpm.cjs'
  )
  if (!existsSync(pnpm)) {
    throw new Error(`Pinned pnpm ${match[1]} is unavailable from the repository Corepack cache`)
  }
  return pnpm
}

export const verifyMuyaPackedTypeScriptConsumer = async(
  repoRoot: string
): Promise<MuyaPackedTypeScriptConsumerEvidence> => {
  const muyaRoot = resolve(repoRoot, 'packages/muya')
  const sourceManifest = readJson<PackageManifest>(resolve(muyaRoot, 'package.json'))
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'marktext-muya-package-'))
  const pnpm = resolvePinnedPnpm(repoRoot)
  const require = createRequire(resolve(muyaRoot, 'package.json'))
  const compiler = require.resolve('typescript/bin/tsc')
  const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js')

  try {
    const buildRoot = resolve(temporaryRoot, 'muya')
    cpSync(muyaRoot, buildRoot, {
      recursive: true,
      filter: source => !['lib', 'node_modules', '.git'].some(name => (
        source === resolve(muyaRoot, name)
      ))
    })
    symlinkSync(resolve(muyaRoot, 'node_modules'), resolve(buildRoot, 'node_modules'), 'junction')
    // Packaging may read the workspace bundle concurrently; this consumer owns only its scratch build.
    // pnpm's relative .bin shims cannot be relocated through the scratch
    // node_modules symlink. Run the same build entrypoints from their real
    // installation while keeping every generated file in the scratch build.
    run(process.execPath, [compiler], buildRoot)
    run(process.execPath, [vite, 'build'], buildRoot)

    const packRoot = resolve(temporaryRoot, 'packed')
    mkdirSync(packRoot, { recursive: true })
    run(process.execPath, [
      pnpm,
      'pack',
      '--pack-destination',
      packRoot
    ], buildRoot)
    const tarballs = readdirSync(packRoot).filter(name => name.endsWith('.tgz'))
    const filename = tarballs[0]
    if (!filename || tarballs.length !== 1) {
      throw new Error('pnpm pack did not produce exactly one Muya tarball')
    }

    const tarball = resolve(packRoot, filename)
    const extractionRoot = resolve(temporaryRoot, 'extracted')
    mkdirSync(extractionRoot, { recursive: true })
    run('tar', ['-xzf', tarball, '-C', extractionRoot], repoRoot)
    const packageRoot = resolve(extractionRoot, 'package')
    const packedManifest = readJson<PackageManifest>(resolve(packageRoot, 'package.json'))
    const typesEntry = packedManifest.types
    const rootExport = packedManifest.exports?.['.'] as Record<string, unknown> | undefined
    const exportsTypesEntry = rootExport?.types
    if (typeof typesEntry !== 'string' || typeof exportsTypesEntry !== 'string') {
      throw new Error('Packed Muya manifest does not expose public declaration entrypoints')
    }
    if (!existsSync(resolve(packageRoot, typesEntry))) {
      throw new Error(`Packed Muya declaration entrypoint is missing: ${typesEntry}`)
    }

    const consumerRoot = resolve(temporaryRoot, 'consumer')
    mkdirSync(consumerRoot, { recursive: true })
    const consumerManifest = {
      name: 'marktext-muya-types-consumer',
      private: true,
      type: 'module',
      dependencies: { [sourceManifest.name]: `file:${tarball}` }
    }
    writeJson(resolve(consumerRoot, 'package.json'), consumerManifest)
    writeJson(resolve(consumerRoot, 'tsconfig.json'), {
      compilerOptions: {
        target: 'ES2020',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        types: []
      },
      include: ['index.ts']
    })
    const importedPublicSymbols = ['IMuyaOptions', 'MarkdownToHtml', 'Muya', 'TState']
    writeFileSync(resolve(consumerRoot, 'index.ts'), [
      "import { MarkdownToHtml, Muya } from '@muyajs/core'",
      "import type { IMuyaOptions, TState } from '@muyajs/core'",
      '',
      'declare const options: IMuyaOptions',
      'declare const state: TState',
      'void [MarkdownToHtml, Muya, options, state]',
      ''
    ].join('\n'), 'utf8')

    run(process.execPath, [
      pnpm,
      'install',
      '--prefer-offline',
      '--ignore-scripts',
      '--no-frozen-lockfile'
    ], consumerRoot)
    run(process.execPath, [
      compiler,
      '--noEmit',
      '--project',
      resolve(consumerRoot, 'tsconfig.json')
    ], consumerRoot)

    const consumerDependencies = Object.keys(consumerManifest.dependencies).sort()
    return {
      packageName: packedManifest.name,
      typesEntry,
      exportsTypesEntry,
      consumerDependencies,
      consumerDeclaredAtTypesDependencies: consumerDependencies.filter(name => (
        name.startsWith('@types/')
      )),
      importedPublicSymbols,
      compilerCommand: 'tsc --noEmit'
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

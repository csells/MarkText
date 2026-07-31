import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const rootManifest = JSON.parse(
  readFileSync(resolve(PACKAGE_DIRECTORY, '../..', 'package.json'), 'utf8')
) as { readonly packageManager?: unknown }
if (
  typeof rootManifest.packageManager !== 'string' ||
  !rootManifest.packageManager.startsWith('pnpm@')
) {
  throw new Error('The repository must pin pnpm in its packageManager field')
}
const PNPM_PACKAGE_SPEC = rootManifest.packageManager
const TSC_COMMAND = join(
  PACKAGE_DIRECTORY,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
)

interface CommandResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

const run = (command: string, arguments_: readonly string[], cwd: string): CommandResult =>
  spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    }
  })

const runPnpm = (arguments_: readonly string[], cwd: string): CommandResult => {
  const direct = run(PNPM_COMMAND, arguments_, cwd)
  if (direct.status !== null) {
    return direct
  }

  return run(
    NPM_COMMAND,
    ['exec', '--yes', `--package=${PNPM_PACKAGE_SPEC}`, '--', 'pnpm', ...arguments_],
    cwd
  )
}

const expectSuccess = (result: CommandResult, operation: string): void => {
  expect(
    result.status,
    `${operation} failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  ).toBe(0)
}

describe('packed package consumer boundary', () => {
  it('builds from a clean package and exposes only the public root seam', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'marktext-document-core-boundary-'))

    try {
      const isolatedPackage = join(temporaryRoot, 'package')
      const artifactDirectory = join(temporaryRoot, 'artifacts')
      const consumerDirectory = join(temporaryRoot, 'consumer')
      mkdirSync(isolatedPackage)
      mkdirSync(artifactDirectory)
      mkdirSync(consumerDirectory)

      for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json']) {
        cpSync(join(PACKAGE_DIRECTORY, file), join(isolatedPackage, file))
      }
      cpSync(join(PACKAGE_DIRECTORY, 'src'), join(isolatedPackage, 'src'), {
        recursive: true
      })
      const installBuildToolchain = runPnpm(
        ['install', '--ignore-scripts', '--frozen-lockfile=false'],
        isolatedPackage
      )
      expectSuccess(
        installBuildToolchain,
        'clean package build-toolchain install'
      )
      const staleInternalDirectory = join(isolatedPackage, 'dist', 'internal')
      mkdirSync(staleInternalDirectory, { recursive: true })
      writeFileSync(
        join(staleInternalDirectory, 'additionParser.js'),
        "throw new Error('stale Addition-only parser was packaged')\n"
      )
      const pack = runPnpm(['pack', '--pack-destination', artifactDirectory], isolatedPackage)
      expectSuccess(pack, 'clean package pack')

      const tarballName = pack.stdout.trim().split(/\r?\n/u).at(-1)
      expect(tarballName).toBeTruthy()
      if (tarballName === undefined || tarballName.length === 0) {
        throw new Error('npm pack did not report a tarball')
      }
      const tarball = isAbsolute(tarballName) ? tarballName : join(artifactDirectory, tarballName)

      writeFileSync(
        join(consumerDirectory, 'package.json'),
        JSON.stringify({ private: true, type: 'module' })
      )
      const install = run(
        NPM_COMMAND,
        ['install', '--ignore-scripts', '--package-lock=false', '--omit=dev', tarball],
        consumerDirectory
      )
      expectSuccess(install, 'packed package install')
      expect(
        existsSync(
          join(
            consumerDirectory,
            'node_modules',
            '@marktext',
            'document-core',
            'dist',
            'internal',
            'additionParser.js'
          )
        )
      ).toBe(false)

      const publicRuntimeImport = run(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          [
            "const core = await import('@marktext/document-core')",
            "const snapshot = core.createSourceSnapshot('exact\\r\\nsource')",
            "if (snapshot.text !== 'exact\\r\\nsource') throw new Error('source changed')"
          ].join(';')
        ],
        consumerDirectory
      )
      expectSuccess(publicRuntimeImport, 'public runtime import')

      const consumerSource = join(consumerDirectory, 'consumer.ts')
      writeFileSync(
        consumerSource,
        [
          'import {',
          '  createLanguageEngine,',
          '  createSourceSnapshot,',
          '  type DocumentRevision,',
          '  type ParseConfiguration',
          "} from '@marktext/document-core'",
          'const configuration: ParseConfiguration = {',
          "  criticMarkupProfile: 'marktext-profile-1',",
          "  markdownProfile: 'markdown-profile-1',",
          '  markdownOptions: {',
          "    schema: 'markdown-options-1',",
          '    gfm: true,',
          '    frontMatter: true,',
          '    math: true,',
          '    gitLabMath: false,',
          '    footnotes: false,',
          '    subscriptAndSuperscript: true',
          '  },',
          "  liveHtmlSafetyProfile: 'live-html-sanitized-v1',",
          '  executionBudget: {',
          "    limitsProfile: 'desktop-v1',",
          "    accountingSchema: 'syntax-accounting-1'",
          '  }',
          '}',
          'const revision: DocumentRevision = createLanguageEngine().open(',
          "  createSourceSnapshot('{++new++}'),",
          '  configuration',
          ')',
          'void revision'
        ].join('\n')
      )
      const typeConsumer = run(
        TSC_COMMAND,
        [
          '--noEmit',
          '--strict',
          '--target',
          'ES2022',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--lib',
          'ES2022',
          consumerSource
        ],
        consumerDirectory
      )
      expectSuccess(typeConsumer, 'public type import and private type rejection')
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
    // Packing plus two tsc consumer builds is wall-clock work; it runs in
    // the serial wall-clock phase so parallel suite load cannot starve it.
  }, 60_000)
})

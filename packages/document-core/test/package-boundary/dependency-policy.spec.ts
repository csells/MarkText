import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

interface TypeScriptConfiguration {
  readonly compilerOptions?: {
    readonly lib?: readonly string[]
    readonly types?: readonly string[]
  }
}

describe('document-core dependency policy', () => {
  it('forbids product frameworks and DOM authority from the core build', () => {
    const policy = JSON.parse(
      readFileSync(resolve(PACKAGE_DIRECTORY, 'boundary-policy.json'), 'utf8')
    )
    expect(policy).toEqual({
      runtimeDependencies: [],
      ambientLibraries: ['ES2022'],
      forbiddenPackages: ['@muyajs/core', 'marked', 'vue', 'pinia', 'electron']
    })

    const manifest = JSON.parse(
      readFileSync(resolve(PACKAGE_DIRECTORY, 'package.json'), 'utf8')
    ) as PackageManifest
    expect(manifest.dependencies ?? {}).toEqual({})
    expect(manifest.optionalDependencies ?? {}).toEqual({})
    expect(manifest.peerDependencies ?? {}).toEqual({})

    const tsconfig = JSON.parse(
      readFileSync(resolve(PACKAGE_DIRECTORY, 'tsconfig.json'), 'utf8')
    ) as TypeScriptConfiguration
    expect(tsconfig.compilerOptions?.lib).toEqual(policy.ambientLibraries)
    expect(tsconfig.compilerOptions?.types).toEqual([])
  })
})

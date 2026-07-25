import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function sourceFilesUnder(directory: string): readonly string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...sourceFilesUnder(path))
    } else if (entry.name.endsWith('.ts')) {
      files.push(path)
    }
  }
  return files
}

const IMPORT_SPECIFIER_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

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

  it('src imports only relative modules — nothing hoisting could smuggle in', () => {
    // The manifest checks above prove the declared graph is empty, but under
    // the workspace's shamefully-hoist a bare `import ... from 'vue'` or
    // `from 'node:fs'` in src would still resolve, typecheck (test-side
    // @types/node), and pass vitest. The seam is only real if the actual
    // import statements honor it.
    const offenders: string[] = []
    for (const file of sourceFilesUnder(resolve(PACKAGE_DIRECTORY, 'src'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(IMPORT_SPECIFIER_PATTERN)) {
        const specifier = match[1] ?? match[2]
        if (specifier !== undefined && !specifier.startsWith('.')) {
          offenders.push(`${file}: ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

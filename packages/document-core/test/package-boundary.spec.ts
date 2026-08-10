import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

interface BoundaryPolicy {
  readonly runtimeDependencies: readonly string[]
  readonly forbiddenPackages: readonly string[]
}

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? sourceFiles(path)
      : extname(path) === '.ts'
        ? [path]
        : []
  }))

  return files.flat()
}

function importedPackages(source: string, fileName: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const packages: string[] = []

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.moduleSpecifier.text.startsWith('.')
    ) {
      packages.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const specifier = node.arguments[0]
      if (
        specifier !== undefined &&
        ts.isStringLiteral(specifier) &&
        !specifier.text.startsWith('.')
      ) {
        packages.push(specifier.text)
      }
    }
    node.forEachChild(visit)
  }

  visit(sourceFile)

  return packages
}

describe('document-core package boundary', () => {
  it('has no runtime dependencies or forbidden framework imports', async() => {
    const packageRoot = new URL('..', import.meta.url)
    const policy = JSON.parse(await readFile(
      new URL('boundary-policy.json', packageRoot),
      'utf8'
    )) as BoundaryPolicy
    const packageJson = JSON.parse(await readFile(
      new URL('package.json', packageRoot),
      'utf8'
    )) as { readonly dependencies?: Readonly<Record<string, string>> }

    expect(Object.keys(packageJson.dependencies ?? {})).toEqual(policy.runtimeDependencies)

    const importsByFile = await Promise.all(
      (await sourceFiles(fileURLToPath(new URL('src', packageRoot))))
        .map(async file => importedPackages(await readFile(file, 'utf8'), file))
    )
    const resolvedImports = [...new Set(importsByFile.flat())].sort()

    expect(resolvedImports).toEqual([...policy.runtimeDependencies].sort())

    expect(resolvedImports.filter(packageName =>
      policy.forbiddenPackages.some(forbidden =>
        packageName === forbidden || packageName.startsWith(`${forbidden}/`)
      )
    )).toEqual([])
  })
})

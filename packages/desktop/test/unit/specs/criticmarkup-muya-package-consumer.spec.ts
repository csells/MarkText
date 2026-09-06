import { resolve } from 'node:path'
import { statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { verifyMuyaPackedTypeScriptConsumer } from '../../../../../scripts/criticmarkupMuyaPackageConsumer'

const repoRoot = resolve(import.meta.dirname, '../../../../..')

describe('CriticMarkup Muya package publication', () => {
  it('ships self-contained public types to a blank TypeScript consumer', async() => {
    const sharedBundle = resolve(repoRoot, 'packages/muya/lib/cjs/index.js')
    const before = statSync(sharedBundle, { throwIfNoEntry: false })?.mtimeMs
    const evidence = await verifyMuyaPackedTypeScriptConsumer(repoRoot)

    expect(statSync(sharedBundle, { throwIfNoEntry: false })?.mtimeMs,
      'Consumer verification must not rewrite the bundle used by desktop packaging')
      .toBe(before)

    expect(evidence).toEqual({
      packageName: '@muyajs/core',
      typesEntry: './lib/types/index.d.ts',
      exportsTypesEntry: './lib/types/index.d.ts',
      consumerDependencies: ['@muyajs/core'],
      consumerDeclaredAtTypesDependencies: [],
      importedPublicSymbols: ['IMuyaOptions', 'MarkdownToHtml', 'Muya', 'TState'],
      compilerCommand: 'tsc --noEmit'
    })
  }, 120_000)
})

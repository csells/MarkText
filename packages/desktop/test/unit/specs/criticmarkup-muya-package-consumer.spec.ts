import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { verifyMuyaPackedTypeScriptConsumer } from '../../../../../scripts/criticmarkupMuyaPackageConsumer'

const repoRoot = resolve(import.meta.dirname, '../../../../..')

describe('CriticMarkup Muya package publication', () => {
  it('ships self-contained public types to a blank TypeScript consumer', async() => {
    const evidence = await verifyMuyaPackedTypeScriptConsumer(repoRoot)

    expect(evidence).toEqual({
      packageName: '@muyajs/core',
      typesEntry: './lib/types/index.d.ts',
      exportsTypesEntry: './lib/types/index.d.ts',
      consumerDependencies: ['@muyajs/core'],
      consumerAtTypesDependencies: [],
      importedPublicSymbols: ['IMuyaOptions', 'MarkdownToHtml', 'Muya', 'TState'],
      compilerCommand: 'tsc --noEmit'
    })
  }, 120_000)
})

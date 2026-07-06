import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type * as Asar from '@electron/asar'

const require = createRequire(import.meta.url)
const afterPack = require('../../../build/afterPack.cjs').default as (
  context: unknown
) => Promise<void>
const asar = require('@electron/asar') as typeof Asar

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-after-pack-'))
}

function context(projectDir: string, appOutDir: string) {
  return {
    appOutDir,
    electronPlatformName: 'linux',
    packager: {
      info: { projectDir },
      appInfo: { productFilename: 'MarkText' }
    }
  }
}

async function createAsar(appOutDir: string): Promise<string> {
  const resourcesDir = path.join(appOutDir, 'resources')
  const staging = path.join(appOutDir, 'staging')
  fs.mkdirSync(staging, { recursive: true })
  fs.mkdirSync(resourcesDir, { recursive: true })
  fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ name: 'marktext-test' }))
  fs.writeFileSync(path.join(staging, 'index.js'), '')
  const asarPath = path.join(resourcesDir, 'app.asar')
  await asar.createPackage(staging, asarPath)
  return asarPath
}

function createNativeKeymap(projectDir: string): void {
  const moduleDir = path.join(projectDir, 'node_modules', 'native-keymap')
  fs.mkdirSync(moduleDir, { recursive: true })
  fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({ name: 'native-keymap' }))
  fs.writeFileSync(path.join(moduleDir, 'index.js'), '')
}

describe('afterPack native-keymap injection', () => {
  it('fails when native-keymap is absent from node_modules', async() => {
    const root = tempDir()
    const appOutDir = path.join(root, 'out')
    await createAsar(appOutDir)

    await expect(afterPack(context(root, appOutDir))).rejects.toThrow(/native-keymap/)
  })

  it('fails when app.asar is absent', async() => {
    const root = tempDir()
    const appOutDir = path.join(root, 'out')
    createNativeKeymap(root)

    await expect(afterPack(context(root, appOutDir))).rejects.toThrow(/app\.asar/)
  })

  it('preserves existing unpacked resources while injecting native-keymap', async() => {
    const root = tempDir()
    const appOutDir = path.join(root, 'out')
    const asarPath = await createAsar(appOutDir)
    const unpackedResource = path.join(`${asarPath}.unpacked`, 'resources', 'dictionary.aff')
    fs.mkdirSync(path.dirname(unpackedResource), { recursive: true })
    fs.writeFileSync(unpackedResource, 'dictionary')
    createNativeKeymap(root)

    await afterPack(context(root, appOutDir))

    expect(fs.readFileSync(unpackedResource, 'utf8')).toBe('dictionary')
  })
})

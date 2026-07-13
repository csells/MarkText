import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runDesktopBuild } from '../../../build/buildDesktop'

import {
  BACKGROUND_BUILD_MANIFEST,
  assertBackgroundBuildFresh,
  computeBackgroundOutputFingerprint,
  computeBackgroundSourceFingerprint,
  currentBackgroundOutputFingerprint,
  readBackgroundBuildManifest,
  readBackgroundSourceFiles
} from '../../e2e/backgroundBuild'

const tempDirectories: string[] = []

const makeOutputTree = (): string => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-background-build-'))
  tempDirectories.push(projectRoot)
  for (const [relativePath, contents] of [
    ['main/index.js', 'main-v1'],
    ['preload/index.js', 'preload-v1'],
    ['renderer/index.html', '<script src="/assets/index.js"></script>'],
    ['renderer/assets/index.js', 'renderer-v1']
  ]) {
    const outputPath = path.join(projectRoot, 'out', relativePath)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, contents)
  }
  return projectRoot
}

const makeSourceTree = (): string => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-background-source-'))
  tempDirectories.push(repositoryRoot)
  const projectRoot = path.join(repositoryRoot, 'packages/desktop')

  for (const [relativePath, contents] of [
    ['packages/desktop/src/entry.ts', 'export const entry = true\n'],
    ['packages/desktop/src/renderer/theme.md', '# bundled theme\n'],
    ['packages/desktop/src/renderer/logo.png', 'desktop-png'],
    ['packages/muya/src/index.ts', 'export const muya = true\n'],
    ['packages/muya/src/font.woff2', 'muya-font'],
    ['packages/muyajs/lib/index.js', 'export const legacy = true\n'],
    ['packages/muyajs/lib/icon.ttf', 'legacy-font'],
    ['packages/desktop/build/backgroundBuild.ts', 'export {}\n'],
    ['packages/desktop/build/buildDesktop.ts', 'export {}\n'],
    ['packages/desktop/electron.vite.config.ts', 'export default {}\n'],
    ['packages/desktop/package.json', '{"name":"desktop"}\n'],
    ['packages/desktop/tsconfig.json', '{}\n'],
    ['packages/desktop/tsconfig.base.json', '{}\n'],
    ['packages/muya/package.json', '{"name":"muya"}\n'],
    ['packages/muya/tsconfig.json', '{}\n'],
    ['packages/muyajs/package.json', '{"name":"muyajs"}\n'],
    ['package.json', '{"name":"marktext-monorepo"}\n'],
    ['pnpm-workspace.yaml', 'packages:\n  - packages/*\n'],
    ['.npmrc', 'auto-install-peers=true\n'],
    ['pnpm-lock.yaml', 'lockfileVersion: 9\n']
  ]) {
    const filePath = path.join(repositoryRoot, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, contents)
  }
  return projectRoot
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('deterministic background build freshness', () => {
  it('fingerprints normalized source paths and contents independent of enumeration order', () => {
    const first = computeBackgroundSourceFingerprint([
      { path: 'src/main/windows/base.ts', contents: 'base-v1' },
      { path: 'src/main/presentationPolicy.ts', contents: 'policy-v1' }
    ])
    const reordered = computeBackgroundSourceFingerprint([
      { path: 'src/main/presentationPolicy.ts', contents: 'policy-v1' },
      { path: 'src/main/windows/base.ts', contents: 'base-v1' }
    ])
    const changed = computeBackgroundSourceFingerprint([
      { path: 'src/main/windows/base.ts', contents: 'base-v1' },
      { path: 'src/main/presentationPolicy.ts', contents: 'policy-v2' }
    ])

    expect(first).toBe(reordered)
    expect(first).not.toBe(changed)
  })

  it('rejects stale sources and modified output independently with rebuild context', () => {
    expect(() => assertBackgroundBuildFresh({
      currentSourceFingerprint: 'source-sha256',
      currentOutputFingerprint: 'output-sha256',
      manifest: {
        version: 2,
        sourceFingerprint: 'old-build-sha256',
        outputFingerprint: 'output-sha256'
      },
      outputPath: '/tmp/marktext/out'
    })).toThrow(/stale.*out.*build/i)

    expect(() => assertBackgroundBuildFresh({
      currentSourceFingerprint: 'source-sha256',
      currentOutputFingerprint: 'changed-output-sha256',
      manifest: {
        version: 2,
        sourceFingerprint: 'source-sha256',
        outputFingerprint: 'built-output-sha256'
      },
      outputPath: '/tmp/marktext/out'
    })).toThrow(/(?:incomplete|modified).*out.*build/i)

    expect(() => assertBackgroundBuildFresh({
      currentSourceFingerprint: 'same-source',
      currentOutputFingerprint: 'same-output',
      manifest: {
        version: 2,
        sourceFingerprint: 'same-source',
        outputFingerprint: 'same-output'
      },
      outputPath: '/tmp/marktext/out'
    })).not.toThrow()
  })

  it('fingerprints every launch artifact independent of enumeration order', () => {
    const files = [
      { path: 'main/index.js', contents: Buffer.from('main-v1') },
      { path: 'preload/index.js', contents: Buffer.from('preload-v1') },
      { path: 'renderer/index.html', contents: Buffer.from('renderer-v1') },
      { path: 'renderer/assets/index.js', contents: Buffer.from('asset-v1') }
    ]
    const baseline = computeBackgroundOutputFingerprint(files)
    expect(computeBackgroundOutputFingerprint([...files].reverse())).toBe(baseline)

    for (let index = 0; index < files.length; index += 1) {
      const changed = files.map((file, current) => current === index
        ? { ...file, contents: Buffer.from(`${file.contents.toString()}-changed`) }
        : file)
      expect(computeBackgroundOutputFingerprint(changed)).not.toBe(baseline)
    }
    expect(computeBackgroundOutputFingerprint([
      ...files,
      { path: 'renderer/assets/lazy.js', contents: Buffer.from('lazy') }
    ])).not.toBe(baseline)
  })

  it('hashes the complete output tree, excludes its manifest, and requires every entrypoint', () => {
    const projectRoot = makeOutputTree()
    const baseline = currentBackgroundOutputFingerprint(projectRoot)
    const manifestPath = path.join(projectRoot, 'out/main', BACKGROUND_BUILD_MANIFEST)
    fs.writeFileSync(manifestPath, '{"ignored":true}\n')
    expect(currentBackgroundOutputFingerprint(projectRoot)).toBe(baseline)

    fs.rmSync(path.join(projectRoot, 'out/preload/index.js'))
    expect(() => currentBackgroundOutputFingerprint(projectRoot))
      .toThrow(/preload\/index\.js/)
  })

  it('rejects old or malformed manifests instead of silently trusting them', () => {
    const projectRoot = makeOutputTree()
    const manifestPath = path.join(projectRoot, 'out/main', BACKGROUND_BUILD_MANIFEST)
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      sourceFingerprint: 'source'
    }))
    expect(() => readBackgroundBuildManifest(projectRoot)).toThrow(/unsupported shape/i)
  })

  it('fingerprints binary, Markdown, package, TypeScript, and lock build inputs', () => {
    const projectRoot = makeSourceTree()
    const paths = new Set(readBackgroundSourceFiles(projectRoot).map((file) =>
      file.path.replaceAll('\\', '/')))

    for (const expectedPath of [
      'src/renderer/theme.md',
      'src/renderer/logo.png',
      '../muya/src/font.woff2',
      '../muyajs/lib/icon.ttf',
      'tsconfig.json',
      'tsconfig.base.json',
      '../muya/package.json',
      '../muya/tsconfig.json',
      '../muyajs/package.json',
      '../../package.json',
      '../../pnpm-workspace.yaml',
      '../../.npmrc',
      '../../pnpm-lock.yaml'
    ]) {
      expect(paths.has(expectedPath), expectedPath).toBe(true)
    }
  })

  it('finalizes only after the external electron-vite build promise resolves', async() => {
    const wrapperPath = path.resolve(__dirname, '../../../build/buildDesktop.ts')
    expect(fs.existsSync(wrapperPath)).toBe(true)
    const calls: string[] = []
    const dependencies = {
      currentSourceFingerprint: (root: string) => {
        calls.push(`source:${root}`)
        return 'source-at-build-start'
      },
      build: async({ root }: { root?: string }) => {
        calls.push(`build:${String(root)}`)
      },
      writeManifest: (root: string, fingerprint: string) => {
        calls.push(`manifest:${root}:${fingerprint}`)
      }
    }

    await runDesktopBuild('/tmp/marktext-desktop', dependencies)
    expect(calls).toEqual([
      'source:/tmp/marktext-desktop',
      'build:/tmp/marktext-desktop',
      'manifest:/tmp/marktext-desktop:source-at-build-start'
    ])

    calls.length = 0
    await expect(runDesktopBuild('/tmp/marktext-desktop', {
      ...dependencies,
      build: async() => {
        calls.push('build:rejected')
        throw new Error('renderer write failed')
      }
    })).rejects.toThrow(/renderer write failed/)
    expect(calls).toEqual([
      'source:/tmp/marktext-desktop',
      'build:rejected'
    ])
  })
})

describe('background harness fitness', () => {
  const helpersPath = path.resolve(__dirname, '../../e2e/helpers.ts')
  const helpers = fs.readFileSync(helpersPath, 'utf8')
  const configPath = path.resolve(__dirname, '../../../electron.vite.config.ts')
  const config = fs.readFileSync(configPath, 'utf8')

  it('uses freshness plus a runtime policy assertion instead of bundle substrings', () => {
    expect(helpers).not.toContain('backgroundBuildSentinels')
    expect(helpers).not.toContain('hasBackgroundTestGuards')
    expect(helpers).toContain('assertCurrentBackgroundBuildFresh')
    expect(helpers).toContain('assertBackgroundRuntimePolicy')
  })

  it('keeps manifest finalization outside Vite closeBundle hooks', () => {
    const buildWrapper = fs.readFileSync(
      path.resolve(__dirname, '../../../build/buildDesktop.ts'),
      'utf8'
    )
    const packageJson = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../../package.json'),
      'utf8'
    )) as { scripts: Record<string, string> }

    expect(config).not.toContain('backgroundBuildSourcePlugin')
    expect(config).not.toContain('backgroundBuildFinalizePlugin')
    expect(config).not.toContain('writeBackgroundBuildManifest')
    expect(buildWrapper).not.toMatch(/^\s*await runDesktopBuild\(/m)
    expect(buildWrapper).toMatch(/^\s*runDesktopBuild\([\s\S]*?\.catch\(/m)
    expect(packageJson.scripts['build:desktop']).toBe('tsx build/buildDesktop.ts')
    for (const scriptName of [
      'build',
      'build:unpack',
      'build:win',
      'build:win:x64',
      'build:win:arm64',
      'build:mac',
      'build:mac:x64',
      'build:mac:arm64',
      'build:linux'
    ]) {
      expect(packageJson.scripts[scriptName]).toContain('build:desktop')
      expect(packageJson.scripts[scriptName]).not.toContain('electron-vite build')
    }
  })

  it('installs renderer error capture on every Electron launch', () => {
    expect(helpers).not.toContain('suppressErrorDialog')
    const launchBody = helpers.match(
      /export const launchElectron[\s\S]*?const page = await app\.firstWindow\(\)/
    )?.[0] ?? ''

    expect(launchBody).toContain('await installRendererErrorCounter(app)')
    expect(launchBody).not.toMatch(
      /if\s*\([^)]*\)\s*await installRendererErrorCounter\(app\)/
    )
  })
})

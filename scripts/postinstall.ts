#!/usr/bin/env node
/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * Cross-platform postinstall: patch native-keymap for C++20, download Electron,
 * rebuild all native modules for Electron's ABI, generate locale files.
 *
 * native-keymap is a regular dependency (electron-builder only packages
 * dependencies reported by `pnpm list --prod`, and the packaged app cannot
 * boot without it), but its auto-gyp build fails on Node v24+, so
 * pnpm-workspace.yaml denies its install-time build (allowBuilds: false).
 * This script patches the source and rebuilds it correctly via
 * @electron/rebuild.
 *
 * Step order matters: the frozen install is validated before Electron is
 * downloaded, then the checked-in patch is applied before the native rebuild.
 *
 * Monorepo layout: the Electron desktop app lives in packages/desktop with
 * its own node_modules (workspace-local deps are not hoisted to the root —
 * `shamefully-hoist=true` only flattens transitive deps). All Electron-related
 * lookups (binary, install.js, native-keymap, electron-rebuild, patch-package)
 * therefore resolve under packages/desktop/node_modules. patch-package and
 * electron-rebuild also run with cwd=packages/desktop so that `patches/` and
 * the local package.json are picked up correctly.
 */

import {
  extractElectronArchive,
  findElectronArchive,
  sanitizeElectronEnvironment,
  stageAuthenticatedElectronArchive
} from './electronIntegrity.mjs'

const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const repoRoot = path.join(__dirname, '..')
const desktopRoot = path.join(repoRoot, 'packages', 'desktop')

function run(executable, args = [], opts = {}) {
  const { cwd = repoRoot, env = {} } = opts
  execFileSync(executable, args, {
    stdio: 'inherit',
    cwd,
    env: sanitizeElectronEnvironment(process.env, env)
  })
}

const patchPackageCli = path.join(
  desktopRoot,
  'node_modules',
  'patch-package',
  'index.js'
)
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')

// ── 1. Require the native-keymap source from the frozen workspace install ──
const nativeKeymapDir = path.join(desktopRoot, 'node_modules', 'native-keymap')
if (!fs.existsSync(nativeKeymapDir)) {
  throw new Error('Required native-keymap source is missing from the frozen install')
}

// ── 2. Download + extract Electron binary ────────────────────────────────────
const electronInstall = path.join(desktopRoot, 'node_modules', 'electron', 'install.js')

if (!fs.existsSync(electronInstall)) {
  throw new Error('electron/install.js not found in the frozen install')
} else {
  const os = require('os')
  const plat = os.platform()
  const platformBinary =
    plat === 'win32'
      ? 'electron.exe'
      : plat === 'darwin' || plat === 'mas'
        ? 'Electron.app/Contents/MacOS/Electron'
        : 'electron'

  const pathTxt = path.join(desktopRoot, 'node_modules', 'electron', 'path.txt')
  const distDir = path.join(desktopRoot, 'node_modules', 'electron', 'dist')

  // On macOS we also require Frameworks/ — yauzl v2.10.0 hangs on Node v26+ and
  // silently produces an incomplete dist/ without Frameworks.
  const isComplete = () => {
    if (!fs.existsSync(pathTxt)) return false
    const rel = fs.readFileSync(pathTxt, 'utf8').trim()
    if (!fs.existsSync(path.join(desktopRoot, 'node_modules', 'electron', rel))) return false
    if (plat === 'darwin' || plat === 'mas') {
      return fs.existsSync(path.join(distDir, 'Electron.app', 'Contents', 'Frameworks'))
    }
    return true
  }

  if (!isComplete()) {
    // Remove any partial dist so install.js always runs extraction fresh
    if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true })
    if (fs.existsSync(pathTxt)) fs.unlinkSync(pathTxt)

    console.log('Downloading Electron binary...')
    run(process.execPath, [electronInstall])

    // yauzl v2.10.0 + Node v26+: openReadStream callback never fires for
    // compressed entries → extract-zip exits silently with incomplete dist/.
    // Re-extract using system unzip which handles the zip correctly.
    if (
      (plat === 'darwin' || plat === 'mas') &&
      !fs.existsSync(path.join(distDir, 'Electron.app', 'Contents', 'Frameworks'))
    ) {
      const { version } = require(path.join(desktopRoot, 'node_modules', 'electron', 'package.json'))
      const arch = os.arch()
      const zipName = `electron-v${version}-darwin-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`
      const cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'electron')

      const zipPath = findElectronArchive(cacheRoot, zipName)

      if (!zipPath) {
        throw new Error('Electron zip not in the authenticated download cache')
      }

      const checksums = require(
        path.join(desktopRoot, 'node_modules', 'electron', 'checksums.json')
      )
      const expectedChecksum = checksums[zipName]

      console.log(
        `Re-extracting with system unzip (yauzl incompatible with Node ${process.version})...`
      )
      if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true })
      const stagedArchive = stageAuthenticatedElectronArchive(zipPath, expectedChecksum)
      try {
        extractElectronArchive(stagedArchive.path, distDir)
        fs.writeFileSync(pathTxt, platformBinary)
        fs.writeFileSync(path.join(distDir, 'version'), version)
      } finally {
        stagedArchive.cleanup()
      }
    }

    // Ensure path.txt exists (install.js may skip it on a cache hit)
    if (!fs.existsSync(pathTxt)) {
      fs.writeFileSync(pathTxt, platformBinary)
    }
  }
}

// ── 3. Apply C++20 patch to native-keymap (patches/ lives in packages/desktop) ──
console.log('Applying patches...')
run(process.execPath, [patchPackageCli], { cwd: desktopRoot })

// ── 4. Rebuild native modules for Electron ABI ──────────────────────────────
console.log('Rebuilding native modules for Electron...')
run(process.execPath, [tsxCli, path.join(repoRoot, 'scripts', 'runElectronRebuild.mts')])

// ── 5. Generate minified locale files ───────────────────────────────────────
console.log('Minifying locales...')
run(process.execPath, [tsxCli, path.join(repoRoot, 'scripts', 'minify-locales.ts')])

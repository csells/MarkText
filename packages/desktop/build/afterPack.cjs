// electron-builder afterPack hook: bundle the optional `native-keymap` module.
//
// native-keymap is an optionalDependency (scripts/postinstall.ts keeps it
// optional so `pnpm install` tolerates its gyp/C++20 build failing on
// compiler-hostile environments). electron-builder's pnpm dependency collector
// omits optionalDependencies, so the packaged app.asar ships without it and the
// main process crashes at startup with "Cannot find module 'native-keymap'".
//
// This hook injects the already-built module into app.asar after packing,
// preserving electron-builder's existing unpack set (native .node modules and
// the ripgrep binary must stay in app.asar.unpacked to load/exec at runtime).
// It keeps native-keymap optional for install while making the build correct.

const fs = require('fs')
const path = require('path')
const asar = require('@electron/asar')

/** Module directory names electron-builder already unpacked (e.g. keytar, ripgrep-darwin-arm64). */
function collectUnpackedModuleNames (nodeModulesDir) {
  const names = new Set()
  if (!fs.existsSync(nodeModulesDir)) return names
  for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesDir, entry.name)
      for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (scoped.isDirectory()) names.add(scoped.name)
      }
    } else {
      names.add(entry.name)
    }
  }
  return names
}

exports.default = async function bundleOptionalNativeKeymap (context) {
  const { appOutDir, packager, electronPlatformName } = context
  const resourcesDir =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(appOutDir, 'resources')
  const asarPath = path.join(resourcesDir, 'app.asar')
  if (!fs.existsSync(asarPath)) throw new Error(`[afterPack] app.asar not found at ${asarPath}`)

  // Idempotent: on setups where the collector already bundled it, do nothing.
  if (asar.listPackage(asarPath).some((e) => e.split(path.sep).includes('native-keymap'))) return

  const src = path.join(packager.info.projectDir, 'node_modules', 'native-keymap')
  if (!fs.existsSync(src)) throw new Error('[afterPack] native-keymap absent from node_modules')

  const unpackedRoot = `${asarPath}.unpacked`
  const unpackNames = collectUnpackedModuleNames(path.join(unpackedRoot, 'node_modules'))
  unpackNames.add('native-keymap')

  const staging = path.join(appOutDir, '.native-keymap-inject')
  const preservedUnpackedRoot = path.join(appOutDir, '.native-keymap-existing-unpacked')
  const tempAsarPath = path.join(resourcesDir, '.app.asar.native-keymap')
  const tempUnpackedRoot = `${tempAsarPath}.unpacked`

  try {
    fs.rmSync(staging, { recursive: true, force: true })
    fs.rmSync(preservedUnpackedRoot, { recursive: true, force: true })
    fs.rmSync(tempAsarPath, { force: true })
    fs.rmSync(tempUnpackedRoot, { recursive: true, force: true })

    asar.extractAll(asarPath, staging)
    fs.cpSync(src, path.join(staging, 'node_modules', 'native-keymap'), {
      recursive: true,
      dereference: true
    })
    if (fs.existsSync(unpackedRoot)) {
      fs.cpSync(unpackedRoot, preservedUnpackedRoot, { recursive: true, dereference: false })
    }

    // minimatch does not brace-expand a single-entry brace, so `**/{name}`
    // matches nothing when only one module needs unpacking.
    const names = [...unpackNames]
    await asar.createPackageWithOptions(staging, tempAsarPath, {
      unpackDir: names.length === 1 ? `**/${names[0]}` : `**/{${names.join(',')}}`
    })
    // Unpackedness is the whole point (native modules cannot load from
    // inside the archive) — verify instead of trusting the glob.
    for (const name of names) {
      const marker = path.join(tempUnpackedRoot, 'node_modules', name)
      if (!fs.existsSync(marker)) {
        throw new Error(`[afterPack] ${name} was not unpacked from the rebuilt asar`)
      }
    }
    if (fs.existsSync(preservedUnpackedRoot)) {
      fs.cpSync(preservedUnpackedRoot, tempUnpackedRoot, {
        recursive: true,
        force: true,
        dereference: false
      })
    }

    fs.rmSync(asarPath, { force: true })
    fs.renameSync(tempAsarPath, asarPath)
    fs.rmSync(unpackedRoot, { recursive: true, force: true })
    if (fs.existsSync(tempUnpackedRoot)) fs.renameSync(tempUnpackedRoot, unpackedRoot)
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
    fs.rmSync(preservedUnpackedRoot, { recursive: true, force: true })
    fs.rmSync(tempAsarPath, { force: true })
    fs.rmSync(tempUnpackedRoot, { recursive: true, force: true })
  }
  console.log(
    `[afterPack] injected native-keymap into ${path.relative(packager.info.projectDir, asarPath)}`
  )
}

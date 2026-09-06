import { extractFile, listPackage, statFile, uncache } from '@electron/asar'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join, normalize, sep } from 'node:path'

export const verifyPackagedApp = (executable: string): void => {
  const binaryDirectory = dirname(executable)
  const resources = basename(binaryDirectory) === 'MacOS'
    ? join(binaryDirectory, '../Resources')
    : join(binaryDirectory, 'resources')
  const archive = join(resources, 'app.asar')
  let verifiedBundleSignature = false
  uncache(archive)
  let manifest: { main?: unknown, dependencies?: Readonly<Record<string, unknown>> } | null
  try {
    manifest = JSON.parse(extractFile(archive, 'package.json').toString('utf8'))
  } catch (cause) {
    throw new Error(`Invalid packaged application package.json: ${archive}`, { cause })
  }
  try {
    if (typeof manifest?.main !== 'string' || !manifest.main) throw new Error('Missing main')
    extractFile(archive, normalize(manifest.main.replace(/[/\\]/g, sep)))
  } catch (cause) {
    throw new Error(`Invalid packaged application main entry: ${archive}`, { cause })
  }
  if (manifest?.dependencies?.ced !== undefined) {
    const addon = join('node_modules', 'ced', 'build', 'Release', 'ced.node')
    try {
      if (extractFile(archive, addon).length === 0) throw new Error('Empty encoding addon')
    } catch (cause) {
      throw new Error(`Missing packaged encoding addon: ${addon} in ${archive}`, { cause })
    }
  }
  for (const entry of listPackage(archive, { isPack: false })) {
    const file = entry.replace(/^[/\\]/, '')
    const metadata = statFile(archive, file, false)
    if (!('size' in metadata)) continue
    const bytes = extractFile(archive, file)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (bytes.length !== metadata.size || metadata.integrity?.algorithm !== 'SHA256' ||
        hash !== metadata.integrity.hash) {
      if (process.platform === 'darwin' && basename(binaryDirectory) === 'MacOS' && metadata.unpacked) {
        // macOS signs native addons after ASAR metadata is written. Their final
        // bytes are protected by the bundle seal, not the pre-signing ASAR hash.
        if (!verifiedBundleSignature) {
          execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', join(binaryDirectory, '../..')], { stdio: 'pipe' })
          verifiedBundleSignature = true
        }
        continue
      }
      throw new Error(`Packaged application integrity failure: ${file} in ${archive}`)
    }
  }
}

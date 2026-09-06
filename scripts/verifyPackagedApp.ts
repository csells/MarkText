import { extractFile, listPackage, statFile, uncache } from '@electron/asar'
import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

export const verifyPackagedApp = (executable: string): void => {
  const binaryDirectory = dirname(executable)
  const resources = basename(binaryDirectory) === 'MacOS'
    ? join(binaryDirectory, '../Resources')
    : join(binaryDirectory, 'resources')
  const archive = join(resources, 'app.asar')
  uncache(archive)
  let manifest: { main?: unknown, dependencies?: Readonly<Record<string, unknown>> } | null
  try {
    manifest = JSON.parse(extractFile(archive, 'package.json').toString('utf8'))
  } catch (cause) {
    throw new Error(`Invalid packaged application package.json: ${archive}`, { cause })
  }
  try {
    if (typeof manifest?.main !== 'string' || !manifest.main) throw new Error('Missing main')
    extractFile(archive, manifest.main.replace(/^\.\//, ''))
  } catch (cause) {
    throw new Error(`Invalid packaged application main entry: ${archive}`, { cause })
  }
  if (manifest?.dependencies?.ced !== undefined) {
    const addon = 'node_modules/ced/build/Release/ced.node'
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
      throw new Error(`Packaged application integrity failure: ${file} in ${archive}`)
    }
  }
}

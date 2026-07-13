import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  currentBackgroundSourceFingerprint,
  writeBackgroundBuildManifest
} from './backgroundBuild'

export interface DesktopBuildDependencies {
  currentSourceFingerprint(projectRoot: string): string
  build(config: { root?: string }): Promise<void>
  writeManifest(projectRoot: string, expectedSourceFingerprint: string): void
}

const productionDependencies: DesktopBuildDependencies = {
  currentSourceFingerprint: currentBackgroundSourceFingerprint,
  build: async(config) => {
    const { build } = await import('electron-vite')
    await build(config)
  },
  writeManifest: writeBackgroundBuildManifest
}

/**
 * Build every Electron target and stamp the background-test manifest only
 * after electron-vite reports complete success. A Vite `closeBundle` hook is
 * not a success boundary: Rollup also closes a bundle while unwinding failed
 * writes.
 */
export const runDesktopBuild = async(
  projectRoot: string,
  dependencies: DesktopBuildDependencies = productionDependencies
): Promise<void> => {
  const sourceFingerprint = dependencies.currentSourceFingerprint(projectRoot)
  await dependencies.build({ root: projectRoot })
  dependencies.writeManifest(projectRoot, sourceFingerprint)
}

const modulePath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  runDesktopBuild(path.resolve(path.dirname(modulePath), '..')).catch((error) => {
    process.nextTick(() => {
      throw error
    })
  })
}

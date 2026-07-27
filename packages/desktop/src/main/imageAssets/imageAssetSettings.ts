import type { ImageAssetSettings } from './imageAssetService'

export type ImageAssetSettingsProvider = () => ImageAssetSettings
export type ImageAssetProjectRootProvider = (
  windowId: number
) => string | null

let settingsProvider: ImageAssetSettingsProvider | null = null
let projectRootProvider: ImageAssetProjectRootProvider = () => null

/**
 * Connect the image service to the already-instantiated main-owned stores.
 * The provider is lazy so every insertion observes the current preferences.
 */
export function configureImageAssetSettings(
  provider: ImageAssetSettingsProvider
): void {
  settingsProvider = provider
}

export function readImageAssetSettings(): ImageAssetSettings {
  if (settingsProvider === null) {
    throw new Error('Image asset settings are not configured')
  }
  return settingsProvider()
}

export function configureImageAssetProjectRoot(
  provider: ImageAssetProjectRootProvider
): void {
  projectRootProvider = provider
}

export function readImageAssetProjectRoot(windowId: number): string | null {
  return projectRootProvider(windowId)
}

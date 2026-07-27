import { app } from 'electron'

const ID_PREFIX = 'mt-'
let id = 0

export const getUniqueId = (): string => {
  return `${ID_PREFIX}${id++}`
}

/**
 * Returns a special directory path for the requested name.
 *
 * NOTE: Do not use "userData" to get the user data path, instead use AppPaths!
 *
 * @param name The special directory name.
 * @returns The resolved special directory path.
 */
export const getPath = (name: Parameters<typeof app.getPath>[0]): string => {
  if (name === 'userData') {
    throw new Error('Do not use "getPath" for user data path!')
  }
  return app.getPath(name)
}

export const hasSameKeys = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  aKeys.sort()
  bKeys.sort()
  return aKeys.every((k, i) => k === bKeys[i])
}

export type LogLevel = 'silly' | 'debug' | 'verbose' | 'info'

export const getLogLevel = (): LogLevel => {
  const verbose = (globalThis as typeof globalThis & { MARKTEXT_DEBUG_VERBOSE?: number })
    .MARKTEXT_DEBUG_VERBOSE
  if (!verbose || typeof verbose !== 'number' || verbose <= 0) {
    return process.env.NODE_ENV === 'development' ? 'debug' : 'info'
  } else if (verbose === 1) {
    return 'verbose'
  } else if (verbose === 2) {
    return 'debug'
  }
  return 'silly' // >= 3
}

import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { isSamePathSync } from 'common/filesystem/paths'

const pendingDestinations = new Map<string, Promise<void>>()

const canonicalDestination = (pathname: string): string => {
  const resolved = path.resolve(pathname)
  try {
    return fs.realpathSync(resolved)
  } catch {
    const parent = path.dirname(resolved)
    return parent === resolved
      ? resolved
      : path.join(canonicalDestination(parent), path.basename(resolved))
  }
}

const caseInsensitiveEntry = (entry: string): boolean | undefined => {
  const name = path.basename(entry)
  const alternate = name.replace(/[a-zA-Z]/, (letter) =>
    letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase()
  )
  if (alternate === name) return undefined
  const original = fs.lstatSync(entry)
  try {
    const aliased = fs.lstatSync(path.join(path.dirname(entry), alternate))
    return original.dev === aliased.dev && original.ino === aliased.ino
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const destinationIgnoresCase = (pathname: string): boolean | undefined => {
  let directory = path.dirname(pathname)
  for (;;) {
    try {
      directory = fs.realpathSync(directory)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(directory)
      if (parent === directory) throw error
      directory = parent
    }
  }
  const parent = path.dirname(directory)
  // A mountpoint's name follows its parent volume's case policy. Probe an
  // entry within the destination volume when their devices differ.
  if (directory !== parent && fs.lstatSync(directory).dev === fs.lstatSync(parent).dev) {
    const result = caseInsensitiveEntry(directory)
    if (result !== undefined) return result
  }
  for (const name of fs.readdirSync(directory)) {
    const result = caseInsensitiveEntry(path.join(directory, name))
    if (result !== undefined) return result
  }
  return undefined
}

export const isSameSaveDestination = (a: string, b: string): boolean => {
  if (isSamePathSync(a, b)) return true
  const first = canonicalDestination(a)
  const second = canonicalDestination(b)
  if (first === second) return true
  if (first.toLowerCase() !== second.toLowerCase()) return false
  // Missing filenames cannot be compared by inode. Unknown or disappearing
  // directory entries keep an ambiguous owner's claim exclusive.
  try {
    return destinationIgnoresCase(first) !== false
  } catch {
    return true
  }
}

export const pendingSaveTo = (pathname: string): Promise<void> | undefined => {
  for (const [destination, pending] of pendingDestinations) {
    if (isSameSaveDestination(destination, pathname)) return pending
  }
}

/** Keep a new pathname exclusive until the write and open-file registration finish. */
export const withSaveDestination = async <T>(
  pathname: string,
  oldPathname: string | undefined,
  save: () => Promise<T>
): Promise<T> => {
  if (oldPathname && isSameSaveDestination(pathname, oldPathname)) return save()
  if (pendingSaveTo(pathname)) {
    throw new Error(
      'This file is being saved by another document. Choose a different name or try again.'
    )
  }
  let isOpen: boolean | undefined
  ipcMain.emit('window-check-save-destination', pathname, (value: boolean) => {
    isOpen = value
  })
  if (isOpen === undefined) throw new Error('Cannot verify whether the destination file is open.')
  if (isOpen) {
    throw new Error(
      'This file is already open in MarkText. Close it before replacing it, or choose a different name.'
    )
  }
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  pendingDestinations.set(pathname, pending)
  try {
    return await save()
  } finally {
    pendingDestinations.delete(pathname)
    release()
  }
}

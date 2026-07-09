import { readlinkSync, ensureDir, type WriteFileOptions } from 'fs-extra'
import { realpath, stat, writeFile as fsWriteFile } from 'fs/promises'
import path from 'path'
import writeFileAtomic from 'write-file-atomic'
import { isDirectory, isFile, isSymbolicLink } from 'common/filesystem'

/**
 * Normalize the path into an absolute path and resolves the link target if needed.
 *
 * Returns the absolute path and resolved link, or an empty string if the link
 * target cannot be resolved.
 */
export const normalizeAndResolvePath = (pathname: string): string => {
  if (isSymbolicLink(pathname)) {
    const absPath = path.dirname(pathname)
    const targetPath = path.resolve(absPath, readlinkSync(pathname))
    if (isFile(targetPath) || isDirectory(targetPath)) {
      return path.resolve(targetPath)
    }
    console.error(`Cannot resolve link target "${pathname}" (${targetPath}).`)
    return ''
  }
  return path.resolve(pathname)
}

export const writeFile = async(
  pathname: string,
  content: string | Buffer,
  extension?: string,
  options: WriteFileOptions | undefined = 'utf-8'
): Promise<void> => {
  if (!pathname) {
    throw new Error('[ERROR] Cannot save file without path.')
  }
  pathname = !extension || pathname.endsWith(extension) ? pathname : `${pathname}${extension}`

  // Create any missing parent directories before writing, so a save whose
  // folder was moved/deleted recreates it and still succeeds — matching
  // VS Code, and keeping (auto)save from ever silently failing (#3509).
  await ensureDir(path.dirname(pathname))

  // An atomic rename over a symlink would replace the LINK with a regular
  // file; write through to the link target instead, like the previous
  // in-place write did. ENOENT means either a brand-new file (the given path
  // IS the target) OR a symlink whose target was deleted (dangling).
  let target = pathname
  let danglingSymlink = false
  try {
    target = await realpath(pathname)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
    danglingSymlink = isSymbolicLink(pathname)
  }

  // The atomic temp+rename creates a NEW inode, which would silently diverge
  // two cases the previous in-place write handled correctly:
  //   - a HARD-LINKED file (nlink > 1): the rename leaves the other name
  //     frozen at the old content, severing the link;
  //   - a DANGLING symlink: the rename drops a regular file where the link
  //     was, instead of writing through to recreate its target.
  // Write in place for exactly those, following the symlink for the dangling
  // case; keep the crash-safe atomic rename for every ordinary file/dir/valid
  // symlink (mode + ownership preserved across the swap).
  let hardLinked = false
  if (!danglingSymlink) {
    try {
      hardLinked = (await stat(target)).nlink > 1
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err
      }
      // target vanished between realpath and stat — treat as a new file.
    }
  }

  const encoding = typeof options === 'string' ? options : options?.encoding
  if (hardLinked || danglingSymlink) {
    await fsWriteFile(
      danglingSymlink ? pathname : target,
      content,
      encoding ? { encoding: encoding as BufferEncoding } : undefined
    )
    return
  }
  await writeFileAtomic(target, content, encoding ? { encoding } : {})
}

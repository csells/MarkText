import { readlinkSync, ensureDir, type WriteFileOptions } from 'fs-extra'
import { realpath } from 'fs/promises'
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
  // in-place write did. ENOENT means a brand-new file — the given path IS
  // the target.
  let target = pathname
  try {
    target = await realpath(pathname)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }

  // Temp file + fsync + rename (write-file-atomic): an interrupted save —
  // crash, ENOSPC, power loss — can no longer truncate the existing document.
  // The old bytes stay on disk until the new ones are durable, and the
  // existing file's mode/ownership are preserved across the swap.
  const encoding = typeof options === 'string' ? options : options?.encoding
  await writeFileAtomic(target, content, encoding ? { encoding } : {})
}

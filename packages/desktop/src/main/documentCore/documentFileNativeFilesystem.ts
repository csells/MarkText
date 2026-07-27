import { rename } from 'node:fs/promises'

/**
 * The filesystem boundary used to commit an already-prepared replacement.
 *
 * Keeping the native syscall behind this adapter lets behavioral tests hold
 * two real filesystem mutations at the commit boundary without introducing a
 * production-only scheduling hook.
 */
export const documentFileNativeFilesystem = Object.freeze({
  rename: async(
    sourcePathname: string,
    targetPathname: string
  ): Promise<void> => {
    await rename(sourcePathname, targetPathname)
  }
})

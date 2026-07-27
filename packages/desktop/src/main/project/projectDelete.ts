import path from 'node:path'
import {
  lstat,
  realpath
} from 'node:fs/promises'
import type {
  DocumentCoreFileDescription
} from '../documentCore/documentFileHost'
import type {
  ProjectDeleteIntent,
  ProjectDeleteReceipt
} from '../../shared/types/projectDeletion'

export interface DeleteProjectEntryOptions {
  readonly root: string
  readonly intent: ProjectDeleteIntent
  readonly findOpenDocument: (pathname: string) => string | null
  readonly openDocumentsUnder: (
    directoryPathname: string
  ) => readonly DocumentCoreFileDescription[]
  readonly trashEntry: (pathname: string) => Promise<void>
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (
      !path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)
    )
  )
}

/**
 * Trash one unopened project entry resolved under main's retained root.
 *
 * Open documents are visibly rejected before mutation, preserving their
 * FileHost path and durable metadata as one coherent identity.
 */
export async function deleteProjectEntry({
  root,
  intent,
  findOpenDocument,
  openDocumentsUnder,
  trashEntry
}: DeleteProjectEntryOptions): Promise<ProjectDeleteReceipt> {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('Project delete requires a retained project root')
  }
  const retainedRoot = path.resolve(root)
  const canonicalRoot = await realpath(retainedRoot)
  const pathname = path.resolve(retainedRoot, ...intent.entrySegments)
  if (pathname === retainedRoot || !isWithin(retainedRoot, pathname)) {
    throw new Error('Project delete target escapes the retained project root')
  }
  const stats = await lstat(pathname)
  if (stats.isSymbolicLink()) {
    throw new Error('Project delete does not follow symbolic links')
  }
  if (
    (intent.kind === 'file' && !stats.isFile()) ||
    (intent.kind === 'directory' && !stats.isDirectory())
  ) {
    throw new Error('Project delete kind does not match the retained entry')
  }
  const canonicalPathname = await realpath(pathname)
  if (!isWithin(canonicalRoot, canonicalPathname)) {
    throw new Error('Project delete target escapes through a symbolic link')
  }

  if (intent.kind === 'file') {
    if (findOpenDocument(pathname) !== null) {
      throw new Error('Close the open file before moving it to the trash')
    }
  } else if (openDocumentsUnder(pathname).length > 0) {
    throw new Error(
      'Close every open descendant before moving this directory to the trash'
    )
  }

  await trashEntry(pathname)
  return Object.freeze({
    schema: 'project-delete-receipt-1',
    kind: intent.kind,
    pathname
  })
}

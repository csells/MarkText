import path from 'node:path'
import {
  lstat,
  readdir,
  realpath
} from 'node:fs/promises'
import { copy } from 'fs-extra'
import type {
  DocumentCoreFileDescription
} from '../documentCore/documentFileHost'
import type {
  ProjectEntryMetadata
} from '../../shared/types/projectCreate'
import type {
  ProjectCopyIntent,
  ProjectCopyReceipt
} from '../../shared/types/projectCopy'

type CopyEntry = (
  sourcePathname: string,
  targetPathname: string
) => Promise<void>

export interface CopyProjectEntryOptions {
  readonly root: string
  readonly intent: ProjectCopyIntent
  readonly findOpenDocument: (pathname: string) => string | null
  readonly openDocumentsUnder: (
    directoryPathname: string
  ) => readonly DocumentCoreFileDescription[]
  readonly copyEntry?: CopyEntry
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

async function assertNoSymbolicLinks(pathname: string): Promise<void> {
  const stats = await lstat(pathname)
  if (stats.isSymbolicLink()) {
    throw new Error('Project copy does not copy symbolic links')
  }
  if (!stats.isDirectory()) return
  for (const name of await readdir(pathname)) {
    await assertNoSymbolicLinks(path.join(pathname, name))
  }
}

async function exists(pathname: string): Promise<boolean> {
  try {
    await lstat(pathname)
    return true
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}

function entryMetadata(
  pathname: string,
  name: string,
  kind: ProjectCopyIntent['kind']
): ProjectEntryMetadata {
  return Object.freeze({
    pathname,
    name,
    isFile: kind === 'file',
    isDirectory: kind === 'directory',
    isMarkdown:
      kind === 'file' &&
      ['.md', '.markdown', '.mdown', '.mkdn']
        .includes(path.extname(name).toLowerCase())
  })
}

const exclusiveCopy: CopyEntry = async(
  sourcePathname,
  targetPathname
) => {
  await copy(sourcePathname, targetPathname, {
    overwrite: false,
    errorOnExist: true
  })
}

/**
 * Copy one unopened project entry entirely inside main's retained root.
 *
 * An open source is rejected because its on-disk bytes may trail the
 * main-owned document head. This avoids creating a stale copy while keeping
 * the existing document identity untouched.
 */
export async function copyProjectEntry({
  root,
  intent,
  findOpenDocument,
  openDocumentsUnder,
  copyEntry = exclusiveCopy
}: CopyProjectEntryOptions): Promise<ProjectCopyReceipt> {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('Project copy requires a retained project root')
  }
  const retainedRoot = path.resolve(root)
  const canonicalRoot = await realpath(retainedRoot)
  const sourcePathname = path.resolve(
    retainedRoot,
    ...intent.entrySegments
  )
  if (
    sourcePathname === retainedRoot ||
    !isWithin(retainedRoot, sourcePathname)
  ) {
    throw new Error('Project copy source escapes the retained project root')
  }
  const sourceStats = await lstat(sourcePathname)
  if (
    sourceStats.isSymbolicLink() ||
    (intent.kind === 'file' && !sourceStats.isFile()) ||
    (intent.kind === 'directory' && !sourceStats.isDirectory())
  ) {
    throw new Error('Project copy source kind is invalid')
  }
  const canonicalSource = await realpath(sourcePathname)
  if (!isWithin(canonicalRoot, canonicalSource)) {
    throw new Error('Project copy source escapes through a symbolic link')
  }

  const targetParent = path.resolve(
    retainedRoot,
    ...intent.targetParentSegments
  )
  if (!isWithin(retainedRoot, targetParent)) {
    throw new Error('Project copy target escapes the retained project root')
  }
  const canonicalTargetParent = await realpath(targetParent)
  if (!isWithin(canonicalRoot, canonicalTargetParent)) {
    throw new Error(
      'Project copy target parent escapes through a symbolic link'
    )
  }
  if (!(await lstat(canonicalTargetParent)).isDirectory()) {
    throw new Error('Project copy target parent is not a directory')
  }
  const name = path.basename(sourcePathname)
  const targetPathname = path.join(targetParent, name)
  if (
    targetPathname === sourcePathname ||
    (
      intent.kind === 'directory' &&
      isWithin(sourcePathname, targetPathname)
    )
  ) {
    throw new Error('Project copy target must be outside its source')
  }
  if (await exists(targetPathname)) {
    throw new Error(`Project copy target already exists: ${targetPathname}`)
  }

  if (intent.kind === 'file') {
    if (findOpenDocument(sourcePathname) !== null) {
      throw new Error('Close the open file before copying it')
    }
  } else if (openDocumentsUnder(sourcePathname).length > 0) {
    throw new Error('Close every open descendant before copying this directory')
  }
  await assertNoSymbolicLinks(sourcePathname)
  await copyEntry(sourcePathname, targetPathname)

  return Object.freeze({
    schema: 'project-copy-receipt-1',
    kind: intent.kind,
    sourcePathname,
    entry: entryMetadata(targetPathname, name, intent.kind)
  })
}

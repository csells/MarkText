import path from 'node:path'
import {
  lstat,
  realpath
} from 'node:fs/promises'
import { move } from 'fs-extra'
import type {
  DocumentCoreFileDescription
} from '../documentCore/documentFileHost'
import type {
  DocumentCorePathReceipt
} from '../../shared/types/documentCore'
import type {
  ProjectEntryMetadata
} from '../../shared/types/projectCreate'
import type {
  ProjectRelocateIntent,
  ProjectRelocateReceipt
} from '../../shared/types/projectRelocation'

type FindOpenDocument = (pathname: string) => string | null
type OpenDocumentsUnder = (
  directoryPathname: string
) => readonly DocumentCoreFileDescription[]
type RelocateOpenDocument = (
  documentId: string,
  targetPathname: string
) => Promise<DocumentCorePathReceipt>
type MoveEntry = (
  sourcePathname: string,
  targetPathname: string
) => Promise<void>

export interface RelocateProjectEntryOptions {
  readonly root: string
  readonly intent: ProjectRelocateIntent
  readonly findOpenDocument: FindOpenDocument
  readonly openDocumentsUnder: OpenDocumentsUnder
  readonly relocateOpenDocument: RelocateOpenDocument
  readonly moveEntry?: MoveEntry
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

function markdownName(name: string): boolean {
  return ['.md', '.markdown', '.mdown', '.mkdn']
    .includes(path.extname(name).toLowerCase())
}

function metadata(
  pathname: string,
  name: string,
  kind: ProjectRelocateIntent['kind']
): ProjectEntryMetadata {
  return Object.freeze({
    pathname,
    name,
    isFile: kind === 'file',
    isDirectory: kind === 'directory',
    isMarkdown: kind === 'file' && markdownName(name)
  })
}

async function targetExists(pathname: string): Promise<boolean> {
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

const moveWithoutOverwrite: MoveEntry = async(
  sourcePathname,
  targetPathname
) => {
  await move(sourcePathname, targetPathname, { overwrite: false })
}

/**
 * Relocate one sidebar entry beneath main's retained project root.
 *
 * Directory moves deliberately reject when any descendant is open. This
 * preflight happens before the filesystem move, so MarkText never leaves a
 * set of open document hosts pointing into an old directory namespace.
 */
export async function relocateProjectEntry({
  root,
  intent,
  findOpenDocument,
  openDocumentsUnder,
  relocateOpenDocument,
  moveEntry = moveWithoutOverwrite
}: RelocateProjectEntryOptions): Promise<ProjectRelocateReceipt> {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('Project relocation requires a retained project root')
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
    throw new Error('Project entry escapes the retained project root')
  }

  const sourceStats = await lstat(sourcePathname)
  if (sourceStats.isSymbolicLink()) {
    throw new Error('Project relocation does not follow symbolic links')
  }
  if (
    (intent.kind === 'file' && !sourceStats.isFile()) ||
    (intent.kind === 'directory' && !sourceStats.isDirectory())
  ) {
    throw new Error('Project entry kind does not match the retained entry')
  }
  const canonicalSource = await realpath(sourcePathname)
  if (!isWithin(canonicalRoot, canonicalSource)) {
    throw new Error('Project entry symlink escapes the retained project root')
  }
  const canonicalParent = await realpath(path.dirname(sourcePathname))
  if (!isWithin(canonicalRoot, canonicalParent)) {
    throw new Error('Project entry parent escapes the retained project root')
  }

  const targetParent = path.resolve(
    retainedRoot,
    ...intent.targetParentSegments
  )
  if (!isWithin(retainedRoot, targetParent)) {
    throw new Error('Project target parent escapes the retained project root')
  }
  const canonicalTargetParent = await realpath(targetParent)
  if (!isWithin(canonicalRoot, canonicalTargetParent)) {
    throw new Error(
      'Project target parent symlink escapes the retained project root'
    )
  }
  if (!(await lstat(canonicalTargetParent)).isDirectory()) {
    throw new Error('Project target parent is not a directory')
  }
  const targetPathname = path.join(targetParent, intent.newName)
  if (
    !isWithin(retainedRoot, targetPathname) ||
    (
      intent.kind === 'directory' &&
      targetPathname !== sourcePathname &&
      isWithin(sourcePathname, targetPathname)
    )
  ) {
    throw new Error('Project target escapes the retained project root')
  }
  if (targetPathname !== sourcePathname && await targetExists(targetPathname)) {
    throw new Error(`Project target already exists: ${targetPathname}`)
  }

  let document: DocumentCorePathReceipt | null = null
  if (intent.kind === 'directory') {
    if (openDocumentsUnder(sourcePathname).length > 0) {
      throw new Error(
        'Close every open descendant before renaming this directory'
      )
    }
    if (targetPathname !== sourcePathname) {
      await moveEntry(sourcePathname, targetPathname)
    }
  } else {
    const documentId = findOpenDocument(sourcePathname)
    if (documentId === null) {
      if (targetPathname !== sourcePathname) {
        await moveEntry(sourcePathname, targetPathname)
      }
    } else {
      document = await relocateOpenDocument(documentId, targetPathname)
      if (
        document.documentId !== documentId ||
        path.resolve(document.previousPathname) !== sourcePathname ||
        path.resolve(document.pathname) !== targetPathname
      ) {
        throw new Error('Document host returned a mismatched path receipt')
      }
    }
  }

  return Object.freeze({
    schema: 'project-relocate-receipt-1',
    kind: intent.kind,
    previousPathname: sourcePathname,
    entry: metadata(targetPathname, intent.newName, intent.kind),
    document
  })
}

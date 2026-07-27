import path from 'path'
import {
  lstat,
  mkdir,
  open,
  realpath,
  unlink
} from 'fs/promises'
import type {
  ProjectCreateIntent,
  ProjectCreateReceipt,
  ProjectEntryMetadata
} from '@shared/types/projectCreate'

export type ProjectFileAdmission = (pathname: string) => Promise<void>

export interface CreateProjectEntryOptions {
  readonly root: string
  readonly intent: ProjectCreateIntent
  readonly admitFile: ProjectFileAdmission
}

function assertSafeSegment(segment: string, label: string): void {
  if (
    segment.length === 0 ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('\0') ||
    segment.includes('/') ||
    segment.includes('\\') ||
    path.isAbsolute(segment)
  ) {
    throw new TypeError(`${label} must be one safe relative path segment`)
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
  )
}

async function resolveRetainedParent(
  root: string,
  parentSegments: readonly string[]
): Promise<string> {
  if (!root || typeof root !== 'string') {
    throw new Error('Project creation requires a retained project root')
  }
  for (const segment of parentSegments) {
    assertSafeSegment(segment, 'Project parent segment')
  }

  const retainedRoot = path.resolve(root)
  const canonicalRoot = await realpath(retainedRoot)
  const retainedParent = path.resolve(retainedRoot, ...parentSegments)
  if (!isWithin(retainedRoot, retainedParent)) {
    throw new Error('Project parent escapes the retained project root')
  }
  const canonicalParent = await realpath(retainedParent)
  if (!isWithin(canonicalRoot, canonicalParent)) {
    throw new Error('Project parent symlink escapes the retained project root')
  }
  const parentStats = await lstat(canonicalParent)
  if (!parentStats.isDirectory()) {
    throw new Error('Project parent is not a directory')
  }
  return retainedParent
}

function fileNameFromIntent(name: string): string {
  assertSafeSegment(name, 'Project entry name')
  return name.toLowerCase().endsWith('.md') ? name : `${name}.md`
}

function entryMetadata(
  pathname: string,
  name: string,
  kind: ProjectCreateIntent['kind']
): ProjectEntryMetadata {
  return Object.freeze({
    pathname,
    name,
    isFile: kind === 'file',
    isDirectory: kind === 'directory',
    isMarkdown: kind === 'file'
  })
}

/**
 * Resolve and create one entry under the main-retained project root.
 *
 * File creation is exclusive. Admission is part of the same transaction:
 * failure removes the new empty file before the error is returned.
 */
export async function createProjectEntry({
  root,
  intent,
  admitFile
}: CreateProjectEntryOptions): Promise<ProjectCreateReceipt> {
  const parent = await resolveRetainedParent(root, intent.parentSegments)
  const name = intent.kind === 'file'
    ? fileNameFromIntent(intent.name)
    : (assertSafeSegment(intent.name, 'Project entry name'), intent.name)
  const pathname = path.join(parent, name)

  if (intent.kind === 'directory') {
    await mkdir(pathname)
    return Object.freeze({
      schema: 'project-create-receipt-1',
      kind: 'directory',
      entry: entryMetadata(pathname, name, 'directory')
    })
  }

  const handle = await open(pathname, 'wx')
  await handle.close()
  try {
    await admitFile(pathname)
  } catch (error) {
    try {
      await unlink(pathname)
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Document admission failed and project-create rollback failed for ${pathname}`
      )
    }
    throw error
  }
  return Object.freeze({
    schema: 'project-create-receipt-1',
    kind: 'file',
    entry: entryMetadata(pathname, name, 'file')
  })
}

import path from 'node:path'
import { realpath, stat } from 'node:fs/promises'

const MARKDOWN_DOCUMENT_EXTENSIONS = new Set([
  '.markdown',
  '.mdown',
  '.mkdn',
  '.md',
  '.mkd',
  '.mdwn',
  '.mdtxt',
  '.mdtext',
  '.mdx'
])

export interface ProjectDocumentOpenAuthorityOptions {
  readonly root: string | null
  readonly candidatePath: string
  readonly findOpenedPath: (candidatePath: string) => string | null
}

export type ProjectDocumentOpenAuthorization =
  | {
    readonly kind: 'admit'
    readonly pathname: string
  }
  | {
    readonly kind: 'select-existing'
    readonly pathname: string
  }

function isContainedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative !== '' &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  )
}

function selectedExisting(
  pathname: string | null
): ProjectDocumentOpenAuthorization | null {
  return pathname === null
    ? null
    : Object.freeze({
      kind: 'select-existing',
      pathname
    })
}

/**
 * Turn one renderer-selected path into a main-owned admission decision.
 *
 * An exact already-admitted document can be selected even when it is external
 * to the project. New reads are limited to regular Markdown documents beneath
 * the canonical retained project root, including symlink resolution.
 */
export async function authorizeProjectDocumentOpen({
  root,
  candidatePath,
  findOpenedPath
}: ProjectDocumentOpenAuthorityOptions): Promise<ProjectDocumentOpenAuthorization> {
  const existing = selectedExisting(findOpenedPath(candidatePath))
  if (existing !== null) return existing
  if (!path.isAbsolute(candidatePath)) {
    throw new Error('Project document candidate must be an absolute path')
  }
  if (root === null) {
    throw new Error(
      'Project document admission requires a retained project root'
    )
  }

  const canonicalRoot = await realpath(root)
  const rootStats = await stat(canonicalRoot)
  if (!rootStats.isDirectory()) {
    throw new Error('Retained project root is not a directory')
  }
  const canonicalCandidate = await realpath(candidatePath)
  if (!isContainedBy(canonicalRoot, canonicalCandidate)) {
    throw new Error('Project document escapes the retained project root')
  }
  if (
    !MARKDOWN_DOCUMENT_EXTENSIONS.has(
      path.extname(canonicalCandidate).toLowerCase()
    )
  ) {
    throw new Error('Project document is not a Markdown file')
  }
  const candidateStats = await stat(canonicalCandidate)
  if (!candidateStats.isFile()) {
    throw new Error('Project document is not a regular file')
  }

  const canonicalExisting = selectedExisting(
    findOpenedPath(canonicalCandidate)
  )
  if (canonicalExisting !== null) return canonicalExisting
  return Object.freeze({
    kind: 'admit',
    pathname: canonicalCandidate
  })
}

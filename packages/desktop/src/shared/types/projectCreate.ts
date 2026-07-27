export type ProjectCreateKind = 'file' | 'directory'

/**
 * Renderer intent only. The main process retains the project root, resolves
 * these relative directory names beneath it, and owns the resulting path.
 */
export interface ProjectCreateIntent {
  readonly schema: 'project-create-intent-1'
  readonly kind: ProjectCreateKind
  readonly parentSegments: readonly string[]
  readonly name: string
}

export interface ProjectEntryMetadata {
  readonly pathname: string
  readonly name: string
  readonly isFile: boolean
  readonly isDirectory: boolean
  readonly isMarkdown: boolean
}

export interface ProjectCreateReceipt {
  readonly schema: 'project-create-receipt-1'
  readonly kind: ProjectCreateKind
  readonly entry: ProjectEntryMetadata
}

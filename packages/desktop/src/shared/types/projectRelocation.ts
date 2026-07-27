import type { DocumentCorePathReceipt } from './documentCore'
import type {
  ProjectCreateKind,
  ProjectEntryMetadata
} from './projectCreate'

/**
 * Renderer intent names one already-visible project entry by safe path
 * segments. Main resolves those segments beneath its retained project root.
 */
export interface ProjectRelocateIntent {
  readonly schema: 'project-relocate-intent-1'
  readonly kind: ProjectCreateKind
  readonly entrySegments: readonly string[]
  readonly targetParentSegments: readonly string[]
  readonly newName: string
}

export interface ProjectRelocateReceipt {
  readonly schema: 'project-relocate-receipt-1'
  readonly kind: ProjectCreateKind
  readonly previousPathname: string
  readonly entry: ProjectEntryMetadata
  readonly document: DocumentCorePathReceipt | null
}

import type {
  ProjectCreateKind,
  ProjectEntryMetadata
} from './projectCreate'

export interface ProjectCopyIntent {
  readonly schema: 'project-copy-intent-1'
  readonly kind: ProjectCreateKind
  readonly entrySegments: readonly string[]
  readonly targetParentSegments: readonly string[]
}

export interface ProjectCopyReceipt {
  readonly schema: 'project-copy-receipt-1'
  readonly kind: ProjectCreateKind
  readonly sourcePathname: string
  readonly entry: ProjectEntryMetadata
}

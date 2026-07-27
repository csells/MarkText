import type {
  ProjectCreateKind
} from './projectCreate'

export interface ProjectDeleteIntent {
  readonly schema: 'project-delete-intent-1'
  readonly kind: ProjectCreateKind
  readonly entrySegments: readonly string[]
}

export interface ProjectDeleteReceipt {
  readonly schema: 'project-delete-receipt-1'
  readonly kind: ProjectCreateKind
  readonly pathname: string
}

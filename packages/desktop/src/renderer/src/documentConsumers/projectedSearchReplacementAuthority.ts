import type { DocumentSaveIdentity } from '@shared/types/files'

import type { EditorCoreApplyOutcome } from '@/documentAuthority/editorCoreBinding'
import {
  createProjectedSearchReplacementPlan,
  type ProjectedSearchOptions,
  type ProjectedSearchResult,
  type ProjectedSearchReplacementOptions
} from './documentProjectionConsumers'
import type { CoreConsumerSearchReplacement } from '@/documentAuthority/coreProtocol'

export interface ProjectedSearchSnapshot {
  readonly identity: DocumentSaveIdentity
  readonly result: ProjectedSearchResult
  readonly options: ProjectedSearchOptions
}

export interface ProjectedSearchReplacementInput {
  readonly snapshot: ProjectedSearchSnapshot
  readonly value: string
  readonly options: ProjectedSearchReplacementOptions
  settle(): Promise<void>
  isCurrent(): boolean
  replace(
    identity: DocumentSaveIdentity,
    replacements: readonly CoreConsumerSearchReplacement[]
  ): Promise<EditorCoreApplyOutcome>
}

/** Settles the editor lane before dispatching one exact cached search identity. */
export async function executeProjectedSearchReplacement(
  input: ProjectedSearchReplacementInput
): Promise<EditorCoreApplyOutcome | undefined> {
  const replacements = createProjectedSearchReplacementPlan(
    input.snapshot.result,
    input.value,
    input.options
  )
  if (replacements === undefined) return undefined
  await input.settle()
  if (!input.isCurrent()) return undefined
  return input.replace(input.snapshot.identity, replacements)
}

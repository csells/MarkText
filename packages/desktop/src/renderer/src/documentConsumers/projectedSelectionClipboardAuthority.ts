import {
  copyDocumentSelection,
  type DocumentTableSelection,
  type DocumentModelTextSelection,
  type SourceRange
} from '@marktext/document-core'
import isEqual from 'lodash/isEqual'
import {
  createProjectedClipboardPayload,
  type DocumentConsumerProjection,
  type ProjectedClipboardFlavor,
  type ProjectedClipboardPayload
} from './documentProjectionConsumers'

export type ProjectedClipboardSelection = Readonly<{
  readonly range: SourceRange | DocumentTableSelection | DocumentModelTextSelection
  readonly revision: number
}>

export interface ProjectedSelectionClipboardAuthorityInput {
  settle(): Promise<void>
  currentSelection(): ProjectedClipboardSelection | undefined
  selectionProjectionAtBarrier(
    range: SourceRange | DocumentTableSelection | DocumentModelTextSelection
  ): Promise<DocumentConsumerProjection>
}

export interface ProjectedSelectionClipboardAuthority {
  prepare(flavor: ProjectedClipboardFlavor): Promise<ProjectedClipboardPayload | undefined>
  payload(): ProjectedClipboardPayload | undefined
  reset(): void
}

export function createProjectedSelectionClipboardAuthority(
  input: ProjectedSelectionClipboardAuthorityInput
): ProjectedSelectionClipboardAuthority {
  let generation = 0
  let current: ProjectedClipboardPayload | undefined
  let prepared: ProjectedClipboardSelection | undefined
  const matches = (selection: ProjectedClipboardSelection | undefined): boolean => {
    const live = input.currentSelection()
    return (
      selection !== undefined &&
      live !== undefined &&
      selection.revision === live.revision &&
      isEqual(selection.range, live.range)
    )
  }
  return Object.freeze({
    async prepare(
      flavor: ProjectedClipboardFlavor
    ): Promise<ProjectedClipboardPayload | undefined> {
      generation += 1
      const activeGeneration = generation
      current = undefined
      prepared = undefined
      const live = input.currentSelection()
      const selection =
        live === undefined
          ? undefined
          : Object.freeze({
            revision: live.revision,
            range:
                'kind' in live.range
                  ? (copyDocumentSelection(live.range, Number.MAX_SAFE_INTEGER) as
                      | DocumentTableSelection
                      | DocumentModelTextSelection)
                  : Object.freeze({ ...live.range })
          })
      if (selection === undefined) return undefined
      await input.settle()
      if (activeGeneration !== generation || !matches(selection)) return undefined
      const projection = await input.selectionProjectionAtBarrier(selection.range)
      if (activeGeneration !== generation || !matches(selection)) return undefined
      prepared = selection
      current = createProjectedClipboardPayload(projection, flavor, {
        kind: 'selection',
        projection
      })
      return current
    },
    payload(): ProjectedClipboardPayload | undefined {
      return matches(prepared) ? current : undefined
    },
    reset(): void {
      generation += 1
      current = undefined
      prepared = undefined
    }
  })
}

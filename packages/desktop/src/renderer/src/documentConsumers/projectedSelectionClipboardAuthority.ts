import {
  createProjectedClipboardPayload,
  type DocumentConsumerProjection,
  type ProjectedClipboardFlavor,
  type ProjectedClipboardPayload
} from './documentProjectionConsumers'

export type ProjectedClipboardSelection = Readonly<{
  readonly anchor: Readonly<{
    readonly path: readonly (string | number)[]
    readonly offset: number
  }>
  readonly focus: Readonly<{
    readonly path: readonly (string | number)[]
    readonly offset: number
  }>
}>

export interface ProjectedSelectionClipboardAuthorityInput {
  settle(): Promise<void>
  selectionSourceRange(
    selection: ProjectedClipboardSelection
  ): Readonly<{ readonly start: number; readonly end: number }> | undefined
  selectionProjectionAtBarrier(
    range: Readonly<{ readonly start: number; readonly end: number }>
  ): Promise<DocumentConsumerProjection>
}

export interface ProjectedSelectionClipboardAuthority {
  prepare(
    selection: ProjectedClipboardSelection,
    flavor: ProjectedClipboardFlavor
  ): Promise<ProjectedClipboardPayload | undefined>
  payload(): ProjectedClipboardPayload | undefined
  reset(): void
}

export function createProjectedSelectionClipboardAuthority(
  input: ProjectedSelectionClipboardAuthorityInput
): ProjectedSelectionClipboardAuthority {
  let generation = 0
  let current: ProjectedClipboardPayload | undefined
  return Object.freeze({
    async prepare(
      selection: ProjectedClipboardSelection,
      flavor: ProjectedClipboardFlavor
    ): Promise<ProjectedClipboardPayload | undefined> {
      generation += 1
      const activeGeneration = generation
      current = undefined
      await input.settle()
      if (activeGeneration !== generation) return undefined
      const range = input.selectionSourceRange(selection)
      if (range === undefined) return undefined
      const projection = await input.selectionProjectionAtBarrier(range)
      if (activeGeneration !== generation) return undefined
      current = createProjectedClipboardPayload(
        projection,
        flavor,
        { kind: 'selection', projection }
      )
      return current
    },
    payload(): ProjectedClipboardPayload | undefined {
      return current
    },
    reset(): void {
      generation += 1
      current = undefined
    }
  })
}

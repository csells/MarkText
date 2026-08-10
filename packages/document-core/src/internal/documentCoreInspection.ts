export interface DocumentCoreInspection {
  readonly intrinsicSourceUnits: number
}

const READERS = new WeakMap<
  object,
  () => DocumentCoreInspection
>()

/** Package-private negative control for incremental parser tests. */
export function registerDocumentCoreInspection(
  core: object,
  reader: () => DocumentCoreInspection
): void {
  READERS.set(core, reader)
}

export function inspectDocumentCore(core: object): DocumentCoreInspection {
  const reader = READERS.get(core)
  if (reader === undefined) {
    throw new Error('Document core inspection is unavailable')
  }
  return Object.freeze({ ...reader() })
}

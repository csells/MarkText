import type { CriticMarkupAnnotation, DocumentRevision } from '../documentCore.js'

type Reader = (revision: DocumentRevision, position: number) => readonly CriticMarkupAnnotation[]

const readers = new WeakMap<object, Reader>()

/** Package-private: lets planners read a revision's annotations near a position. */
export function registerAnnotationsAround(core: object, reader: Reader): void {
  readers.set(core, reader)
}

/**
 * Root annotations of the blocks around `position`, in document order, with
 * the root that directly follows them: enough to find what holds or touches
 * `position` without materializing every annotation of a large revision.
 */
export function annotationsAround(core: object, revision: DocumentRevision, position: number): readonly CriticMarkupAnnotation[] {
  return readers.get(core)?.(revision, position) ?? revision.annotations
}

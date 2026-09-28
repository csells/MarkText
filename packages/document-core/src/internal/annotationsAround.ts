import type { CriticMarkupAnnotation, DocumentRevision, SourceRange } from '../documentCore.js'

type Readers = Readonly<{
  around: (revision: DocumentRevision, position: number) => readonly CriticMarkupAnnotation[]
  overlapping: (revision: DocumentRevision, range: SourceRange) => readonly CriticMarkupAnnotation[]
}>

const readers = new WeakMap<object, Readers>()

/** Package-private: lets planners read a revision's annotations near a position or range. */
export function registerAnnotationsAround(core: object, value: Readers): void {
  readers.set(core, value)
}

/**
 * Root annotations of the blocks around `position`, in document order, with
 * the root that directly follows them: enough to find what holds or touches
 * `position` without materializing every annotation of a large revision.
 */
export function annotationsAround(core: object, revision: DocumentRevision, position: number): readonly CriticMarkupAnnotation[] {
  return readers.get(core)?.around(revision, position) ?? revision.annotations
}

/**
 * Root annotations of the blocks `range` touches, in document order: every
 * annotation that overlaps or touches `range` comes with its root.
 */
export function annotationsOverlapping(core: object, revision: DocumentRevision, range: SourceRange): readonly CriticMarkupAnnotation[] {
  return readers.get(core)?.overlapping(revision, range) ?? revision.annotations
}

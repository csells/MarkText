import type {
  CriticMarkupForest,
  CriticMarkupNode,
  MarkupProjection,
  MarkupProjectionRun
} from '@marktext/document-core'

// Array views over the public count/at accessors, for specs that iterate or
// pattern-match whole collections. The public revision no longer promises
// array-ness (design obligation 1: the backing store must stay swappable).
export function rootsOf(forest: CriticMarkupForest): readonly CriticMarkupNode[] {
  return Array.from({ length: forest.rootCount }, (_, ordinal) =>
    forest.rootAt(ordinal))
}

export function runsOf(projection: MarkupProjection): readonly MarkupProjectionRun[] {
  return Array.from({ length: projection.runCount }, (_, ordinal) =>
    projection.runAt(ordinal))
}

declare const sourceHashBrand: unique symbol
declare const revisionSemanticHashBrand: unique symbol

/** Transitional internal identities retained by the research revision type. */
export type SourceHashV1 = string & {
  readonly [sourceHashBrand]: 'SourceHashV1'
}

export type RevisionSemanticHashV1 = string & {
  readonly [revisionSemanticHashBrand]: 'RevisionSemanticHashV1'
}

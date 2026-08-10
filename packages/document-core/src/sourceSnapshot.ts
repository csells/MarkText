export interface SourceSnapshot {
  /** Exact decoded UTF-16 source. */
  readonly text: string
}

export function createSourceSnapshot(text: string): SourceSnapshot {
  return Object.freeze({ text })
}

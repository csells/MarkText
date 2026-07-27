export type ProjectSearchMode = 'text' | 'files'

export interface ProjectSearchRequestOptions {
  readonly isRegexp?: boolean
  readonly isCaseSensitive?: boolean
  readonly isWholeWord?: boolean
  readonly leadingContextLineCount?: number
  readonly trailingContextLineCount?: number
  readonly inclusions?: readonly string[]
}

/**
 * Renderer search intent. It deliberately contains no path, executable,
 * process identifier, search identifier, exclusion policy, or symlink policy.
 * Main supplies all filesystem authority from the sender's retained project.
 */
export interface ProjectSearchRequest {
  readonly schema: 'project-search-request-1'
  readonly mode: ProjectSearchMode
  readonly pattern: string
  readonly options: ProjectSearchRequestOptions
}

export interface ProjectSearchStartReceipt {
  readonly searchId: string
}

export interface ProjectSearchTextMatch {
  readonly matchText: string
  readonly lineText: string
  readonly range: readonly [
    readonly [number, number],
    readonly [number, number]
  ]
  readonly leadingContextLines: readonly unknown[]
  readonly trailingContextLines: readonly unknown[]
}

export interface ProjectSearchTextResult {
  readonly filePath: string
  readonly matches: readonly ProjectSearchTextMatch[]
}

export interface ProjectSearchMatchEnvelope {
  readonly searchId: string
  readonly payload: string | ProjectSearchTextResult | null
}

export interface ProjectSearchProgressEnvelope {
  readonly searchId: string
  readonly num: number
}

export interface ProjectSearchTerminalEnvelope {
  readonly searchId: string
}

export interface ProjectSearchErrorEnvelope {
  readonly searchId: string
  readonly error: string
}

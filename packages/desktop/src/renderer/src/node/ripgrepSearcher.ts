import type {
  ProjectSearchErrorEnvelope,
  ProjectSearchMatchEnvelope,
  ProjectSearchMode,
  ProjectSearchProgressEnvelope,
  ProjectSearchRequest,
  ProjectSearchRequestOptions,
  ProjectSearchTerminalEnvelope
} from '@shared/types/projectSearch'

export interface RipgrepSearchOptions extends ProjectSearchRequestOptions {
  readonly didMatch?: (payload: unknown) => void
  readonly didSearchPaths?: (num: number) => void
}

export interface CancellableSearch extends Promise<void> {
  cancel: () => void
}

interface StartArgs {
  readonly mode: ProjectSearchMode
  readonly pattern: string
  readonly options: RipgrepSearchOptions
}

type SearchEvent =
  | { readonly kind: 'match'; readonly value: ProjectSearchMatchEnvelope }
  | { readonly kind: 'progress'; readonly value: ProjectSearchProgressEnvelope }
  | { readonly kind: 'done'; readonly value: ProjectSearchTerminalEnvelope }
  | { readonly kind: 'error'; readonly value: ProjectSearchErrorEnvelope }
  | { readonly kind: 'cancelled'; readonly value: ProjectSearchTerminalEnvelope }

function serializableOptions(
  options: RipgrepSearchOptions
): ProjectSearchRequestOptions {
  return Object.freeze({
    ...(options.isRegexp === undefined
      ? {}
      : { isRegexp: options.isRegexp }),
    ...(options.isCaseSensitive === undefined
      ? {}
      : { isCaseSensitive: options.isCaseSensitive }),
    ...(options.isWholeWord === undefined
      ? {}
      : { isWholeWord: options.isWholeWord }),
    ...(options.leadingContextLineCount === undefined
      ? {}
      : { leadingContextLineCount: options.leadingContextLineCount }),
    ...(options.trailingContextLineCount === undefined
      ? {}
      : { trailingContextLineCount: options.trailingContextLineCount }),
    ...(options.inclusions === undefined
      ? {}
      : { inclusions: Object.freeze([...options.inclusions]) })
  })
}

const startSearch = ({
  mode,
  pattern,
  options
}: StartArgs): CancellableSearch => {
  const didMatch = options.didMatch || ((): void => {})
  const didSearchPaths = options.didSearchPaths || ((): void => {})
  const request: ProjectSearchRequest = Object.freeze({
    schema: 'project-search-request-1',
    mode,
    pattern,
    options: serializableOptions(options)
  })

  let searchId: string | null = null
  let cancelled = false
  let settled = false
  let earlyEvents: SearchEvent[] = []
  let cleanup = (): void => {}

  const promise = new Promise<void>((resolve, reject) => {
    let offMatch: (() => void) | null = null
    let offProgress: (() => void) | null = null
    let offDone: (() => void) | null = null
    let offError: (() => void) | null = null
    let offCancelled: (() => void) | null = null

    cleanup = (): void => {
      if (offMatch) offMatch()
      if (offProgress) offProgress()
      if (offDone) offDone()
      if (offError) offError()
      if (offCancelled) offCancelled()
      offMatch = offProgress = offDone = offError = offCancelled = null
      earlyEvents = []
    }

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }

    // mt::rg::match and mt::rg::done are separate channels with no
    // cross-channel ordering guarantee, so completion resolves only once
    // every match the terminal envelope promised has been received —
    // otherwise a done that overtakes queued deliveries silently truncates
    // the result (G28). Cancellation abandons the stream deliberately.
    let matchesReceived = 0
    let promisedMatches: number | null = null
    const finishIfStreamComplete = (): void => {
      if (promisedMatches !== null && matchesReceived >= promisedMatches) {
        finish()
      }
    }
    const deliver = (event: SearchEvent): void => {
      if (searchId === null) {
        earlyEvents.push(event)
        return
      }
      if (event.value.searchId !== searchId) return
      if (event.kind === 'match') {
        matchesReceived += 1
        try {
          didMatch(event.value.payload)
        } catch (error) {
          console.error(error)
        }
        finishIfStreamComplete()
      } else if (event.kind === 'progress') {
        try {
          didSearchPaths(event.value.num)
        } catch (error) {
          console.error(error)
        }
      } else if (event.kind === 'error') {
        finish(new Error(event.value.error || 'Project search failed'))
      } else if (event.kind === 'done') {
        promisedMatches = event.value.matchCount
        finishIfStreamComplete()
      } else {
        finish()
      }
    }

    offMatch = window.ripgrep.onMatch(payload =>
      deliver({ kind: 'match', value: payload }))
    offProgress = window.ripgrep.onProgress(payload =>
      deliver({ kind: 'progress', value: payload }))
    offDone = window.ripgrep.onDone(payload =>
      deliver({ kind: 'done', value: payload }))
    offError = window.ripgrep.onError(payload =>
      deliver({ kind: 'error', value: payload }))
    offCancelled = window.ripgrep.onCancelled(payload =>
      deliver({ kind: 'cancelled', value: payload }))

    window.ripgrep.start(request)
      .then(receipt => {
        searchId = receipt.searchId
        const pending = earlyEvents
        earlyEvents = []
        for (const event of pending) deliver(event)
        if (cancelled && !settled) window.ripgrep.cancel(searchId)
      })
      .catch(error => {
        finish(error instanceof Error ? error : new Error(String(error)))
      })
  }) as CancellableSearch

  promise.cancel = (): void => {
    if (cancelled || settled) return
    cancelled = true
    if (searchId !== null) window.ripgrep.cancel(searchId)
  }
  return promise
}

export default class RipgrepDirectorySearcher {
  search(
    pattern: string,
    options: RipgrepSearchOptions
  ): CancellableSearch {
    return startSearch({ mode: 'text', pattern, options })
  }
}

export class FileSearcher {
  search(options: RipgrepSearchOptions): CancellableSearch {
    return startSearch({ mode: 'files', pattern: '', options })
  }
}

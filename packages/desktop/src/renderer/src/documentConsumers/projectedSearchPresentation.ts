import type {
  ProjectedSearchMatch,
  ProjectedSearchResult
} from './documentProjectionConsumers'

export interface ProjectedSearchPresentationBlock {
  update(
    cursor?: unknown,
    highlights?: readonly Readonly<{
      readonly start: number
      readonly end: number
      readonly active: boolean
    }>[]
  ): void
  focusHandler(): void
  blurHandler(): void
  readonly parent?: Readonly<{ readonly active?: boolean }>
}

export interface ProjectedSearchPresentationHost {
  blockAtPath(
    path: readonly (number | string)[]
  ): ProjectedSearchPresentationBlock | undefined
}

export interface ProjectedSearchPresentation {
  present(result: ProjectedSearchResult): boolean
  navigate(action: 'next' | 'previous'): ProjectedSearchResult
  clear(): void
}

type ResolvedMatch = Readonly<{
  readonly match: ProjectedSearchMatch
  readonly block: ProjectedSearchPresentationBlock
  readonly presentation: NonNullable<ProjectedSearchMatch['presentation']>
}>

const emptyResult = (): ProjectedSearchResult => Object.freeze({
  index: -1,
  matches: Object.freeze([]),
  value: ''
})

/**
 * Paints Core-owned semantic search offsets into Muya's presentation blocks.
 * The one proven mapping is a top-level projected block `[n]` to `[n, text]`;
 * nested AST paths fail closed. No renderer text or Markdown is observed.
 */
export function createProjectedSearchPresentation(
  host: ProjectedSearchPresentationHost
): ProjectedSearchPresentation {
  let current = emptyResult()
  let painted = new Set<ProjectedSearchPresentationBlock>()

  const clearPaint = (): void => {
    for (const block of painted) block.update(undefined, [])
    painted = new Set()
  }
  const failClosed = (): false => {
    clearPaint()
    current = emptyResult()
    return false
  }

  const present = (result: ProjectedSearchResult): boolean => {
    const resolved: ResolvedMatch[] = []
    for (const match of result.matches) {
      const blockIndex = match.path[0]
      const presentation = match.presentation
      if (
        match.path.length !== 1 || typeof blockIndex !== 'number' ||
        !Number.isSafeInteger(blockIndex) || blockIndex < 0 ||
        presentation === undefined || presentation.path.length !== 2 ||
        presentation.path[0] !== blockIndex ||
        presentation.path[1] !== 'text' ||
        !Number.isSafeInteger(presentation.start) ||
        !Number.isSafeInteger(presentation.end) ||
        presentation.start < 0 || presentation.end <= presentation.start
      ) return failClosed()
      const block = host.blockAtPath(presentation.path)
      if (block === undefined) return failClosed()
      resolved.push(Object.freeze({ match, block, presentation }))
    }

    clearPaint()
    current = result
    const highlights = new Map<
      ProjectedSearchPresentationBlock,
      Array<Readonly<{ start: number; end: number; active: boolean }>>
    >()
    for (const [index, item] of resolved.entries()) {
      const list = highlights.get(item.block) ?? []
      list.push(Object.freeze({
        start: item.presentation.start,
        end: item.presentation.end,
        active: index === result.index
      }))
      highlights.set(item.block, list)
    }
    for (const [block, blockHighlights] of highlights) {
      block.update(undefined, Object.freeze(blockHighlights))
      if (blockHighlights.some(highlight => highlight.active)) {
        block.focusHandler()
      } else if (block.parent?.active === true) {
        block.blurHandler()
      }
      painted.add(block)
    }
    return true
  }

  return Object.freeze({
    present,
    navigate(action: 'next' | 'previous'): ProjectedSearchResult {
      const length = current.matches.length
      if (length === 0) return current
      const delta = action === 'next' ? 1 : -1
      const index = (current.index + delta + length) % length
      const result = Object.freeze({ ...current, index })
      present(result)
      return result
    },
    clear(): void {
      clearPaint()
      current = emptyResult()
    }
  })
}

import type {
  ProjectedSearchMatch,
  ProjectedSearchResult
} from './documentProjectionConsumers'
import type { MuyaPlainTextSourceBinding } from '../documentAuthority/muyaPlainTextSourceEdit'
import type { MuyaPlainTextAuthorSelection } from '../documentAuthority/muyaPlainTextCoreAdapter'

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
  /** A Core Markup host must map canonical match pieces through current leaves. */
  bindings?(): readonly MuyaPlainTextSourceBinding[]
  blockAtPath(
    path: readonly (number | string)[]
  ): ProjectedSearchPresentationBlock | undefined
}

export interface ProjectedSearchPresentation {
  present(result: ProjectedSearchResult): boolean
  navigate(action: 'next' | 'previous'): ProjectedSearchResult
  selection(): MuyaPlainTextAuthorSelection | undefined
  clear(): void
}

type ResolvedMatch = Readonly<{
  readonly matchIndex: number
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
 * Paints canonical match pieces through current Markup source bindings. Hosts
 * without source bindings retain the legacy top-level projection mapping.
 * No renderer text or Markdown is observed.
 */
export function createProjectedSearchPresentation(
  host: ProjectedSearchPresentationHost
): ProjectedSearchPresentation {
  let current = emptyResult()
  let painted = new Set<ProjectedSearchPresentationBlock>()
  let activeSelection: MuyaPlainTextAuthorSelection | undefined

  const clearPaint = (): void => {
    for (const block of painted) block.update(undefined, [])
    painted = new Set()
  }
  const failClosed = (): false => {
    clearPaint()
    current = emptyResult()
    activeSelection = undefined
    return false
  }

  const present = (result: ProjectedSearchResult): boolean => {
    const resolved: ResolvedMatch[] = []
    const bindings = host.bindings?.()
    for (const [matchIndex, match] of result.matches.entries()) {
      if (bindings !== undefined) {
        if (match.sourceRanges === undefined || match.sourceRanges.length === 0) return failClosed()
        for (const range of match.sourceRanges) {
          let cursor = range.start
          for (const binding of bindings) {
            for (const segment of binding.segments ?? [{ source: binding.sourceRange, text: { start: 0, end: binding.text.length } }]) {
              if (segment.source.end <= cursor || segment.source.start >= range.end) continue
              if (segment.source.start > cursor) return failClosed()
              const end = Math.min(range.end, segment.source.end)
              const block = host.blockAtPath(binding.path)
              if (block === undefined) return failClosed()
              const presentation = {
                path: binding.path,
                start: segment.text.start + cursor - segment.source.start,
                end: segment.text.start + end - segment.source.start
              }
              const previous = resolved.at(-1)
              if (previous?.matchIndex === matchIndex && previous.block === block && previous.presentation.end === presentation.start) {
                resolved[resolved.length - 1] = { ...previous, presentation: { ...previous.presentation, end: presentation.end } }
              } else resolved.push({ matchIndex, match, block, presentation })
              cursor = end
              if (cursor === range.end) break
            }
            if (cursor === range.end) break
          }
          if (cursor !== range.end) return failClosed()
        }
        continue
      }
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
      resolved.push(Object.freeze({ matchIndex, match, block, presentation }))
    }

    clearPaint()
    current = result
    const active = resolved.filter(item => item.matchIndex === result.index)
    const first = active[0]?.presentation
    const last = active.at(-1)?.presentation
    activeSelection = first === undefined || last === undefined
      ? undefined
      : {
        anchor: { path: first.path, offset: first.start },
        focus: { path: last.path, offset: last.end }
      }
    const highlights = new Map<
      ProjectedSearchPresentationBlock,
      Array<Readonly<{ start: number; end: number; active: boolean }>>
    >()
    for (const item of resolved) {
      const list = highlights.get(item.block) ?? []
      list.push(Object.freeze({
        start: item.presentation.start,
        end: item.presentation.end,
        active: item.matchIndex === result.index
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
    selection: () => activeSelection,
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
      activeSelection = undefined
    }
  })
}

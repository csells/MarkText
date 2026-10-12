import type { ProjectedSearchMatch, ProjectedSearchResult } from './documentProjectionConsumers'
import type { MuyaPlainTextSourceBinding } from '../documentAuthority/muyaSourceBinding'
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
  blockAtPath(path: readonly (number | string)[]): ProjectedSearchPresentationBlock | undefined
}

export interface ProjectedSearchPresentation {
  present(result: ProjectedSearchResult): boolean
  navigate(action: 'next' | 'previous'): ProjectedSearchResult
  /** Paints the current result again on blocks the host has re-created. */
  repaint(): boolean
  selection(): MuyaPlainTextAuthorSelection | undefined
  clear(): void
}

type ResolvedMatch = Readonly<{
  readonly matchIndex: number
  readonly match: ProjectedSearchMatch
  readonly block: ProjectedSearchPresentationBlock
  readonly presentation: NonNullable<ProjectedSearchMatch['presentation']>
}>

const emptyResult = (): ProjectedSearchResult =>
  Object.freeze({
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
  // The matches the last present() resolved, and the bindings they were
  // resolved through, so stepping can repaint only the blocks it changes.
  let resolvedCurrent: readonly ResolvedMatch[] = []
  let resolvedBindings: readonly MuyaPlainTextSourceBinding[] | undefined

  const clearPaint = (): void => {
    for (const block of painted) block.update(undefined, [])
    painted = new Set()
  }
  const failClosed = (): false => {
    clearPaint()
    current = emptyResult()
    activeSelection = undefined
    resolvedCurrent = []
    resolvedBindings = undefined
    return false
  }

  const resolve = (
    result: ProjectedSearchResult,
    bindings: readonly MuyaPlainTextSourceBinding[] | undefined
  ): ResolvedMatch[] | undefined => {
    const resolved: ResolvedMatch[] = []
    for (const [matchIndex, match] of result.matches.entries()) {
      if (bindings !== undefined) {
        if (match.sourceRanges === undefined || match.sourceRanges.length === 0) return undefined
        for (const range of match.sourceRanges) {
          let cursor = range.start
          for (const binding of bindings) {
            for (const segment of binding.segments ?? [
              { source: binding.sourceRange, text: { start: 0, end: binding.text.length } }
            ]) {
              if (segment.source.end <= cursor || segment.source.start >= range.end) continue
              if (segment.source.start > cursor) return undefined
              const end = Math.min(range.end, segment.source.end)
              const block = host.blockAtPath(binding.path)
              if (block === undefined) return undefined
              const presentation = {
                path: binding.path,
                start: segment.text.start + cursor - segment.source.start,
                end: segment.text.start + end - segment.source.start
              }
              const previous = resolved.at(-1)
              if (
                previous?.matchIndex === matchIndex &&
                previous.block === block &&
                previous.presentation.end === presentation.start
              ) {
                resolved[resolved.length - 1] = {
                  ...previous,
                  presentation: { ...previous.presentation, end: presentation.end }
                }
              } else resolved.push({ matchIndex, match, block, presentation })
              cursor = end
              if (cursor === range.end) break
            }
            if (cursor === range.end) break
          }
          if (cursor !== range.end) return undefined
        }
        continue
      }
      const blockIndex = match.path[0]
      const presentation = match.presentation
      if (
        match.path.length !== 1 ||
        typeof blockIndex !== 'number' ||
        !Number.isSafeInteger(blockIndex) ||
        blockIndex < 0 ||
        presentation === undefined ||
        presentation.path.length !== 2 ||
        presentation.path[0] !== blockIndex ||
        presentation.path[1] !== 'text' ||
        !Number.isSafeInteger(presentation.start) ||
        !Number.isSafeInteger(presentation.end) ||
        presentation.start < 0 ||
        presentation.end <= presentation.start
      ) {
        return undefined
      }
      const block = host.blockAtPath(presentation.path)
      if (block === undefined) return undefined
      resolved.push(Object.freeze({ matchIndex, match, block, presentation }))
    }
    return resolved
  }

  /**
   * Paints `result`'s highlights on the blocks in `only`, or on every block
   * holding a match. A block's update replaces all of its highlights, so a
   * repainted block needs no clearing first.
   */
  const paint = (
    result: ProjectedSearchResult,
    resolved: readonly ResolvedMatch[],
    only?: ReadonlySet<ProjectedSearchPresentationBlock>
  ): void => {
    current = result
    const active = resolved.filter((item) => item.matchIndex === result.index)
    const first = active[0]?.presentation
    const last = active.at(-1)?.presentation
    activeSelection =
      first === undefined || last === undefined
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
      if (only !== undefined && !only.has(item.block)) continue
      const list = highlights.get(item.block) ?? []
      list.push(
        Object.freeze({
          start: item.presentation.start,
          end: item.presentation.end,
          active: item.matchIndex === result.index
        })
      )
      highlights.set(item.block, list)
    }
    for (const [block, blockHighlights] of highlights) {
      block.update(undefined, Object.freeze(blockHighlights))
      if (blockHighlights.some((highlight) => highlight.active)) {
        block.focusHandler()
      } else if (block.parent?.active === true) {
        block.blurHandler()
      }
      painted.add(block)
    }
  }

  const present = (result: ProjectedSearchResult): boolean => {
    const bindings = host.bindings?.()
    const resolved = resolve(result, bindings)
    if (resolved === undefined) return failClosed()
    clearPaint()
    resolvedCurrent = resolved
    resolvedBindings = bindings
    paint(result, resolved)
    return true
  }

  /**
   * Moving the active match changes only the blocks holding the old and the
   * new one (upstream #5580), so only those repaint. Anything that may have
   * moved a match since present(), such as new bindings or a re-created
   * block, falls back to presenting the result whole.
   */
  const step = (result: ProjectedSearchResult): void => {
    const previousIndex = current.index
    const moved = resolvedCurrent.filter((item) =>
      item.matchIndex === previousIndex || item.matchIndex === result.index)
    if (
      host.bindings?.() !== resolvedBindings ||
      moved.some((item) => host.blockAtPath(item.presentation.path) !== item.block)
    ) {
      present(result)
      return
    }
    paint(result, resolvedCurrent, new Set(moved.map((item) => item.block)))
  }

  return Object.freeze({
    present,
    repaint: () => current.matches.length === 0 || present(current),
    selection: () => activeSelection,
    navigate(action: 'next' | 'previous'): ProjectedSearchResult {
      const length = current.matches.length
      if (length === 0) return current
      const delta = action === 'next' ? 1 : -1
      const index = (current.index + delta + length) % length
      const result = Object.freeze({ ...current, index })
      step(result)
      return result
    },
    clear(): void {
      clearPaint()
      current = emptyResult()
      activeSelection = undefined
      resolvedCurrent = []
      resolvedBindings = undefined
    }
  })
}

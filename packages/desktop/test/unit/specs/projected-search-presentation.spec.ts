import { describe, expect, it, vi } from 'vitest'

import {
  createProjectedSearchPresentation,
  type ProjectedSearchPresentationBlock
} from '@/documentConsumers/projectedSearchPresentation'

describe('projected search presentation', () => {
  it('paints AST-authoritative offsets without reading renderer block text', () => {
    const first = {
      update: vi.fn(),
      focusHandler: vi.fn(),
      blurHandler: vi.fn()
    } as ProjectedSearchPresentationBlock
    Object.defineProperty(first, 'text', {
      get: () => { throw new Error('renderer text must not be read') }
    })
    const second = {
      update: vi.fn(),
      focusHandler: vi.fn(),
      blurHandler: vi.fn()
    } as ProjectedSearchPresentationBlock
    const blockAtPath = vi.fn((path: readonly (number | string)[]) =>
      path[0] === 0 ? first : second
    )
    const presentation = createProjectedSearchPresentation({
      blockAtPath,
      isProvenMatch: () => true
    })

    presentation.present({
      index: 0,
      value: 'alpha',
      matches: [
        { path: [0], start: 0, end: 5, match: 'alpha', subMatches: [] },
        { path: [1], start: 6, end: 11, match: 'alpha', subMatches: [] }
      ]
    })

    expect(blockAtPath.mock.calls).toEqual([[[0, 'text']], [[1, 'text']]])
    expect(first.update).toHaveBeenLastCalledWith(undefined, [
      { start: 0, end: 5, active: true }
    ])
    expect(second.update).toHaveBeenLastCalledWith(undefined, [
      { start: 6, end: 11, active: false }
    ])
    expect(first.focusHandler).toHaveBeenCalledOnce()
  })

  it('wraps navigation and clears prior projection highlights', () => {
    const blocks = [0, 1].map(() => ({
      update: vi.fn(),
      focusHandler: vi.fn(),
      blurHandler: vi.fn()
    }))
    const presentation = createProjectedSearchPresentation({
      blockAtPath: path => blocks[path[0] as number],
      isProvenMatch: () => true
    })
    const result = {
      index: 0,
      value: 'x',
      matches: [
        { path: [0], start: 0, end: 1, match: 'x', subMatches: [] },
        { path: [1], start: 0, end: 1, match: 'x', subMatches: [] }
      ]
    } as const
    presentation.present(result)

    expect(presentation.navigate('next').index).toBe(1)
    expect(blocks[0]?.update).toHaveBeenCalledWith(undefined, [])
    expect(blocks[1]?.update).toHaveBeenLastCalledWith(undefined, [
      { start: 0, end: 1, active: true }
    ])
    expect(presentation.navigate('next').index).toBe(0)
    expect(presentation.navigate('previous').index).toBe(1)
  })

  it('fails presentation closed for an AST path not proven to map to Muya', () => {
    const previouslyPainted = {
      update: vi.fn(),
      focusHandler: vi.fn(),
      blurHandler: vi.fn()
    }
    const blockAtPath = vi.fn((path: readonly (number | string)[]) =>
      path.length === 2 ? previouslyPainted : undefined
    )
    const presentation = createProjectedSearchPresentation({
      blockAtPath,
      isProvenMatch: () => true
    })
    presentation.present({
      index: 0,
      value: 'old',
      matches: [{ path: [0], start: 0, end: 3, match: 'old', subMatches: [] }]
    })
    blockAtPath.mockClear()

    expect(presentation.present({
      index: 0,
      value: 'nested',
      matches: [{
        path: [0, 1],
        start: 0,
        end: 6,
        match: 'nested',
        subMatches: []
      }]
    })).toBe(false)
    expect(blockAtPath).not.toHaveBeenCalled()
    expect(previouslyPainted.update).toHaveBeenLastCalledWith(undefined, [])
    expect(presentation.navigate('next').index).toBe(-1)
  })

  it('fails closed when AST offsets lack a current one-to-one view binding', () => {
    const blockAtPath = vi.fn()
    const presentation = createProjectedSearchPresentation({
      blockAtPath,
      isProvenMatch: () => false
    })

    expect(presentation.present({
      index: 0,
      value: 'formatted',
      matches: [{
        path: [0],
        start: 4,
        end: 13,
        match: 'formatted',
        subMatches: []
      }]
    })).toBe(false)
    expect(blockAtPath).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'

import {
  createProjectedSearchPresentation,
  type ProjectedSearchPresentationBlock
} from '@/documentConsumers/projectedSearchPresentation'

describe('projected search presentation', () => {
  it('retains the active match selection for returning from Find to editing', () => {
    const block = { update: vi.fn(), focusHandler: vi.fn(), blurHandler: vi.fn() }
    const presentation = createProjectedSearchPresentation({ blockAtPath: () => block })
    presentation.present({
      index: 0,
      value: 'cat',
      matches: [{
        path: [0],
        start: 0,
        end: 3,
        match: 'cat',
        subMatches: [],
        presentation: { path: [0, 'text'], start: 2, end: 5 }
      }]
    })
    expect(presentation.selection()).toEqual({
      anchor: { path: [0, 'text'], offset: 2 },
      focus: { path: [0, 'text'], offset: 5 }
    })
    presentation.clear()
    expect(presentation.selection()).toBeUndefined()
  })
  it('paints projection-proven offsets without a source-edit binding', () => {
    const block = {
      update: vi.fn(),
      focusHandler: vi.fn(),
      blurHandler: vi.fn()
    } as ProjectedSearchPresentationBlock
    const presentation = createProjectedSearchPresentation({
      blockAtPath: () => block
    })

    expect(presentation.present({
      index: 0,
      value: 'cat',
      matches: [{
        path: [0],
        start: 0,
        end: 3,
        match: 'cat',
        subMatches: [],
        presentation: { path: [0, 'text'], start: 2, end: 5 }
      }]
    })).toBe(true)
    expect(block.update).toHaveBeenCalledWith(undefined, [
      { start: 2, end: 5, active: true }
    ])
  })

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
      blockAtPath
    })

    presentation.present({
      index: 0,
      value: 'alpha',
      matches: [
        {
          path: [0],
          start: 0,
          end: 5,
          match: 'alpha',
          subMatches: [],
          presentation: { path: [0, 'text'], start: 0, end: 5 }
        },
        {
          path: [1],
          start: 6,
          end: 11,
          match: 'alpha',
          subMatches: [],
          presentation: { path: [1, 'text'], start: 6, end: 11 }
        }
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
      blockAtPath: path => blocks[path[0] as number]
    })
    const result = {
      index: 0,
      value: 'x',
      matches: [
        {
          path: [0],
          start: 0,
          end: 1,
          match: 'x',
          subMatches: [],
          presentation: { path: [0, 'text'], start: 0, end: 1 }
        },
        {
          path: [1],
          start: 0,
          end: 1,
          match: 'x',
          subMatches: [],
          presentation: { path: [1, 'text'], start: 0, end: 1 }
        }
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
      blockAtPath
    })
    presentation.present({
      index: 0,
      value: 'old',
      matches: [{
        path: [0],
        start: 0,
        end: 3,
        match: 'old',
        subMatches: [],
        presentation: { path: [0, 'text'], start: 0, end: 3 }
      }]
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

  it('fails closed when a projection range lacks a current Muya block', () => {
    const blockAtPath = vi.fn()
    const presentation = createProjectedSearchPresentation({ blockAtPath })

    expect(presentation.present({
      index: 0,
      value: 'formatted',
      matches: [{
        path: [0],
        start: 4,
        end: 13,
        match: 'formatted',
        subMatches: [],
        presentation: { path: [0, 'text'], start: 4, end: 13 }
      }]
    })).toBe(false)
    expect(blockAtPath).toHaveBeenCalledWith([0, 'text'])
  })
})

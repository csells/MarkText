import { describe, expect, it } from 'vitest'
import {
  assertRendererPreferencePatch,
  rendererPreferencePatch
} from '@shared/types/preferences'

describe('main-owned project-search settings', () => {
  it.each([
    'searchExclusions',
    'searchMaxFileSize',
    'searchIncludeHidden',
    'searchNoIgnore'
  ])('rejects renderer mutation of %s', (key) => {
    expect(() => assertRendererPreferencePatch({
      [key]: key === 'searchExclusions' ? [] : false
    })).toThrow(/main-owned preference/i)
  })

  it('never publishes main-only search policy into renderer preferences', () => {
    expect(rendererPreferencePatch({
      theme: 'dark',
      searchExclusions: ['secret'],
      searchMaxFileSize: '10M',
      searchIncludeHidden: true,
      searchNoIgnore: true
    })).toEqual({ theme: 'dark' })
  })
})

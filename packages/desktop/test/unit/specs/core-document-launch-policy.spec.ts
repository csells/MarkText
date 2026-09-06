import { describe, expect, it } from 'vitest'

import { resolveCoreDocumentLaunchPolicy } from '@/documentAuthority/coreDocumentLaunchPolicy'

describe('Core document launch policy', () => {
  it('uses Core for a normal launch without enabling mutation controls', () => {
    expect(resolveCoreDocumentLaunchPolicy({})).toEqual({
      coreEnabled: true,
      testControlsEnabled: false
    })
  })

  it('retains explicit legacy and Shadow launches', () => {
    for (const environment of [
      { MARKTEXT_DOCUMENT_CORE_MODE: '0' },
      { MARKTEXT_DOCUMENT_CORE_SHADOW: '1' }
    ]) {
      expect(resolveCoreDocumentLaunchPolicy(environment)).toEqual({
        coreEnabled: false,
        testControlsEnabled: false
      })
    }
    expect(resolveCoreDocumentLaunchPolicy({
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_DOCUMENT_CORE_SHADOW: '1'
    }).coreEnabled).toBe(true)
  })

  it('enables production Core authority without enabling test controls', () => {
    expect(resolveCoreDocumentLaunchPolicy({
      MARKTEXT_DOCUMENT_CORE_MODE: '1'
    })).toEqual({
      coreEnabled: true,
      testControlsEnabled: false
    })
  })

  it('keeps artificial Worker controls behind an explicit test launch', () => {
    expect(resolveCoreDocumentLaunchPolicy({
      PERF_TESTING: 'true',
      MARKTEXT_DOCUMENT_CORE_MODE: '1'
    })).toEqual({
      coreEnabled: true,
      testControlsEnabled: false
    })

    expect(resolveCoreDocumentLaunchPolicy({
      PERF_TESTING: 'true',
      MARKTEXT_DOCUMENT_CORE_MODE: '1',
      MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: '1'
    })).toEqual({
      coreEnabled: true,
      testControlsEnabled: true
    })

    expect(resolveCoreDocumentLaunchPolicy({
      PERF_TESTING: 'true'
    })).toEqual({
      coreEnabled: true,
      testControlsEnabled: false
    })
  })
})

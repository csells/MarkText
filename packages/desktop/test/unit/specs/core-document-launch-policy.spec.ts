import { describe, expect, it } from 'vitest'

import { resolveCoreDocumentLaunchPolicy } from '@/documentAuthority/coreDocumentLaunchPolicy'

describe('Core document launch policy', () => {
  it('has no launch that hands the document back to Muya', () => {
    for (const environment of [
      {},
      { MARKTEXT_DOCUMENT_CORE_MODE: '0' },
      { MARKTEXT_DOCUMENT_CORE_SHADOW: '1' },
      { MARKTEXT_DOCUMENT_CORE_MODE: '1' }
    ]) {
      expect(resolveCoreDocumentLaunchPolicy(environment)).toEqual({
        testControlsEnabled: false
      })
    }
  })

  it('keeps artificial Worker controls behind an explicit test launch', () => {
    expect(resolveCoreDocumentLaunchPolicy({ PERF_TESTING: 'true' })).toEqual({
      testControlsEnabled: false
    })
    expect(resolveCoreDocumentLaunchPolicy({ MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: '1' })).toEqual({
      testControlsEnabled: false
    })
    expect(resolveCoreDocumentLaunchPolicy({
      PERF_TESTING: 'true',
      MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: '1'
    })).toEqual({
      testControlsEnabled: true
    })
  })
})

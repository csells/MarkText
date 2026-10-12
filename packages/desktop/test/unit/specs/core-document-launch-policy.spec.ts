import { describe, expect, it } from 'vitest'

import { resolveCoreDocumentLaunchPolicy } from '@/documentAuthority/coreDocumentLaunchPolicy'

describe('Core document launch policy', () => {
  it('keeps artificial Worker controls behind an explicit test launch', () => {
    expect(resolveCoreDocumentLaunchPolicy({})).toEqual({
      testControlsEnabled: false
    })
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

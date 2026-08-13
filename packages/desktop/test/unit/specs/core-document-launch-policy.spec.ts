import { describe, expect, it } from 'vitest'

import { resolveCoreDocumentLaunchPolicy } from '@/documentAuthority/coreDocumentLaunchPolicy'

describe('Core document launch policy', () => {
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
      coreEnabled: false,
      testControlsEnabled: false
    })
  })
})

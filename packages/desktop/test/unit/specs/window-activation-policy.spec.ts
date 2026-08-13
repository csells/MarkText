import { describe, expect, it } from 'vitest'

import {
  isHiddenE2eWindow,
  windowActivationAllowed
} from 'main_renderer/windows/windowActivationPolicy'

describe('window activation policy', () => {
  it('suppresses activation only for an explicitly hidden E2E launch', () => {
    expect(isHiddenE2eWindow({
      PERF_TESTING: 'true',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    })).toBe(true)
    expect(windowActivationAllowed({
      PERF_TESTING: 'true',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    })).toBe(false)

    expect(isHiddenE2eWindow({ MARKTEXT_E2E_HIDDEN_WINDOW: '1' })).toBe(false)
    expect(isHiddenE2eWindow({ PERF_TESTING: 'true' })).toBe(false)
    expect(isHiddenE2eWindow({
      PERF_TESTING: 'false',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1'
    })).toBe(false)
    expect(windowActivationAllowed({})).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'

import { pickRendererEnvironment } from 'main_renderer/ipc/bootInfo'

describe('renderer boot environment', () => {
  it('exposes Core test controls without exposing E2E window policy', () => {
    expect(pickRendererEnvironment({
      MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: '1',
      MARKTEXT_E2E_HIDDEN_WINDOW: '1',
      SECRET: 'not-for-renderer'
    })).toEqual({
      MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: '1'
    })
  })
})

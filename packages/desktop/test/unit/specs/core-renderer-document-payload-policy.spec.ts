import { describe, expect, it } from 'vitest'

import { acceptsRendererDocumentPayload } from '@/documentConsumers/rendererDocumentPayloadPolicy'

describe('renderer document payload policy', () => {
  it('keeps Pinia/bus Markdown out of a live Core-owned editor', () => {
    expect(acceptsRendererDocumentPayload('core')).toBe(false)
    expect(acceptsRendererDocumentPayload('legacy')).toBe(true)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { rewriteImageSrcs } from '@/util/rewriteImageSrcs'

describe('shared preview/export image resource normalization', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps document-directory characters inside the src attribute and preserves entity-bearing filenames', () => {
    vi.stubGlobal('DIRNAME', '/docs/" onerror="attack()')
    vi.stubGlobal('path', { join: (...parts: string[]) => parts.join('/') })
    const source = '<img src="a&amp;b.png" alt="Safe">'
    const result = rewriteImageSrcs(source)
    const host = document.createElement('div')
    host.innerHTML = result
    const image = host.querySelector('img')
    if (!image) throw new Error('Expected the normalized image')
    expect(image.getAttributeNames()).toEqual(['src', 'alt'])
    expect(image.getAttribute('src')).toBe('file:///docs/" onerror="attack()/a&b.png')
    expect(image.getAttribute('alt')).toBe('Safe')
    expect(rewriteImageSrcs(result)).toBe(result)
  })
})

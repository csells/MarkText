import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// `theme.ts` transitively imports `@/config`, whose first line reads
// `window.path.sep` at module-load time. Stub the preload `window.path` surface
// before the dynamic import runs.
vi.hoisted(() => {
  const w = globalThis as unknown as { window?: { path?: { sep: string } } }
  w.window ??= {}
  w.window.path ??= { sep: '/' }
})

// `theme.ts` reads `isLinux` from `./util/index` (same module as `@/util`) at
// the top level. The Linux-only emoji-picker font patch is composed into the
// common <style> sheet (`#ag-common-style`) by `addCommonStyle`. We mock
// `@/util` per test to flip the platform branch and re-import the module, then
// assert the patched CSS still targets `.document-view-emoji-picker` so a
// future document-view selector drift is caught.
const EMOJI_SELECTOR = '.document-view-emoji-picker section .emoji-wrapper .item span'
const EMOJI_FONT = 'Noto Color Emoji'

const loadTheme = async(isLinux: boolean) => {
  vi.resetModules()
  vi.doMock('@/util', () => ({ isLinux, isOsx: false, isWindows: false }))
  return await import('@/util/theme')
}

const commonStyleHtml = () =>
  (document.querySelector('#ag-common-style') as HTMLStyleElement | null)?.innerHTML ?? ''

const commonOptions = { codeFontFamily: 'Fira Code', codeFontSize: 14 }

describe('theme.ts emoji-picker Linux font patch', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.className = ''
  })

  afterEach(() => {
    vi.doUnmock('@/util')
  })

  it('injects the .document-view-emoji-picker font fallback into the common sheet on Linux', async() => {
    const { addCommonStyle } = await loadTheme(true)
    addCommonStyle(commonOptions)

    const css = commonStyleHtml()
    expect(css).toContain(EMOJI_SELECTOR)
    expect(css).toContain(EMOJI_FONT)
    expect(css).toContain(`${EMOJI_SELECTOR} { font-family: sans-serif, "${EMOJI_FONT}"; }`)
  })

  it('omits the emoji patch entirely off Linux', async() => {
    const { addCommonStyle } = await loadTheme(false)
    addCommonStyle(commonOptions)

    const css = commonStyleHtml()
    expect(css).not.toContain('.document-view-emoji-picker')
    expect(css).not.toContain(EMOJI_FONT)
  })

  it('keeps targeting the engine .document-view-emoji-picker selector on Linux', async() => {
    const { addCommonStyle } = await loadTheme(true)
    addCommonStyle(commonOptions)

    const css = commonStyleHtml()
    expect(css).toContain('.document-view-emoji-picker')
    expect(css).not.toContain('.ag-emoji-picker')
  })

  it('routes the patch through addStyles (theme + common) on Linux', async() => {
    const { addStyles } = await loadTheme(true)
    addStyles({ theme: 'light', ...commonOptions })

    expect(commonStyleHtml()).toContain(EMOJI_SELECTOR)
    // The theme sheet itself carries the theme CSS, not the emoji patch.
    const themeHtml = (document.querySelector('#ag-theme') as HTMLStyleElement | null)?.innerHTML
    expect(themeHtml).not.toContain('.document-view-emoji-picker')
  })

  it('routes nothing emoji-related through addStyles off Linux', async() => {
    const { addStyles } = await loadTheme(false)
    addStyles({ theme: 'light', ...commonOptions })

    expect(commonStyleHtml()).not.toContain('.document-view-emoji-picker')
  })
})

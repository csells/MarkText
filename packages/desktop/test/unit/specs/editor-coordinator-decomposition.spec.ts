import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '../../..')
const editorPath = path.join(
  desktopRoot,
  'src/renderer/src/components/editorWithTabs/editor.vue'
)

const sourceLineCount = (source: string): number =>
  source.split(/\r\n|\r|\n/).length - (source.endsWith('\n') ? 1 : 0)

describe('editor.vue coordinator architecture', () => {
  it('is smaller than its upstream/develop coordinator baseline', () => {
    const source = fs.readFileSync(editorPath, 'utf8')

    expect(sourceLineCount(source)).toBeLessThan(2133)
  })

  it('delegates Review, E2E, and mount/unmount wiring to dedicated modules', () => {
    const source = fs.readFileSync(editorPath, 'utf8')

    expect(source).toContain('useEditorLifecycle')
    expect(source).toContain('useCriticMarkupReviewController')
    expect(source).not.toContain('__marktextE2EReadOnly')
    expect(source).not.toMatch(/\bonMounted\s*\(/)
    expect(source).not.toMatch(/\bonBeforeUnmount\s*\(/)
  })

  it('applies persisted focus and spellchecker state on the first mount', () => {
    const source = fs.readFileSync(editorPath, 'utf8')

    expect(source).toContain('mountedEditor.setFocusMode(focus.value)')
    expect(source).toMatch(
      /applySpellcheckerEnabledState\(\s*spellchecker,\s*spellcheckerEnabled\.value,\s*spellcheckerLanguage\.value\s*\)/
    )
    expect(source).toMatch(
      /reportAsyncTask\([\s\S]*?'Initialize spell checker'/
    )
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { usePreferencesStore } from '@/store/preferences'

// `trimUnnecessaryCodeBlockEmptyLines` configured Muya's Markdown parser to
// drop blank lines at a fenced code block's edges when it read a document,
// which upstream then wrote back to every code block on the next edited save.
// Core is the only parser of a document and keeps unrelated source byte for
// byte (Principle 2, ADR 0007), and it inserts pasted Markdown as written, so
// the setting has no consumer left and is retired rather than offered as a
// switch that does nothing.

const desktopRoot = resolve(import.meta.dirname, '../../..')
const read = (path: string): string => readFileSync(resolve(desktopRoot, path), 'utf8')
const RETIRED = 'trimUnnecessaryCodeBlockEmptyLines'

describe('the retired code block trim preference', () => {
  it('is neither stored, defaulted nor offered', () => {
    expect(Object.keys(JSON.parse(read('src/main/preferences/schema.json')))).not.toContain(RETIRED)
    expect(Object.keys(JSON.parse(read('static/preference.json')))).not.toContain(RETIRED)
    setActivePinia(createPinia())
    expect(Object.keys(usePreferencesStore().$state)).not.toContain(RETIRED)
    expect(read('src/renderer/src/prefComponents/editor/index.vue')).not.toContain(RETIRED)
  })

  it('no longer configures the WYSIWYG surface', () => {
    expect(read('src/renderer/src/components/editorWithTabs/editor.vue')).not.toContain(RETIRED)
  })
})

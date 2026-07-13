import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  installE2EReadOnlyBridge
} from '@/components/editorWithTabs/e2eReadOnlyBridge'

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
})

describe('E2E read-only bridge lifecycle', () => {
  it('installs only when enabled and removes only the bridge it installed', () => {
    const readCanonicalMarkdown = vi.fn(() => '# document')
    const host = {} as Window

    const disabledCleanup = installE2EReadOnlyBridge(host, false, readCanonicalMarkdown)
    expect(host.__marktextE2EReadOnly).toBeUndefined()
    disabledCleanup()

    const cleanup = installE2EReadOnlyBridge(host, true, readCanonicalMarkdown)
    const installed = host.__marktextE2EReadOnly
    expect(installed?.readCanonicalMarkdown()).toBe('# document')

    const replacement = Object.freeze({ readCanonicalMarkdown: () => 'replacement' })
    Object.defineProperty(host, '__marktextE2EReadOnly', {
      configurable: true,
      value: replacement
    })
    cleanup()
    expect(host.__marktextE2EReadOnly).toBe(replacement)
  })
})

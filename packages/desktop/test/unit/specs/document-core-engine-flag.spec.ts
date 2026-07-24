// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  applyDocumentEngine,
  DOCUMENT_CORE_ENGINE_ENV,
  selectDocumentEngine
} from '@/components/editorWithTabs/documentEngineSelection'

/**
 * Increment 5, step one — the engine seam.
 *
 * The migration moves the editor onto `@marktext/document-core` one flow at a
 * time, and the whole point of a flag is that both engines run side by side
 * until each flow is proven. So the selection has to be an explicit, testable
 * decision rather than a condition buried in the editor component: it is the
 * thing every migrated flow will branch on, and the thing that lets a flow be
 * rolled back on its own.
 *
 * Legacy stays the default until a flow is actually migrated. Opting in is
 * deliberate and per-launch, matching how this codebase already gates
 * test-only surfaces (`MARKTEXT_E2E_READONLY_BRIDGE`).
 */

describe('document engine selection', () => {
  it('uses the legacy engine when nothing opts in', () => {
    expect(selectDocumentEngine({})).toBe('legacy')
    expect(selectDocumentEngine({ [DOCUMENT_CORE_ENGINE_ENV]: undefined }))
      .toBe('legacy')
  })

  it('selects the document-core engine only on an explicit opt-in', () => {
    expect(selectDocumentEngine({ [DOCUMENT_CORE_ENGINE_ENV]: '1' }))
      .toBe('document-core')
  })

  it('ignores values that are not the opt-in', () => {
    // A stray or half-set variable must not silently switch a user's editor.
    for (const value of ['', '0', 'true', 'yes', 'document-core', ' 1']) {
      expect(selectDocumentEngine({ [DOCUMENT_CORE_ENGINE_ENV]: value }))
        .toBe('legacy')
    }
  })

  it('records the chosen engine on the editor element', () => {
    // Without a mark in the DOM, a flag that silently fails to plumb through
    // looks exactly like a flag that is off — so automation can assert which
    // engine a session actually ran.
    const element = document.createElement('div')
    expect(applyDocumentEngine(element, {})).toBe('legacy')
    expect(element.getAttribute('data-document-engine')).toBe('legacy')

    expect(applyDocumentEngine(element, { [DOCUMENT_CORE_ENGINE_ENV]: '1' }))
      .toBe('document-core')
    expect(element.getAttribute('data-document-engine')).toBe('document-core')
  })

  it('reads the flag from a process-like environment', () => {
    // The renderer reaches the environment through the preload bridge, so the
    // selector takes the environment as data instead of reaching for a global.
    const environment: Record<string, string | undefined> = {
      SOMETHING_ELSE: '1',
      [DOCUMENT_CORE_ENGINE_ENV]: '1'
    }
    expect(selectDocumentEngine(environment)).toBe('document-core')
  })
})

// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createDocumentEngineHost } from '@/components/editorWithTabs/documentEngineHost'

/**
 * Increment 5 — the strangler facade the cutover runs through.
 *
 * editor.vue talks to one interface and the flag decides which engine answers,
 * so a flow migrates by being routed here rather than by rewriting the editor
 * around a second engine. That is what lets a flow move — and roll back — on its
 * own, which is the entire reason both engines run side by side.
 *
 * First flow: reading canonical Markdown, which save and the E2E bridge both
 * depend on. Legacy delegates to Muya exactly as before; document-core reads the
 * bytes the engine owns.
 */

describe('document engine host', () => {
  it('reads canonical Markdown from Muya on the legacy engine', async() => {
    const getMarkdown = vi.fn(() => '# From Muya\n')
    const host = createDocumentEngineHost({
      engine: 'legacy',
      legacy: { getMarkdown }
    })

    expect(await host.getMarkdown()).toBe('# From Muya\n')
    expect(getMarkdown).toHaveBeenCalledOnce()
  })

  it('reads canonical Markdown from the engine on document-core', async() => {
    const host = createDocumentEngineHost({
      engine: 'document-core',
      documentCore: { getMarkdown: async() => '# From the engine\n' }
    })

    expect(await host.getMarkdown()).toBe('# From the engine\n')
  })

  it('never falls back to the other engine', async() => {
    // Silently reading the wrong engine would save one engine's document while
    // the user edits another's — the failure the flag exists to prevent.
    const getMarkdown = vi.fn(() => '# From Muya\n')
    const host = createDocumentEngineHost({
      engine: 'document-core',
      legacy: { getMarkdown },
      documentCore: { getMarkdown: async() => '# From the engine\n' }
    })

    expect(await host.getMarkdown()).toBe('# From the engine\n')
    expect(getMarkdown).not.toHaveBeenCalled()
  })

  it('reports which engine is answering', async() => {
    const host = createDocumentEngineHost({
      engine: 'document-core',
      documentCore: { getMarkdown: async() => '' }
    })
    expect(host.engine).toBe('document-core')
  })

  it('fails loudly when the selected engine was not provided', () => {
    // A missing implementation must not degrade into the other engine; that is
    // how a half-wired flag silently keeps using the old path.
    expect(() => createDocumentEngineHost({ engine: 'document-core' }))
      .toThrow(/document-core/)
    expect(() => createDocumentEngineHost({ engine: 'legacy' }))
      .toThrow(/legacy/)
  })
})

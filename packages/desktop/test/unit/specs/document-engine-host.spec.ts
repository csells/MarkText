// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  createDocumentEngineHost,
  hostFor,
  installDocumentEngine
} from '@/components/editorWithTabs/documentEngineHost'

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

    expect(host.getMarkdown()).toBe('# From Muya\n')
    expect(getMarkdown).toHaveBeenCalledOnce()
  })

  it('reads canonical Markdown from the engine on document-core', async() => {
    const host = createDocumentEngineHost({
      engine: 'document-core',
      documentCore: { getMarkdownSync: () => '# From the engine\n' }
    })

    expect(host.getMarkdown()).toBe('# From the engine\n')
  })

  it('never falls back to the other engine', async() => {
    // Silently reading the wrong engine would save one engine's document while
    // the user edits another's — the failure the flag exists to prevent.
    const getMarkdown = vi.fn(() => '# From Muya\n')
    const host = createDocumentEngineHost({
      engine: 'document-core',
      legacy: { getMarkdown },
      documentCore: { getMarkdownSync: () => '# From the engine\n' }
    })

    expect(host.getMarkdown()).toBe('# From the engine\n')
    expect(getMarkdown).not.toHaveBeenCalled()
  })

  it('reports which engine is answering', async() => {
    const host = createDocumentEngineHost({
      engine: 'document-core',
      documentCore: { getMarkdownSync: () => '' }
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

describe('per-editor host registry', () => {
  it('returns the host installed for that editor instance', () => {
    const element = document.createElement('div')
    const muya = { getMarkdown: () => '# One\n' }
    const host = installDocumentEngine(element, {}, muya)
    expect(hostFor(muya)).toBe(host)
  })

  it('keeps hosts distinct per editor', () => {
    // Several tabs mean several editors; a module-level host would answer for
    // whichever mounted last and silently read the wrong document.
    const first = { getMarkdown: () => '# First\n' }
    const second = { getMarkdown: () => '# Second\n' }
    installDocumentEngine(document.createElement('div'), {}, first)
    installDocumentEngine(document.createElement('div'), {}, second)
    expect(hostFor(first).getMarkdown()).toBe('# First\n')
    expect(hostFor(second).getMarkdown()).toBe('# Second\n')
  })

  it('falls back to reading an unregistered editor directly', () => {
    // An editor created before the seam existed must still be readable, and
    // reading it is exactly what the legacy engine does.
    const stray = { getMarkdown: () => '# Stray\n' }
    expect(hostFor(stray).getMarkdown()).toBe('# Stray\n')
    expect(hostFor(stray).engine).toBe('legacy')
  })
})

describe('write flows', () => {
  it('loads content through the engine that owns the document', () => {
    const calls: string[] = []
    const muya = {
      getMarkdown: () => '',
      setContent: (markdown: string) => calls.push(`legacy:${markdown}`)
    }
    installDocumentEngine(document.createElement('div'), {}, muya)
    hostFor(muya).setContent('# Loaded\n')
    expect(calls).toEqual(['legacy:# Loaded\n'])
  })

  it('routes a load to document-core when that engine is selected', () => {
    const calls: string[] = []
    const legacy = { getMarkdown: () => '', setContent: () => calls.push('legacy') }
    const host = createDocumentEngineHost({
      engine: 'document-core',
      legacy,
      documentCore: {
        getMarkdownSync: () => '',
        setContent: () => calls.push('document-core')
      }
    })
    host.setContent('# Loaded\n')
    // Loading into the wrong engine would leave the user editing one document
    // while the other holds what was opened.
    expect(calls).toEqual(['document-core'])
  })

  it('subscribes to changes on the owning engine', () => {
    const listeners: Array<() => void> = []
    const muya = {
      getMarkdown: () => '',
      setContent: () => {},
      on: (event: string, listener: () => void) => {
        if (event === 'json-change') listeners.push(listener)
      }
    }
    installDocumentEngine(document.createElement('div'), {}, muya)
    let seen = 0
    hostFor(muya).onChange(() => { seen += 1 })
    listeners.forEach(listener => listener())
    expect(seen).toBe(1)
  })

  it('passes the document-core disposer through the seam', () => {
    // The production view returns a Disposable from onChange; a host that
    // swallows it leaves the subscription attached for the editor's lifetime.
    let disposed = 0
    const host = createDocumentEngineHost({
      engine: 'document-core',
      documentCore: {
        getMarkdownSync: () => '',
        onChange: () => ({ dispose: () => { disposed += 1 } })
      }
    })
    const subscription = host.onChange(() => {})
    subscription.dispose()
    expect(disposed).toBe(1)
  })

  it('detaches a legacy subscription on dispose', () => {
    const listeners = new Set<() => void>()
    const muya = {
      getMarkdown: () => '',
      on: (event: string, listener: () => void) => {
        if (event === 'json-change') listeners.add(listener)
      },
      off: (event: string, listener: () => void) => {
        if (event === 'json-change') listeners.delete(listener)
      }
    }
    const host = createDocumentEngineHost({ engine: 'legacy', legacy: muya })
    let seen = 0
    const subscription = host.onChange(() => { seen += 1 })
    listeners.forEach(listener => listener())
    subscription.dispose()
    listeners.forEach(listener => listener())
    expect(seen).toBe(1)
  })
})

import type { DocumentEngine } from './documentEngineSelection'
import { applyDocumentEngine } from './documentEngineSelection'

/**
 * The seam the engine migration runs through.
 *
 * `editor.vue` talks to this one interface and the flag decides which engine
 * answers, so a flow migrates by being routed here rather than by rewriting the
 * editor around a second engine. That is what lets a flow move — and roll back —
 * on its own, which is the whole reason both engines run side by side.
 *
 * Operations arrive here one at a time as each flow migrates; this starts with
 * reading canonical Markdown, which save and the E2E bridge both depend on.
 */

/** The subset of Muya this facade needs, so tests need no Muya instance. */
export interface LegacyEngineBinding {
  readonly getMarkdown: () => string
}

/** The matching document-core view surface. */
export interface DocumentCoreBinding {
  readonly getMarkdownSync: () => string
}

export interface DocumentEngineHostOptions {
  readonly engine: DocumentEngine
  readonly legacy?: LegacyEngineBinding
  readonly documentCore?: DocumentCoreBinding
}

export interface DocumentEngineHost {
  readonly engine: DocumentEngine
  /**
   * The document's canonical Markdown, from whichever engine owns it.
   *
   * Synchronous because the editor asks from change handlers and history
   * bookkeeping, where awaiting is not an option — both engines can answer the
   * current revision without one.
   */
  readonly getMarkdown: () => string
}

export function createDocumentEngineHost(
  options: DocumentEngineHostOptions
): DocumentEngineHost {
  if (options.engine === 'document-core') {
    const binding = options.documentCore
    if (binding === undefined) {
      // Never degrade to the other engine: that is how a half-wired flag keeps
      // silently using the old path while appearing to be on the new one.
      throw new Error('The document-core engine was selected but not provided')
    }
    return Object.freeze({
      engine: 'document-core' as const,
      getMarkdown: () => binding.getMarkdownSync()
    })
  }

  const binding = options.legacy
  if (binding === undefined) {
    throw new Error('The legacy engine was selected but not provided')
  }
  return Object.freeze({
    engine: 'legacy' as const,
    getMarkdown: () => binding.getMarkdown()
  })
}

/**
 * Hosts keyed by the editor they belong to.
 *
 * Several tabs mean several editors, so a module-level host would answer for
 * whichever mounted last and silently read the wrong document. Weak keys let a
 * closed tab's host be collected with its editor.
 */
const hosts = new WeakMap<object, DocumentEngineHost>()

/**
 * Select the engine for an editor element, record it on the DOM, and build the
 * host the coordinator talks to — one call, so migrating a flow does not grow
 * the coordinator that is already at its size guard.
 */
export function installDocumentEngine(
  element: HTMLElement,
  environment: Readonly<Record<string, string | undefined>>,
  legacy: LegacyEngineBinding,
  documentCore?: DocumentCoreBinding
): DocumentEngineHost {
  const host = createDocumentEngineHost({
    engine: applyDocumentEngine(element, environment),
    legacy,
    documentCore
  })
  hosts.set(legacy, host)
  return host
}

/**
 * The host for an editor instance.
 *
 * This is what lets a flow migrate without changing signatures: any function
 * already holding an editor can ask for *that* editor's host, which is correct
 * with several tabs open where a module-level lookup would not be.
 *
 * An editor with no host registered reads directly, which is exactly what the
 * legacy engine does — so a caller reached before the seam was installed still
 * gets the right answer rather than an error.
 */
export function hostFor(editor: LegacyEngineBinding): DocumentEngineHost {
  return hosts.get(editor) ?? Object.freeze({
    engine: 'legacy' as const,
    getMarkdown: () => editor.getMarkdown()
  })
}

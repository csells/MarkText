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
export interface LegacyEngineBinding<Selection = never> {
  readonly getMarkdown: () => string
  readonly setContent?: (markdown: string) => void
  readonly replaceContent?: (markdown: string, selection?: Selection) => void
  readonly on?: (event: string, listener: () => void) => void
}

/** The matching document-core view surface. */
export interface DocumentCoreBinding<Selection = never> {
  readonly getMarkdownSync: () => string
  readonly setContent?: (markdown: string) => void
  readonly replaceContent?: (markdown: string, selection?: Selection) => void
  readonly onChange?: (listener: () => void) => void
}

export interface DocumentEngineHostOptions<Selection = never> {
  readonly engine: DocumentEngine
  readonly legacy?: LegacyEngineBinding<Selection>
  readonly documentCore?: DocumentCoreBinding<Selection>
}

export interface DocumentEngineHost<Selection = never> {
  readonly engine: DocumentEngine
  /**
   * The document's canonical Markdown, from whichever engine owns it.
   *
   * Synchronous because the editor asks from change handlers and history
   * bookkeeping, where awaiting is not an option — both engines can answer the
   * current revision without one.
   */
  readonly getMarkdown: () => string
  /** Load a document into whichever engine owns this tab. */
  readonly setContent: (markdown: string) => void
  /**
   * Replace the document, optionally restoring a selection — the source-mode
   * hand-back, where the caret must survive the round trip. The selection type
   * travels with the engine rather than being flattened to `unknown`, which
   * would let one engine's caret be handed to the other.
   */
  readonly replaceContent: (markdown: string, selection?: Selection) => void
  /** Observe committed changes from the owning engine. */
  readonly onChange: (listener: () => void) => void
}

export function createDocumentEngineHost<Selection = never>(
  options: DocumentEngineHostOptions<Selection>
): DocumentEngineHost<Selection> {
  if (options.engine === 'document-core') {
    const binding = options.documentCore
    if (binding === undefined) {
      // Never degrade to the other engine: that is how a half-wired flag keeps
      // silently using the old path while appearing to be on the new one.
      throw new Error('The document-core engine was selected but not provided')
    }
    return Object.freeze({
      engine: 'document-core' as const,
      getMarkdown: () => binding.getMarkdownSync(),
      setContent: (markdown: string) => binding.setContent?.(markdown),
      replaceContent: (markdown: string, selection?: Selection) =>
        binding.replaceContent?.(markdown, selection),
      onChange: (listener: () => void) => binding.onChange?.(listener)
    })
  }

  const binding = options.legacy
  if (binding === undefined) {
    throw new Error('The legacy engine was selected but not provided')
  }
  return Object.freeze({
    engine: 'legacy' as const,
    getMarkdown: () => binding.getMarkdown(),
    setContent: (markdown: string) => binding.setContent?.(markdown),
    replaceContent: (markdown: string, selection?: Selection) =>
      binding.replaceContent?.(markdown, selection),
    // Muya reports document changes as a 'json-change' event; the engine name
    // for it does not leak past this seam.
    onChange: (listener: () => void) => binding.on?.('json-change', listener)
  })
}

/**
 * Hosts keyed by the editor they belong to.
 *
 * Several tabs mean several editors, so a module-level host would answer for
 * whichever mounted last and silently read the wrong document. Weak keys let a
 * closed tab's host be collected with its editor.
 */
const hosts = new WeakMap<object, DocumentEngineHost<never>>()

/**
 * Select the engine for an editor element, record it on the DOM, and build the
 * host the coordinator talks to — one call, so migrating a flow does not grow
 * the coordinator that is already at its size guard.
 */
export function installDocumentEngine<Selection>(
  element: HTMLElement,
  environment: Readonly<Record<string, string | undefined>>,
  legacy: LegacyEngineBinding<Selection>,
  documentCore?: DocumentCoreBinding<Selection>
): DocumentEngineHost<Selection> {
  const host = createDocumentEngineHost({
    engine: applyDocumentEngine(element, environment),
    legacy,
    documentCore
  })
  hosts.set(legacy, host as DocumentEngineHost<never>)
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
export function hostFor<Selection>(
  editor: LegacyEngineBinding<Selection>
): DocumentEngineHost<Selection> {
  const installed = hosts.get(editor) as DocumentEngineHost<Selection> | undefined
  return installed ?? createDocumentEngineHost<Selection>({
    engine: 'legacy',
    legacy: editor
  })
}

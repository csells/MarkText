import type { DocumentEngine } from './documentEngineSelection'

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
  readonly getMarkdown: () => Promise<string>
}

export interface DocumentEngineHostOptions {
  readonly engine: DocumentEngine
  readonly legacy?: LegacyEngineBinding
  readonly documentCore?: DocumentCoreBinding
}

export interface DocumentEngineHost {
  readonly engine: DocumentEngine
  /** The document's canonical Markdown, from whichever engine owns it. */
  readonly getMarkdown: () => Promise<string>
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
      getMarkdown: () => binding.getMarkdown()
    })
  }

  const binding = options.legacy
  if (binding === undefined) {
    throw new Error('The legacy engine was selected but not provided')
  }
  return Object.freeze({
    engine: 'legacy' as const,
    getMarkdown: async() => binding.getMarkdown()
  })
}

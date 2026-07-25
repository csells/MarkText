import type { ParseConfiguration } from '@marktext/document-core'
import { createDocumentSession, createSourceSnapshot } from '@marktext/document-core'
import type { DocumentCoreBinding, LegacyEngineBinding } from './documentEngineHost'

/**
 * The first flow served by `@marktext/document-core` in the running app.
 *
 * A flow migrates while Muya still owns everything else, so the two have to hold
 * the same document: the mirror seeds a document-core session from the editor's
 * content and re-seeds it whenever Muya commits a change. A read served by the
 * engine then describes what the user is actually looking at.
 *
 * This is deliberately a mirror rather than a handover. Until every flow is
 * migrated Muya remains the editing authority, and having the engine answer one
 * flow first is what makes the cutover reversible — the flag can go back without
 * the document having gone anywhere.
 */

/** A document the engine would not reproduce exactly. */
export interface EngineDivergence {
  readonly editor: string
  readonly engine: string
}

export interface DocumentCoreMirrorOptions {
  /** Override how the engine's source is read, so the check can be tested. */
  readonly readEngineSource?: () => string | null
}

export interface DocumentCoreMirror<Selection = never> {
  /** Resolves once the engine session exists. */
  readonly ready: Promise<void>
  /** Resolves once every observed edit has been applied. */
  readonly settled: () => Promise<void>
  readonly binding: DocumentCoreBinding<Selection>
  /**
   * Documents the engine did not reproduce byte for byte.
   *
   * Evidence, gathered before authority moves: handing a user's text to an
   * engine that would give back something different is how a save loses data.
   * Empty across real documents is what makes the handover defensible.
   */
  readonly divergences: () => readonly EngineDivergence[]
  readonly dispose: () => void
}

export function createDocumentCoreMirror<Selection = never>(
  editor: LegacyEngineBinding<Selection>,
  parseConfiguration: ParseConfiguration,
  options: DocumentCoreMirrorOptions = {}
): DocumentCoreMirror<Selection> {
  const divergences: EngineDivergence[] = []
  let source = editor.getMarkdown()
  const attachedChangeListeners = new Set<() => void>()
  let session: Awaited<ReturnType<typeof createDocumentSession>> | null = null
  let pending: Promise<void> = Promise.resolve()
  let disposed = false

  const open = async(markdown: string): Promise<void> => {
    if (disposed) return
    session = await createDocumentSession({
      source: createSourceSnapshot(markdown),
      parseConfiguration,
      configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
      initialView: 'markup',
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 0, affinity: 'next' },
        focus: { offset: 0, affinity: 'next' }
      }
    })
  }

  const ready = open(source)

  // Re-seed from the editor's content rather than replaying its operations: the
  // engine owns how source becomes a document, and reconstructing an edit stream
  // across two engines is exactly the inference this rebuild exists to remove.
  /**
   * Notice the document moving, and drop the session the instant it does.
   *
   * Checked on read rather than driven by a change event: the mirror must be
   * right even if it is installed before the editor emits, or if a path commits
   * without emitting. Trusting a subscription for correctness means a missed
   * event silently serves the previous document — a stale save, or a tab that
   * looks clean after an edit. Re-seeding is async, so the editor's own text is
   * served until the new session exists.
   */
  const sync = (): void => {
    const current = editor.getMarkdown()
    if (current === source) return

    source = current
    session = null
    pending = pending.then(() => open(source))
  }

  editor.on?.('json-change', sync)

  return Object.freeze({
    ready,
    settled: () => pending,
    binding: Object.freeze({
      // Falls back to the editor until the session exists, because building one
      // is async while the editor reads synchronously from the first render.
      // An empty answer would show an empty document or dirty a clean tab.
      // Muya still commits the edits while this engine only serves reads, so a
      // change subscription has to reach the editor that owns them. Leaving it
      // unimplemented silently disabled the editor's whole change handler under
      // the flag — dirty tracking, content updates and history all stopped,
      // because the host routed onChange to a binding that ignored it.
      onChange: (listener: () => void) => {
        const wrapped = (): void => {
          sync()
          listener()
        }
        editor.on?.('json-change', wrapped)
        attachedChangeListeners.add(wrapped)
        return Object.freeze({
          dispose: () => {
            attachedChangeListeners.delete(wrapped)
            editor.off?.('json-change', wrapped)
          }
        })
      },
      getMarkdownSync: () => {
        sync()
        const engine = options.readEngineSource === undefined
          ? session?.snapshot().revision.source ?? null
          : options.readEngineSource()
        if (engine === null) {
          return source
        }
        if (engine !== source) {
          // Record it and serve the editor's text anyway. Confidence-building
          // must never become a way to hand back wrong bytes.
          if (!divergences.some(seen => seen.editor === source)) {
            divergences.push(Object.freeze({ editor: source, engine }))
          }
          return source
        }
        return engine
      }
    }),
    divergences: () => Object.freeze([...divergences]),
    dispose: () => {
      disposed = true
      session = null
      // Detach whatever this mirror attached; a disposed mirror must not keep
      // syncing (or leaking) through the editor's event registry.
      for (const wrapped of attachedChangeListeners) {
        editor.off?.('json-change', wrapped)
      }
      attachedChangeListeners.clear()
    }
  })
}

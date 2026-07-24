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

export interface DocumentCoreMirror<Selection = never> {
  /** Resolves once the engine session exists. */
  readonly ready: Promise<void>
  /** Resolves once every observed edit has been applied. */
  readonly settled: () => Promise<void>
  readonly binding: DocumentCoreBinding<Selection>
  readonly dispose: () => void
}

export function createDocumentCoreMirror<Selection = never>(
  editor: LegacyEngineBinding<Selection>,
  parseConfiguration: ParseConfiguration
): DocumentCoreMirror<Selection> {
  let source = editor.getMarkdown()
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
      getMarkdownSync: () => {
        sync()
        return session?.snapshot().revision.source ?? source
      }
    }),
    dispose: () => {
      disposed = true
      session = null
    }
  })
}

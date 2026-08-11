import type { MarkdownOptions } from '@marktext/document-core'

import type {
  ShadowDocumentAuthority,
  ShadowReport,
  ShadowTicket
} from './shadowDocumentAuthority'

export interface EditorShadowSnapshot {
  readonly documentId: string
  readonly source: string
  readonly options: Readonly<MarkdownOptions>
}

export interface EditorShadowBinding {
  readonly diagnosticOnly: true
  update(snapshot: EditorShadowSnapshot | null): ShadowTicket | undefined
  settled(): Promise<void>
  reports(): readonly ShadowReport[]
  dispose(): void
}

const optionSignature = (options: Readonly<MarkdownOptions>): string => [
  options.gfm,
  options.frontMatter,
  options.math,
  options.gitLabMath,
  options.footnotes,
  options.subscriptAndSuperscript
].map(value => value ? '1' : '0').join('')

/**
 * Adapts the editor store's already-materialized document snapshots to one
 * diagnostic-only Shadow lineage. Document and language changes are explicit
 * open barriers; ordinary content changes stay incremental on the Worker.
 */
export function createEditorShadowBinding(
  authority: ShadowDocumentAuthority
): EditorShadowBinding {
  let activeDocumentId: string | undefined
  let activeOptionSignature: string | undefined
  let disposed = false

  return Object.freeze({
    diagnosticOnly: true,
    update(snapshot: EditorShadowSnapshot | null): ShadowTicket | undefined {
      if (disposed) throw new Error('Editor Shadow binding is disposed')
      if (snapshot === null) {
        if (activeDocumentId === undefined) return undefined
        activeDocumentId = undefined
        activeOptionSignature = undefined
        return authority.close()
      }

      const nextOptionSignature = optionSignature(snapshot.options)
      if (
        snapshot.documentId !== activeDocumentId ||
        nextOptionSignature !== activeOptionSignature
      ) {
        activeDocumentId = snapshot.documentId
        activeOptionSignature = nextOptionSignature
        return authority.open({
          documentId: snapshot.documentId,
          source: snapshot.source,
          options: snapshot.options
        })
      }
      return authority.observe(snapshot.source)
    },
    settled(): Promise<void> {
      return authority.settled()
    },
    reports(): readonly ShadowReport[] {
      return authority.reports()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      activeDocumentId = undefined
      activeOptionSignature = undefined
      authority.dispose()
    }
  })
}

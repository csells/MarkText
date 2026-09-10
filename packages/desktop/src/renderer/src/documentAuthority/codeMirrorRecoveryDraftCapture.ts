import type CodeMirror from 'codemirror'
import type { CoreRecoveryDraftInput } from '@shared/types/coreRecoveryDraft'
import type { CoreDocumentViewLease } from './coreDocumentSessionManager'
import { copyCodeMirrorSelections } from './codeMirrorViewState'

/** Failure-only snapshot of the Source editor owned by this view lease. */
export function createCodeMirrorRecoveryDraftCapture(input: {
  editor: CodeMirror.Editor
  lease: CoreDocumentViewLease
  pathname: string | undefined
  initialSource: string | undefined
  nativeIntent: () => unknown
}) {
  let captured: CoreRecoveryDraftInput | undefined
  return (error: unknown): CoreRecoveryDraftInput => {
    if (captured !== undefined) return captured
    const cm = input.editor
    cm.setOption('readOnly', true)
    const text = cm.getValue()
    captured = {
      documentId: input.lease.documentId,
      pathname: input.pathname,
      generation: input.lease.identity.generation,
      revision: input.lease.identity.revision,
      reason: error instanceof Error ? error.message : String(error),
      visibleText: text,
      nativeState: {
        surface: 'source',
        text,
        selections: copyCodeMirrorSelections(cm.listSelections())
      },
      nativeIntent: input.nativeIntent(),
      acknowledgedView: { initialSource: input.initialSource, lineEnding: input.lease.lineEnding }
    }
    return captured
  }
}

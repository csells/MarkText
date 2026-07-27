import type {
  CompleteEditorSnapshot,
  DocumentSession,
  EditorSnapshot
} from '@marktext/document-core'

export function requireCompleteSnapshot(
  snapshot: EditorSnapshot
): CompleteEditorSnapshot {
  if (snapshot.kind !== 'complete') {
    throw new Error('Test fixture unexpectedly opened in SourceOnly mode')
  }
  return snapshot
}

export function completeSnapshot(
  session: DocumentSession
): CompleteEditorSnapshot {
  return requireCompleteSnapshot(session.snapshot())
}

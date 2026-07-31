import type {
  IDocumentCoreViewSession
} from '@marktext/document-view'
import type {
  DocumentCoreRemoteSession
} from '@/components/editorWithTabs/documentCoreRemoteSession'

type TestClipboardCapabilities = Pick<
  DocumentCoreRemoteSession,
  'writeClipboardMaterialization' | 'pasteClipboard'
>

/**
 * Install the same closed capability surface that production Desktop sessions
 * own. Tests may replace effects, but they cannot bypass the session by adding
 * alternate routes to the editor-host options object.
 */
export function installTestDocumentHostCapabilities(
  session: IDocumentCoreViewSession,
  clipboard: TestClipboardCapabilities
): DocumentCoreRemoteSession {
  return Object.freeze({
    ...session,
    ...clipboard,
    intentCapabilities: () => null,
    registerImageAsset: () => Object.freeze({
      src: 'test-owned-image-asset',
      cancel: () => undefined
    }),
    resolveImageSource: async() => Object.freeze({
      kind: 'unavailable' as const
    }),
    activateDocument: async() => undefined,
    closeDocument: async() => undefined
  })
}

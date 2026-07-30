// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  documentParseConfigurationFor as createDocumentParseConfiguration
} from 'main_renderer/documentCore/documentParseConfiguration'
import { createSourceSnapshot } from '@marktext/document-core'
import {
  createTestDocumentCoreSession
} from '../../../../document-view/src/documentCore/__tests__/testDocumentCoreSession'
import {
  installTestDocumentHostCapabilities
} from '../helpers/documentHostSession'
import {
  createDocumentEditorHost,
  type DocumentEditorHost
} from '@/components/editorWithTabs/documentCoreDesktopEditor'

const openHost = async(source: string): Promise<DocumentEditorHost> => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const session = await createTestDocumentCoreSession(
    createSourceSnapshot(source),
    createDocumentParseConfiguration({
      footnotes: false,
      gitLabMath: false,
      subscriptAndSuperscript: false
    })
  )
  return await createDocumentEditorHost({
    element: host,
    session: installTestDocumentHostCapabilities(session, {
      pasteClipboard: async() => {
        throw new Error('Review card text must not reach the clipboard')
      },
      writeClipboardMaterialization: async() => Object.freeze({
        kind: 'written' as const
      })
    }),
    configuration: {}
  })
}

const SOURCE =
  'alpha {++added++} {--removed--} {==anchored==}{>>note<<} omega\n'

// A Review card names an annotation, so its text belongs to the source that
// declares the annotation — not to whichever projection happens to be mounted.
// Slicing marked-projection model offsets out of another projection's text
// yields neither: in `original` the addition card read " remo" and the deletion
// card "ed hi o", which is not a truncation of the right answer but a window
// onto unrelated characters.
describe('Review card text', () => {
  it.each(['marked', 'original', 'revised'] as const)(
    'describes each annotation identically under the %s projection',
    async(projection) => {
      const editor = await openHost(SOURCE)
      await editor.configure({ criticMarkupProjection: projection })

      const items = editor.getCriticMarkupReviewSnapshot().items
      const byType = (type: string): Record<string, unknown> => {
        const found = items.find(item => item.type === type)
        if (found === undefined) throw new Error(`No ${type} item`)
        return found as unknown as Record<string, unknown>
      }

      expect(byType('addition')).toMatchObject({
        content: 'added',
        raw: '{++added++}'
      })
      expect(byType('deletion')).toMatchObject({
        content: 'removed',
        raw: '{--removed--}'
      })
      expect(byType('comment')).toMatchObject({
        content: 'note',
        anchorText: 'anchored',
        raw: '{>>note<<}'
      })

      editor.destroy()
    }
  )
})

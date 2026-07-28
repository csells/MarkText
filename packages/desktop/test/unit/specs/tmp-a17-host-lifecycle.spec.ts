// @vitest-environment happy-dom
import { createSourceSnapshot } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import {
  createMainDocumentParseConfiguration as createDocumentParseConfiguration
} from 'main_renderer/documentCore/documentParseConfiguration'
import {
  createTestDocumentCoreSession
} from '../../../../document-view/src/documentCore/__tests__/testDocumentCoreSession'
import {
  installTestDocumentHostCapabilities
} from '../helpers/documentHostSession'
import {
  createDocumentEditorHost,
  type DocumentHostOptions
} from '@/components/editorWithTabs/documentCoreDesktopEditor'

const parseConfiguration = createDocumentParseConfiguration({
  footnotes: false,
  gitLabMath: false,
  subscriptAndSuperscript: false
})

const standaloneSession = async(
  source: string
): Promise<DocumentHostOptions['session']> => {
  const session = await createTestDocumentCoreSession(
    createSourceSnapshot(source),
    parseConfiguration
  )
  return installTestDocumentHostCapabilities(session, {
    writeClipboardMaterialization:
      async() => Object.freeze({ kind: 'written' as const }),
    pasteClipboard: target => session.dispatch({
      kind: 'paste-text',
      target,
      text: '',
      source: 'external-text'
    })
  })
}

describe('A17 diagnosis at the desktop host boundary', () => {
  it('authors, edits and removes one commented span', async() => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const host = await createDocumentEditorHost({
      element,
      session: await standaloneSession('alpha target omega\n'),
      configuration: {}
    })

    host.setSelection(6, 12)
    await host.settled()
    expect(host.selection().selectedText).toBe('target')

    expect(await host.createCriticMarkup({
      type: 'comment',
      comment: 'first note'
    })).toBe(true)
    await host.settled()
    console.log('AFTER ADD', JSON.stringify(host.getMarkdownSync()))

    const afterAdd = host.getCriticMarkupReviewSnapshot()
    console.log('ITEMS AFTER ADD', JSON.stringify(afterAdd.items.map(item => ({
      id: item.id,
      type: item.type,
      anchorId: item.anchorId ?? null
    }))))
    const commentItem = afterAdd.items.find(item => item.type === 'comment')
    if (commentItem === undefined) throw new Error('no comment card')

    const edited = await host.editCriticMarkupComment(
      { revisionId: afterAdd.revisionId, nodeId: commentItem.id },
      'edited note'
    )
    await host.settled()
    console.log('EDIT RESULT', edited, JSON.stringify(host.getMarkdownSync()))

    const afterEdit = host.getCriticMarkupReviewSnapshot()
    console.log('ITEMS AFTER EDIT', JSON.stringify(afterEdit.items.map(item => ({
      id: item.id,
      type: item.type,
      anchorId: item.anchorId ?? null
    }))))
    const editedItem = afterEdit.items.find(item => item.type === 'comment')
    if (editedItem === undefined) throw new Error('no comment card after edit')

    const removed = await host.resolveCriticMarkup('accept', {
      revisionId: afterEdit.revisionId,
      nodeId: editedItem.id
    })
    await host.settled()
    console.log('REMOVE RESULT', removed, JSON.stringify(host.getMarkdownSync()))

    expect(host.getMarkdownSync()).toBe('alpha target omega\n')
  })
})

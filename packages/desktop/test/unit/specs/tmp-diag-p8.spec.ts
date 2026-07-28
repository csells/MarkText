// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  createMainDocumentParseConfiguration as createDocumentParseConfiguration
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

const createHost = async(
  element: HTMLElement,
  source: string
): Promise<DocumentEditorHost> => {
  const session = await createTestDocumentCoreSession(
    createSourceSnapshot(source),
    createDocumentParseConfiguration({
      footnotes: false,
      gitLabMath: false,
      subscriptAndSuperscript: false
    })
  )
  return await createDocumentEditorHost({
    element,
    session: installTestDocumentHostCapabilities(session, {
      pasteClipboard: async() => {
        throw new Error('no paste')
      },
      writeClipboardMaterialization: async() =>
        Object.freeze({ kind: 'written' as const })
    }),
    configuration: {}
  })
}

const selectText = (host: HTMLElement, needle: string): void => {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  const node = nodes.find(candidate => candidate.data.includes(needle))
  if (node === undefined) throw new Error(`no text node with ${needle}`)
  const range = document.createRange()
  range.setStart(node, node.data.indexOf(needle))
  range.setEnd(node, node.data.indexOf(needle) + needle.length)
  const selection = document.getSelection()
  if (selection === null) throw new Error('no selection')
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('P8 diagnosis through the real desktop editor host', () => {
  it('add comment, edit comment, then remove the annotation', async() => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = await createHost(element, 'alpha target omega\n')

    selectText(element, 'target')
    await editor.commitAuthoringSelection()
    const authored = await editor.createCriticMarkup({
      type: 'comment',
      comment: 'workflow note'
    })
    await editor.settled()
    // eslint-disable-next-line no-console
    console.log('AUTHORED', authored, JSON.stringify(editor.getMarkdownSync()))

    const afterAdd = editor.getCriticMarkupReviewSnapshot()
    // eslint-disable-next-line no-console
    console.log('SNAPSHOT AFTER ADD', JSON.stringify({
      revisionId: afterAdd.revisionId,
      items: afterAdd.items.map(item => ({
        id: item.id,
        type: item.type,
        anchorId: item.anchorId,
        anchorText: item.anchorText
      }))
    }))

    const commentItem = afterAdd.items.find(item => item.type === 'comment')
    if (commentItem === undefined) throw new Error('no comment item')
    const edited = await editor.editCriticMarkupComment(
      { revisionId: afterAdd.revisionId, nodeId: commentItem.id },
      'edited workflow note'
    )
    await editor.settled()
    // eslint-disable-next-line no-console
    console.log('EDITED', edited, JSON.stringify(editor.getMarkdownSync()))

    const afterEdit = editor.getCriticMarkupReviewSnapshot()
    // eslint-disable-next-line no-console
    console.log('SNAPSHOT AFTER EDIT', JSON.stringify({
      revisionId: afterEdit.revisionId,
      items: afterEdit.items.map(item => ({
        id: item.id,
        type: item.type,
        anchorId: item.anchorId
      }))
    }))

    const target = afterEdit.items.find(item => item.type === 'comment')
    if (target === undefined) throw new Error('no comment item after edit')
    const removed = await editor.resolveCriticMarkup('accept', {
      revisionId: afterEdit.revisionId,
      nodeId: target.id
    })
    await editor.settled()
    // eslint-disable-next-line no-console
    console.log('REMOVED', removed, JSON.stringify(editor.getMarkdownSync()))

    expect(editor.getMarkdownSync()).toBe('alpha target omega\n')
    await editor.destroy()
  })
})

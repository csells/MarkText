// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: { electron?: { ipcRenderer?: unknown } }
  }
  w.window ??= {}
  w.window.electron = {
    ipcRenderer: {
      send: () => {},
      on: () => () => {}
    }
  }
})

import {
  createMainDocumentParseConfiguration as createDocumentParseConfiguration
} from 'main_renderer/documentCore/documentParseConfiguration'
import { createSourceSnapshot } from '@marktext/document-core'
import type { ICriticMarkupReviewEditor } from '@marktext/document-view'
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
import ReviewSidebar from '@/components/sideBar/review.vue'
import {
  useCriticMarkupReviewController
} from '@/components/editorWithTabs/useCriticMarkupReviewController'

const messages = {
  en: {
    sideBar: {
      review: {
        title: 'Review',
        summary: '{count} review items',
        trackChanges: 'Track Changes',
        unavailable: 'Review is unavailable in this view.',
        actionUnavailable: 'unavailable',
        empty: 'No review items',
        removeComment: 'Remove comment',
        removeHighlight: 'Remove highlight',
        types: {
          addition: 'Addition',
          deletion: 'Deletion',
          substitution: 'Substitution',
          highlight: 'Highlight',
          comment: 'Comment'
        },
        addComment: 'Comment',
        cancel: 'Cancel',
        commentPlaceholder: 'Add a comment...',
        composeTitle: 'New comment',
        edit: 'Edit',
        saveEdit: 'Save',
        commentEditFailed: 'failed'
      }
    },
    menu: {
      review: {
        display: 'Display',
        trackChanges: 'Track Changes',
        acceptCurrent: 'Accept Change',
        rejectCurrent: 'Reject Change',
        showMarked: 'Show Markup',
        showOriginal: 'Show Original',
        showRevised: 'Show Revised'
      }
    }
  }
}

const flush = async(): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await nextTick()
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

describe('P8 diagnosis through the real renderer chain', () => {
  it('removes the comment from the sidebar card', async() => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const session = await createTestDocumentCoreSession(
      createSourceSnapshot('alpha target omega\n'),
      createDocumentParseConfiguration({
        footnotes: false,
        gitLabMath: false,
        subscriptAndSuperscript: false
      })
    )
    const editor: DocumentEditorHost = await createDocumentEditorHost({
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

    const pinia = createPinia()
    setActivePinia(pinia)
    const host = defineComponent({
      setup() {
        useCriticMarkupReviewController({
          editor: shallowRef(editor as unknown as ICriticMarkupReviewEditor),
          documentId: ref('document:1'),
          sourceCode: ref(false),
          requestText: async() => null,
          cancelTextRequest: () => {},
          commandNotificationSink: {
            pushTabNotification: (value: unknown) => {
              // eslint-disable-next-line no-console
              console.log('NOTIFICATION', JSON.stringify(value))
            }
          },
          translate: key => key
        })
        return () => h(ReviewSidebar)
      }
    })
    const wrapper = mount(host, {
      attachTo: document.body,
      global: {
        plugins: [
          pinia,
          createI18n({ legacy: false, locale: 'en', messages })
        ],
        stubs: { ElSwitch: true }
      }
    })

    try {
      selectText(element, 'target')
      await editor.commitAuthoringSelection()
      await editor.createCriticMarkup({
        type: 'comment',
        comment: 'workflow note'
      })
      await editor.settled()
      await flush()
      // eslint-disable-next-line no-console
      console.log('AFTER ADD', JSON.stringify(editor.getMarkdownSync()))

      const card = wrapper.get('.review-card.type-comment')
      // eslint-disable-next-line no-console
      console.log('CARD', card.attributes('data-critic-id'))

      await card.get('[class="edit"], button').trigger('click')
      await flush()
      // eslint-disable-next-line no-console
      console.log(
        'BUTTONS',
        card.findAll('button').map(b => b.text()).join(' | ')
      )

      const editBox = wrapper.find('.comment-edit textarea')
      // eslint-disable-next-line no-console
      console.log('EDIT BOX', editBox.exists())
      if (editBox.exists()) {
        await editBox.setValue('edited workflow note')
        await wrapper.get('.comment-edit .submit').trigger('click')
        await flush()
        await editor.settled()
        await flush()
      }
      // eslint-disable-next-line no-console
      console.log('AFTER EDIT', JSON.stringify(editor.getMarkdownSync()))

      const remove = wrapper.findAll('button')
        .find(b => b.text() === 'Remove comment')
      if (remove === undefined) throw new Error('no Remove comment button')
      await remove.trigger('click')
      await flush()
      await editor.settled()
      await flush()
      // eslint-disable-next-line no-console
      console.log('AFTER REMOVE', JSON.stringify(editor.getMarkdownSync()))

      expect(editor.getMarkdownSync()).toBe('alpha target omega\n')
    } finally {
      wrapper.unmount()
      await editor.destroy()
    }
  })
})

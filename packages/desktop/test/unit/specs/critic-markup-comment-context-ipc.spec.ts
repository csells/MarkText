import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref, shallowRef, type App } from 'vue'
import type {
  ICriticMarkupReviewEditor,
  ICriticMarkupReviewItem,
  ICriticMarkupReviewSnapshot
} from '@marktext/document-view'

const { ipcListeners, ipcSend } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const send = vi.fn()
  const w = globalThis as unknown as {
    window?: { electron?: { ipcRenderer?: unknown } }
  }
  w.window ??= {}
  w.window.electron = {
    ipcRenderer: {
      send,
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
        return () => listeners.delete(channel)
      }
    }
  }
  return { ipcListeners: listeners, ipcSend: send }
})

import { useCriticMarkupReviewController } from '@/components/editorWithTabs/useCriticMarkupReviewController'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'

const comment: ICriticMarkupReviewItem = {
  id: 'critic-comment-1',
  type: 'comment',
  path: [0, 'text'],
  start: 10,
  end: 26,
  sourceStart: 10,
  sourceEnd: 26,
  raw: '{>>review note<<}',
  payloadSource: 'review note',
  content: 'review note',
  anchorId: 'critic-highlight-1',
  anchorText: 'selected words'
}

const snapshot: ICriticMarkupReviewSnapshot = {
  revisionId: 'revision:1',
  items: [comment],
  currentItemId: comment.id,
  canCreateAddition: true,
  canCreateDeletion: true,
  canCreateSubstitution: true,
  canCreateHighlight: true,
  canCreateComment: true,
  canNavigate: true,
  canResolveCurrent: true,
  canResolveAll: true,
  trackChanges: false,
  projection: 'marked'
}

function fakeEditor() {
  return {
    subscribeReview: vi.fn(() => ({ dispose: vi.fn() })),
    getCriticMarkupReviewSnapshot: vi.fn(() => snapshot),
    getCriticMarkupCommentAtPoint: vi.fn(() => comment),
    commitAuthoringSelection: vi.fn(),
    editCriticMarkupComment: vi.fn(),
    createCriticMarkup: vi.fn(),
    focusCriticMarkup: vi.fn(),
    navigateCriticMarkup: vi.fn(),
    resolveCriticMarkup: vi.fn(),
    resolveAllCriticMarkup: vi.fn(),
    configure: vi.fn()
  }
}

function mountController(editor: ReturnType<typeof fakeEditor>): App {
  const app = createApp(defineComponent({
    setup() {
      useCriticMarkupReviewController({
        editor: shallowRef(editor as unknown as ICriticMarkupReviewEditor),
        documentId: ref('document:1'),
        sourceCode: ref(false),
        requestText: async() => null,
        cancelTextRequest: () => {},
        commandNotificationSink: { pushTabNotification: () => {} },
        translate: key => key
      })
      return () => h('div')
    }
  }))
  const pinia = createPinia()
  setActivePinia(pinia)
  app.use(pinia)
  app.mount(document.createElement('div'))
  return app
}

describe('CriticMarkup editor context IPC', () => {
  beforeEach(() => {
    ipcSend.mockClear()
    ipcListeners.clear()
  })

  it('answers one native-menu point query with the exact parser-owned comment target', () => {
    const editor = fakeEditor()
    const app = mountController(editor)
    try {
      const query = { requestId: 'request-7', x: 41, y: 73 }
      ipcListeners.get('mt::cm-query-editor-context')?.({}, query)

      expect(editor.getCriticMarkupCommentAtPoint).toHaveBeenCalledWith(41, 73)
      expect(ipcSend).toHaveBeenCalledWith('mt::cm-editor-context-response', {
        requestId: 'request-7',
        documentId: 'document:1',
        target: {
          revisionId: 'revision:1',
          nodeId: comment.id
        }
      })
    } finally {
      app.unmount()
    }
  })

  it('answers with no target when the DOM identity is stale during the query', () => {
    const editor = fakeEditor()
    editor.getCriticMarkupCommentAtPoint.mockImplementation(() => {
      throw new TypeError('CriticMarkup DOM identity is stale for this revision.')
    })
    const app = mountController(editor)
    try {
      const query = { requestId: 'request-stale', x: 12, y: 19 }

      expect(() => ipcListeners.get('mt::cm-query-editor-context')?.({}, query))
        .not.toThrow()
      expect(ipcSend).toHaveBeenCalledWith('mt::cm-editor-context-response', {
        requestId: query.requestId,
        documentId: null,
        target: null
      })
    } finally {
      app.unmount()
    }
  })

  it('persists one live Edit Comment request until the Review sidebar can consume it', () => {
    const editor = fakeEditor()
    const app = mountController(editor)
    try {
      const request = {
        documentId: 'document:1',
        target: {
          revisionId: 'revision:1',
          nodeId: comment.id
        }
      }
      ipcListeners.get('mt::cm-edit-comment')?.({}, request)

      expect(useCriticMarkupReviewStore().commentEditRequest).toEqual(request)
    } finally {
      app.unmount()
    }
  })

  it('rejects a stale opaque target after the document revision changes', () => {
    const editor = fakeEditor()
    const app = mountController(editor)
    try {
      ipcListeners.get('mt::cm-edit-comment')?.({}, {
        documentId: 'document:1',
        target: {
          revisionId: 'revision:stale',
          nodeId: comment.id
        }
      })

      expect(useCriticMarkupReviewStore().commentEditRequest).toBeNull()
    } finally {
      app.unmount()
    }
  })

  it('rejects a malformed native edit target without throwing', () => {
    const editor = fakeEditor()
    const app = mountController(editor)
    try {
      expect(() => ipcListeners.get('mt::cm-edit-comment')?.({}, {
        documentId: 'document:1',
        target: {
          revisionId: 'revision:1',
          nodeId: comment.id,
          sourceStart: comment.sourceStart
        }
      })).not.toThrow()

      expect(useCriticMarkupReviewStore().commentEditRequest).toBeNull()
    } finally {
      app.unmount()
    }
  })
})

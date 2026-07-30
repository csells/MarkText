// @vitest-environment happy-dom

import {
  createApp,
  defineComponent,
  h,
  ref,
  shallowRef,
  type App
} from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ICriticMarkupReviewEditor,
  ICriticMarkupReviewItem,
  ICriticMarkupReviewSnapshot
} from '@marktext/document-view'

const { ipcSend, pushTabNotification } = vi.hoisted(() => {
  const send = vi.fn()
  const notify = vi.fn()
  const target = globalThis as unknown as {
    window?: {
      electron?: {
        ipcRenderer: {
          send: (...args: unknown[]) => void
          on: () => () => void
        }
      }
    }
  }
  target.window ??= {}
  target.window.electron = {
    ipcRenderer: {
      send,
      on: () => () => {}
    }
  }
  return { ipcSend: send, pushTabNotification: notify }
})

import bus from '@/bus'
import { useCriticMarkupReviewController } from '@/components/editorWithTabs/useCriticMarkupReviewController'

const item: ICriticMarkupReviewItem = {
  id: 'critic-0-7',
  type: 'addition',
  path: [0],
  start: 0,
  end: 7,
  sourceStart: 0,
  sourceEnd: 7,
  raw: '{++x++}',
  payloadSource: 'x',
  content: 'x'
}

const snapshot: ICriticMarkupReviewSnapshot = {
  revisionId: 'revision:1',
  items: [item],
  currentItemId: item.id,
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

const fakeEditor = (): ICriticMarkupReviewEditor => ({
  subscribeReview: () => ({ dispose: () => {} }),
  getCriticMarkupReviewSnapshot: () => snapshot,
  getCriticMarkupCommentAtPoint: () => null,
  createCriticMarkup: async() => true,
  focusCriticMarkup: () => item,
  navigateCriticMarkup: () => item,
  resolveCriticMarkup: async() => false,
  resolveAllCriticMarkup: async() => 1,
  editCriticMarkupComment: async() => true,
  commitAuthoringSelection: () => {},
  configure: async() => {}
})

const mountController = (editor: ICriticMarkupReviewEditor): App => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const app = createApp(defineComponent({
    setup() {
      useCriticMarkupReviewController({
        editor: shallowRef(editor),
        documentId: ref('document:1'),
        sourceCode: ref(false),
        requestText: async() => null,
        cancelTextRequest: () => {},
        commandNotificationSink: { pushTabNotification },
        translate: key => `[${key}]`
      })
      return () => h('div')
    }
  }))
  app.use(pinia)
  app.mount(document.createElement('div'))
  return app
}

const flushController = async(): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('CriticMarkup Review command outcomes', () => {
  beforeEach(() => {
    ipcSend.mockClear()
    pushTabNotification.mockClear()
  })

  afterEach(() => {
    bus.all.clear()
    document.body.innerHTML = ''
  })

  it('visibly rejects a stale sidebar target in the owning tab', async() => {
    const app = mountController(fakeEditor())
    try {
      bus.emit('critic-markup-review-item', {
        documentId: 'document:1',
        action: 'accept',
        target: {
          revisionId: 'revision:1',
          nodeId: item.id
        }
      })
      await flushController()

      expect(pushTabNotification).toHaveBeenCalledWith({
        tabId: 'document:1',
        msg: '[sideBar.review.actionUnavailable]',
        showConfirm: false,
        style: 'warn',
        exclusiveType: 'criticMarkupReviewCommandRejected'
      })
    } finally {
      app.unmount()
    }
  })

  // Non-negotiable 10: a Review command that could not mutate the document must
  // never look like one that did. A dispatch that *rejects* — a refused intent,
  // a publication the renderer cannot mount — took the promise's rejection path
  // and skipped the outcome arm entirely, so the user saw a command that did
  // nothing and reported nothing.
  it('visibly rejects a sidebar command whose dispatch throws', async() => {
    const reporter = vi.fn()
    const host = globalThis as typeof globalThis & {
      reportError: ((error: unknown) => void) | undefined
    }
    const priorReporter = host.reportError
    host.reportError = reporter
    const app = mountController({
      ...fakeEditor(),
      resolveCriticMarkup: async() => {
        throw new Error('remote dispatch refused')
      }
    })
    try {
      bus.emit('critic-markup-review-item', {
        documentId: 'document:1',
        action: 'remove-annotation',
        target: {
          revisionId: 'revision:1',
          nodeId: item.id
        }
      })
      await flushController()

      expect(pushTabNotification).toHaveBeenCalledWith({
        tabId: 'document:1',
        msg: '[sideBar.review.actionUnavailable]',
        showConfirm: false,
        style: 'warn',
        exclusiveType: 'criticMarkupReviewCommandRejected'
      })
      // Telling the user is not a substitute for the diagnostic: the failure
      // still reaches the host error boundary.
      expect(reporter).toHaveBeenCalledTimes(1)
    } finally {
      app.unmount()
      host.reportError = priorReporter
    }
  })

  it('visibly rejects a stale menu or palette command in the owning tab', async() => {
    const app = mountController(fakeEditor())
    try {
      bus.emit('critic-markup-review', 'accept-current')
      await flushController()

      expect(pushTabNotification).toHaveBeenCalledWith({
        tabId: 'document:1',
        msg: '[sideBar.review.actionUnavailable]',
        showConfirm: false,
        style: 'warn',
        exclusiveType: 'criticMarkupReviewCommandRejected'
      })
    } finally {
      app.unmount()
    }
  })
})

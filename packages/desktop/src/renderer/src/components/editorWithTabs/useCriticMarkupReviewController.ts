import { onBeforeUnmount, watch, type Ref } from 'vue'
import type {
  ICriticMarkupReviewEditor,
  ICriticMarkupReviewSnapshot
} from '@muyajs/core'
import bus from '@/bus'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'
import { createCommentComposer } from './commentComposer'
import {
  executeCriticMarkupReviewAction,
  executeCriticMarkupSidebarItemAction,
  buildCriticMarkupSidebarState,
  type CriticMarkupTextRequest
} from './criticMarkupReview'
import type {
  CriticMarkupReviewAction,
  CriticMarkupReviewMenuState,
  CriticMarkupSidebarItemAction
} from '@shared/types/criticMarkup'

interface CriticMarkupReviewControllerOptions {
  editor: Readonly<Ref<ICriticMarkupReviewEditor | null>>
  fileId: Readonly<Ref<string | null>>
  sourceCode: Readonly<Ref<boolean>>
  requestText: CriticMarkupTextRequest
  cancelTextRequest: () => void
}

const unavailableMenuState = (): CriticMarkupReviewMenuState => ({
  available: false,
  canCreateAddition: false,
  canCreateDeletion: false,
  canCreateSubstitution: false,
  canCreateHighlight: false,
  canCreateComment: false,
  canResolveCurrent: false,
  canResolveAll: false,
  trackChanges: false,
  projection: 'marked'
})

const menuStateFromSnapshot = (
  snapshot: ICriticMarkupReviewSnapshot
): CriticMarkupReviewMenuState => ({
  available: true,
  canCreateAddition: snapshot.canCreateAddition,
  canCreateDeletion: snapshot.canCreateDeletion,
  canCreateSubstitution: snapshot.canCreateSubstitution,
  canCreateHighlight: snapshot.canCreateHighlight,
  canCreateComment: snapshot.canCreateComment,
  canResolveCurrent: snapshot.canResolveCurrent,
  canResolveAll: snapshot.canResolveAll,
  trackChanges: snapshot.trackChanges,
  projection: snapshot.projection
})

export function useCriticMarkupReviewController(
  options: CriticMarkupReviewControllerOptions
): void {
  const reviewStore = useCriticMarkupReviewStore()
  // A comment is composed in the sidebar, not a modal. Opening composition
  // flips the store's `composing` signal; the sidebar container reveals the
  // Review compose box, and the box's submit/cancel (bus) resolve the request.
  // muya keeps its cached source selection across the focus change, so the
  // note still wraps the originally selected span.
  const commentComposer = createCommentComposer((active) => {
    reviewStore.SET_COMPOSING(active)
    if (active) {
      // Release editor focus (and hide the inline critic tool) as the compose
      // box takes over. muya keeps its cached source selection, so the note
      // still wraps the originally selected span.
      bus.emit('editor-blur')
    }
  })
  let connectedEditor: ICriticMarkupReviewEditor | null = null
  let snapshotListener: ((snapshot: ICriticMarkupReviewSnapshot) => void) | null = null
  let lastSnapshot: ICriticMarkupReviewSnapshot | null = null
  let contextVersion = 0
  let stopped = false

  const publishMenuState = (state: CriticMarkupReviewMenuState): void => {
    window.electron.ipcRenderer.send('mt::update-review-menu', state)
  }

  const clear = (): void => {
    lastSnapshot = null
    reviewStore.CLEAR()
    publishMenuState(unavailableMenuState())
  }

  const publishSnapshot = (
    sourceEditor: ICriticMarkupReviewEditor,
    snapshot: ICriticMarkupReviewSnapshot
  ): void => {
    const fileId = options.fileId.value
    if (
      stopped ||
      sourceEditor !== connectedEditor ||
      options.sourceCode.value ||
      !fileId
    ) {
      return
    }

    lastSnapshot = snapshot
    reviewStore.UPDATE(buildCriticMarkupSidebarState(fileId, snapshot))
    publishMenuState(menuStateFromSnapshot(snapshot))
  }

  const publishCurrent = (): void => {
    const sourceEditor = connectedEditor
    if (!sourceEditor || options.sourceCode.value || !options.fileId.value) {
      clear()
      return
    }
    publishSnapshot(sourceEditor, sourceEditor.getCriticMarkupReviewSnapshot())
  }

  const disconnectEditor = (): void => {
    if (connectedEditor && snapshotListener) {
      connectedEditor.off('critic-markup-review-change', snapshotListener)
    }
    snapshotListener = null
    connectedEditor = null
  }

  const connectEditor = (nextEditor: ICriticMarkupReviewEditor | null): void => {
    if (nextEditor === connectedEditor) return
    disconnectEditor()
    connectedEditor = nextEditor
    if (connectedEditor) {
      const sourceEditor = connectedEditor
      snapshotListener = (snapshot) => publishSnapshot(sourceEditor, snapshot)
      connectedEditor.on('critic-markup-review-change', snapshotListener)
    }
    publishCurrent()
  }

  const invalidateContext = (): number => {
    contextVersion += 1
    options.cancelTextRequest()
    commentComposer.cancel()
    return contextVersion
  }

  const handleReviewAction = async(action: unknown): Promise<void> => {
    const targetEditor = connectedEditor
    const targetFileId = options.fileId.value
    if (!targetEditor || !targetFileId || options.sourceCode.value) return

    const targetVersion = contextVersion
    await executeCriticMarkupReviewAction(
      targetEditor,
      action as CriticMarkupReviewAction,
      async(kind) => {
        // A comment's text comes from the sidebar compose box; every other
        // text-bearing action (substitution) still uses the prompt modal.
        const value = kind === 'comment'
          ? await commentComposer.request()
          : await options.requestText(kind)
        if (
          value === null ||
          targetEditor !== connectedEditor ||
          targetFileId !== options.fileId.value ||
          options.sourceCode.value ||
          targetVersion !== contextVersion
        ) {
          return null
        }
        return value
      }
    )
  }

  const handleCommentSubmit = (text: unknown): void => {
    commentComposer.submit(typeof text === 'string' ? text : '')
  }

  const handleCommentCancel = (): void => {
    commentComposer.cancel()
  }

  const handleSidebarAction = (payload: unknown): void => {
    const targetEditor = connectedEditor
    const fileId = options.fileId.value
    if (!targetEditor || !fileId || options.sourceCode.value) return

    executeCriticMarkupSidebarItemAction(
      targetEditor,
      payload as CriticMarkupSidebarItemAction,
      lastSnapshot?.projection ?? 'marked',
      fileId
    )
  }

  const handleDocumentContextChange = (): void => {
    invalidateContext()
  }

  bus.on('critic-markup-review', handleReviewAction)
  bus.on('critic-markup-review-item', handleSidebarAction)
  bus.on('critic-markup-comment-submit', handleCommentSubmit)
  bus.on('critic-markup-comment-cancel', handleCommentCancel)
  bus.on('file-loaded', handleDocumentContextChange)
  bus.on('file-changed', handleDocumentContextChange)

  const stopEditorWatch = watch(
    options.editor,
    (nextEditor) => {
      invalidateContext()
      connectEditor(nextEditor)
    },
    { immediate: true, flush: 'sync' }
  )
  const stopContextWatch = watch(
    [options.fileId, options.sourceCode],
    () => {
      const version = invalidateContext()
      clear()
      queueMicrotask(() => {
        if (!stopped && version === contextVersion) publishCurrent()
      })
    },
    { immediate: true, flush: 'sync' }
  )

  onBeforeUnmount(() => {
    stopped = true
    invalidateContext()
    stopEditorWatch()
    stopContextWatch()
    bus.off('critic-markup-review', handleReviewAction)
    bus.off('critic-markup-review-item', handleSidebarAction)
    bus.off('critic-markup-comment-submit', handleCommentSubmit)
    bus.off('critic-markup-comment-cancel', handleCommentCancel)
    bus.off('file-loaded', handleDocumentContextChange)
    bus.off('file-changed', handleDocumentContextChange)
    disconnectEditor()
    clear()
  })
}

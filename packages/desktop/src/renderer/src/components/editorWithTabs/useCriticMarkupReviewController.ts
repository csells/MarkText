import { onBeforeUnmount, watch, type Ref } from 'vue'
import type {
  ICriticMarkupReviewEditor,
  ICriticMarkupReviewSnapshot
} from '@muyajs/core'
import bus from '@/bus'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'
import { createCommentComposer } from './commentComposer'
import { isCriticMarkupCommentEditSubmission } from './criticMarkupCommentEdit'
import {
  executeCriticMarkupReviewAction,
  executeCriticMarkupSidebarItemAction,
  buildCriticMarkupSidebarState,
  type CriticMarkupTextRequest
} from './criticMarkupReview'
import {
  isCriticMarkupCommentEditRequest,
  type CriticMarkupEditorContextRequest,
  type CriticMarkupReviewAction,
  type CriticMarkupReviewMenuState,
  type CriticMarkupSidebarItem,
  type CriticMarkupSidebarItemAction
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

    // Capture the live selection into the model before the compose box takes
    // focus, so the note wraps the text the user actually selected rather than
    // a stale range.
    if (action === 'add-comment') {
      targetEditor.commitAuthoringSelection()
    }

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

  const handleCommentEdit = (payload: unknown): void => {
    const targetEditor = connectedEditor
    if (!isCriticMarkupCommentEditSubmission(payload)) return

    let saved = false
    if (targetEditor && options.fileId.value && !options.sourceCode.value) {
      try {
        saved = targetEditor.editCriticMarkupComment(payload.target, payload.text)
      } catch {
        // The engine normally fails closed with `false`. Treat an unexpected
        // exception the same way at this UI boundary so the draft is retained.
      }
    }
    payload.acknowledge({ outcome: saved ? 'saved' : 'rejected' })
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

  const handleEditorContextQuery = (
    _event: unknown,
    request: CriticMarkupEditorContextRequest
  ): void => {
    if (
      !request ||
      typeof request.requestId !== 'string' ||
      !Number.isFinite(request.x) ||
      !Number.isFinite(request.y)
    ) {
      return
    }

    const targetEditor = connectedEditor
    const fileId = options.fileId.value
    let target: CriticMarkupSidebarItem | null = null
    try {
      target = targetEditor && fileId && !options.sourceCode.value
        ? targetEditor.getCriticMarkupCommentAtPoint(request.x, request.y)
        : null
    } catch {
      // The parser-owned point API deliberately throws for stale DOM identity.
      // This IPC boundary fails closed so the main process can show the normal
      // context menu instead of surfacing an obsolete Edit Comment target.
    }
    window.electron.ipcRenderer.send('mt::cm-editor-context-response', target && fileId
      ? { requestId: request.requestId, fileId, target }
      : { requestId: request.requestId, fileId: null, target: null })
  }

  const isExactLiveComment = (
    live: CriticMarkupSidebarItem,
    target: CriticMarkupSidebarItem
  ): boolean => live.type === 'comment' && target.type === 'comment' &&
    live.id === target.id &&
    live.start === target.start &&
    live.end === target.end &&
    live.sourceStart === target.sourceStart &&
    live.sourceEnd === target.sourceEnd &&
    live.raw === target.raw &&
    live.content === target.content &&
    live.anchorId === target.anchorId &&
    live.anchorText === target.anchorText &&
    live.path.length === target.path.length &&
    live.path.every((part, index) => part === target.path[index])

  const handleNativeCommentEdit = (
    _event: unknown,
    request: unknown
  ): void => {
    const targetEditor = connectedEditor
    const fileId = options.fileId.value
    if (
      !targetEditor ||
      !fileId ||
      options.sourceCode.value ||
      !isCriticMarkupCommentEditRequest(request) ||
      request.fileId !== fileId
    ) {
      return
    }

    const live = targetEditor.getCriticMarkupReviewSnapshot().items.find(item =>
      isExactLiveComment(item, request.target))
    if (live) reviewStore.REQUEST_COMMENT_EDIT({ fileId, target: live })
  }

  // A bare selection change (notably a same-block mouse drag) emits no engine
  // review event, so the Review menu's create-capabilities would go stale. On
  // each selection change: commit the live range into the model (so it survives
  // the blur when a menu or the compose box takes focus — the selection is gone
  // by the time an authoring command runs), then re-read the live snapshot so
  // canCreateComment and the rest track the current selection.
  const handleRefresh = (): void => {
    const targetEditor = connectedEditor
    if (targetEditor && !options.sourceCode.value) {
      targetEditor.commitAuthoringSelection()
    }
    publishCurrent()
  }

  // The DOM selectionchange fires for every selection — including a same-block
  // mouse drag, which emits no engine review event. Debounce it (it is very
  // frequent) into a review refresh so the live range is committed and the
  // capabilities track the selection.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  const onSelectionChange = (): void => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      handleRefresh()
    }, 120)
  }

  bus.on('critic-markup-review', handleReviewAction)
  bus.on('critic-markup-review-item', handleSidebarAction)
  bus.on('critic-markup-comment-submit', handleCommentSubmit)
  bus.on('critic-markup-comment-cancel', handleCommentCancel)
  bus.on('critic-markup-comment-edit', handleCommentEdit)
  bus.on('critic-markup-refresh', handleRefresh)
  bus.on('file-loaded', handleDocumentContextChange)
  bus.on('file-changed', handleDocumentContextChange)
  document.addEventListener('selectionchange', onSelectionChange)
  const stopEditorContextQuery = window.electron.ipcRenderer.on(
    'mt::cm-query-editor-context',
    handleEditorContextQuery
  )
  const stopNativeCommentEdit = window.electron.ipcRenderer.on(
    'mt::cm-edit-comment',
    handleNativeCommentEdit
  )

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
    bus.off('critic-markup-comment-edit', handleCommentEdit)
    bus.off('critic-markup-refresh', handleRefresh)
    bus.off('file-loaded', handleDocumentContextChange)
    bus.off('file-changed', handleDocumentContextChange)
    document.removeEventListener('selectionchange', onSelectionChange)
    stopEditorContextQuery()
    stopNativeCommentEdit()
    if (refreshTimer) clearTimeout(refreshTimer)
    disconnectEditor()
    clear()
  })
}

import { onBeforeUnmount, watch, type Ref } from 'vue'
import type {
  ICriticMarkupReviewEditor,
  ICriticMarkupReviewSnapshot
} from '@marktext/document-view'
import { reportAsyncTask } from '@marktext/document-view'
import bus from '@/bus'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'
import { createCommentComposer } from './commentComposer'
import { isCriticMarkupCommentEditSubmission } from './criticMarkupCommentEdit'
import {
  CRITIC_MARKUP_REVIEW_COMMAND_OUTCOMES,
  executeCriticMarkupReviewAction,
  executeCriticMarkupSidebarItemAction,
  buildCriticMarkupSidebarState,
  presentCriticMarkupReviewCommandOutcome,
  settleCriticMarkupReviewSelection,
  type CriticMarkupReviewCommandNotificationSink,
  type CriticMarkupReviewCommandOutcome,
  type CriticMarkupTextRequest
} from './criticMarkupReview'
import {
  decodeCriticMarkupEditorContextRequest,
  isCriticMarkupCommentEditRequest,
  type CriticMarkupReviewMenuState,
  type CriticMarkupSidebarItem
} from '@shared/types/criticMarkup'

interface CriticMarkupReviewControllerOptions {
  editor: Readonly<Ref<ICriticMarkupReviewEditor | null>>
  documentId: Readonly<Ref<string | null>>
  sourceCode: Readonly<Ref<boolean>>
  requestText: CriticMarkupTextRequest
  cancelTextRequest: () => void
  commandNotificationSink: CriticMarkupReviewCommandNotificationSink
  translate: (key: string) => string
}

const unavailableMenuState = (): CriticMarkupReviewMenuState => ({
  available: false,
  canCreateAddition: false,
  canCreateDeletion: false,
  canCreateSubstitution: false,
  canCreateHighlight: false,
  canCreateComment: false,
  canNavigate: false,
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
  canNavigate: snapshot.canNavigate,
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
  // The editor keeps its source selection across the focus change, so the note
  // still wraps the originally selected span.
  const commentComposer = createCommentComposer((active) => {
    reviewStore.SET_COMPOSING(active)
    if (active) {
      // Release editor focus (and hide the inline critic tool) as the compose
      // box takes over. The editor keeps its cached source selection, so the note
      // still wraps the originally selected span.
      bus.emit('editor-blur')
    }
  })
  let connectedEditor: ICriticMarkupReviewEditor | null = null
  let reviewSubscription: Readonly<{ dispose: () => void }> | null = null
  let lastSnapshot: ICriticMarkupReviewSnapshot | null = null
  let contextVersion = 0
  let stopped = false
  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  const publishMenuState = (state: CriticMarkupReviewMenuState): void => {
    reviewStore.UPDATE_COMMAND_STATE(state)
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
    const documentId = options.documentId.value
    if (
      stopped ||
      sourceEditor !== connectedEditor ||
      options.sourceCode.value ||
      !documentId
    ) {
      return
    }

    lastSnapshot = snapshot
    reviewStore.UPDATE(buildCriticMarkupSidebarState(documentId, snapshot))
    publishMenuState(menuStateFromSnapshot(snapshot))
  }

  const publishCurrent = (): void => {
    const sourceEditor = connectedEditor
    if (!sourceEditor || options.sourceCode.value || !options.documentId.value) {
      clear()
      return
    }
    publishSnapshot(sourceEditor, sourceEditor.getCriticMarkupReviewSnapshot())
  }

  const disconnectEditor = (): void => {
    reviewSubscription?.dispose()
    reviewSubscription = null
    connectedEditor = null
  }

  const connectEditor = (nextEditor: ICriticMarkupReviewEditor | null): void => {
    if (nextEditor === connectedEditor) return
    disconnectEditor()
    connectedEditor = nextEditor
    if (connectedEditor) {
      const sourceEditor = connectedEditor
      reviewSubscription = connectedEditor.subscribeReview(
        (snapshot) => publishSnapshot(sourceEditor, snapshot)
      )
    }
    publishCurrent()
  }

  const invalidateContext = (): number => {
    contextVersion += 1
    options.cancelTextRequest()
    commentComposer.cancel()
    return contextVersion
  }

  const presentCommandOutcome = (
    outcome: CriticMarkupReviewCommandOutcome,
    documentId: string
  ): void => {
    presentCriticMarkupReviewCommandOutcome(
      outcome,
      documentId,
      options.commandNotificationSink,
      options.translate
    )
  }

  const handleReviewAction = async(action: unknown): Promise<void> => {
    const targetEditor = connectedEditor
    const targetDocumentId = options.documentId.value
    if (!targetDocumentId) return
    if (!targetEditor || options.sourceCode.value) {
      presentCommandOutcome(
        CRITIC_MARKUP_REVIEW_COMMAND_OUTCOMES.unavailable,
        targetDocumentId
      )
      return
    }

    const targetVersion = contextVersion
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    await settleCriticMarkupReviewSelection(targetEditor, action)
    if (
      targetEditor !== connectedEditor ||
      targetDocumentId !== options.documentId.value ||
      options.sourceCode.value ||
      targetVersion !== contextVersion
    ) {
      presentCommandOutcome(
        CRITIC_MARKUP_REVIEW_COMMAND_OUTCOMES.stale,
        targetDocumentId
      )
      return
    }

    let outcome = await executeCriticMarkupReviewAction(
      targetEditor,
      action,
      async(kind) => {
        // A comment's text comes from the sidebar compose box; every other
        // text-bearing action (substitution) still uses the prompt modal.
        const value = kind === 'comment'
          ? await commentComposer.request()
          : await options.requestText(kind)
        if (
          value === null ||
          targetEditor !== connectedEditor ||
          targetDocumentId !== options.documentId.value ||
          options.sourceCode.value ||
          targetVersion !== contextVersion
        ) {
          return null
        }
        return value
      }
    )
    if (
      outcome.kind === 'cancelled' &&
      (
        targetEditor !== connectedEditor ||
        targetDocumentId !== options.documentId.value ||
        options.sourceCode.value ||
        targetVersion !== contextVersion
      )
    ) {
      outcome = CRITIC_MARKUP_REVIEW_COMMAND_OUTCOMES.stale
    }
    presentCommandOutcome(outcome, targetDocumentId)
  }

  const handleCommentSubmit = (text: unknown): void => {
    commentComposer.submit(typeof text === 'string' ? text : '')
  }

  const handleCommentCancel = (): void => {
    commentComposer.cancel()
  }

  const handleCommentEdit = async(payload: unknown): Promise<void> => {
    const targetEditor = connectedEditor
    if (!isCriticMarkupCommentEditSubmission(payload)) return

    let saved = false
    const snapshot = targetEditor?.getCriticMarkupReviewSnapshot()
    if (
      targetEditor &&
      payload.documentId === options.documentId.value &&
      !options.sourceCode.value &&
      snapshot?.revisionId === payload.target.revisionId &&
      snapshot.items.some(item =>
        item.type === 'comment' && item.id === payload.target.nodeId)
    ) {
      try {
        saved = await targetEditor.editCriticMarkupComment(
          payload.target,
          payload.text
        )
      } catch {
        // A rejected main-owned mutation is a normal terminal failure at this
        // boundary. The negative acknowledgement keeps the user's draft.
      }
    }
    payload.acknowledge({ outcome: saved ? 'saved' : 'rejected' })
  }

  const handleSidebarAction = (payload: unknown): void => {
    const targetEditor = connectedEditor
    const documentId = options.documentId.value
    if (!documentId) return
    if (!targetEditor || options.sourceCode.value) {
      presentCommandOutcome(
        CRITIC_MARKUP_REVIEW_COMMAND_OUTCOMES.unavailable,
        documentId
      )
      return
    }

    reportAsyncTask(
      executeCriticMarkupSidebarItemAction(
        targetEditor,
        payload,
        lastSnapshot?.projection ?? 'marked',
        documentId
      ).then(
        (outcome) => {
          presentCommandOutcome(outcome, documentId)
        },
        (error: unknown) => {
          // Non-negotiable 10: a rejected dispatch is a command that did not
          // mutate the document, and must say so rather than take the silent
          // rejection path out of this boundary.
          presentCommandOutcome(
            CRITIC_MARKUP_REVIEW_COMMAND_OUTCOMES.unavailable,
            documentId
          )
          throw error
        }
      ),
      'CriticMarkup sidebar action'
    )
  }

  const handleDocumentContextChange = (): void => {
    invalidateContext()
  }

  const handleEditorContextQuery = (
    _event: unknown,
    value: unknown
  ): void => {
    let request
    try {
      request = decodeCriticMarkupEditorContextRequest(value)
    } catch {
      return
    }

    const targetEditor = connectedEditor
    const documentId = options.documentId.value
    let item: CriticMarkupSidebarItem | null = null
    try {
      item = targetEditor && documentId && !options.sourceCode.value
        ? targetEditor.getCriticMarkupCommentAtPoint(request.x, request.y)
        : null
    } catch {
      // The parser-owned point API deliberately throws for stale DOM identity.
      // This IPC boundary fails closed so the main process can show the normal
      // context menu instead of surfacing an obsolete Edit Comment target.
    }
    const snapshot = item && targetEditor
      ? targetEditor.getCriticMarkupReviewSnapshot()
      : null
    window.electron.ipcRenderer.send(
      'mt::cm-editor-context-response',
      item && snapshot && documentId
        ? {
          requestId: request.requestId,
          documentId,
          target: {
            revisionId: snapshot.revisionId,
            nodeId: item.id
          }
        }
        : { requestId: request.requestId, documentId: null, target: null }
    )
  }

  const handleNativeCommentEdit = (
    _event: unknown,
    request: unknown
  ): void => {
    const targetEditor = connectedEditor
    const documentId = options.documentId.value
    if (
      !targetEditor ||
      !documentId ||
      options.sourceCode.value ||
      !isCriticMarkupCommentEditRequest(request) ||
      request.documentId !== documentId
    ) {
      return
    }

    const snapshot = targetEditor.getCriticMarkupReviewSnapshot()
    const live = snapshot.revisionId === request.target.revisionId &&
      snapshot.items.some(item =>
        item.type === 'comment' && item.id === request.target.nodeId)
    if (live) reviewStore.REQUEST_COMMENT_EDIT(request)
  }

  // A bare selection change (notably a same-block mouse drag) emits no engine
  // review event, so the Review menu's create-capabilities would go stale. On
  // each selection change: commit the live range into the model (so it survives
  // the blur when a menu or the compose box takes focus — the selection is gone
  // by the time an authoring command runs), then re-read the live snapshot so
  // canCreateComment and the rest track the current selection.
  const handleRefresh = async(): Promise<void> => {
    const targetEditor = connectedEditor
    if (targetEditor && !options.sourceCode.value) {
      await targetEditor.commitAuthoringSelection()
      if (
        targetEditor !== connectedEditor ||
        options.sourceCode.value
      ) {
        return
      }
    }
    publishCurrent()
  }

  // The DOM selectionchange fires for every selection — including a same-block
  // mouse drag, which emits no engine review event. Debounce it (it is very
  // frequent) into a review refresh so the live range is committed and the
  // capabilities track the selection.
  const onSelectionChange = (): void => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      reportAsyncTask(handleRefresh(), 'CriticMarkup Review refresh')
    }, 120)
  }

  const observeReviewAction = (action: unknown): void => {
    reportAsyncTask(
      handleReviewAction(action),
      'CriticMarkup Review action'
    )
  }
  const observeCommentEdit = (payload: unknown): void => {
    reportAsyncTask(
      handleCommentEdit(payload),
      'CriticMarkup comment edit'
    )
  }
  const observeRefresh = (): void => {
    reportAsyncTask(handleRefresh(), 'CriticMarkup Review refresh')
  }

  bus.on('critic-markup-review', observeReviewAction)
  bus.on('critic-markup-review-item', handleSidebarAction)
  bus.on('critic-markup-comment-submit', handleCommentSubmit)
  bus.on('critic-markup-comment-cancel', handleCommentCancel)
  bus.on('critic-markup-comment-edit', observeCommentEdit)
  bus.on('critic-markup-refresh', observeRefresh)
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
    [options.documentId, options.sourceCode],
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
    bus.off('critic-markup-review', observeReviewAction)
    bus.off('critic-markup-review-item', handleSidebarAction)
    bus.off('critic-markup-comment-submit', handleCommentSubmit)
    bus.off('critic-markup-comment-cancel', handleCommentCancel)
    bus.off('critic-markup-comment-edit', observeCommentEdit)
    bus.off('critic-markup-refresh', observeRefresh)
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

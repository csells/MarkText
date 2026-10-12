<template>
  <div class="source-view">
    <div
      ref="sourceCodeContainer"
      class="source-code"
    />
    <EditorSearch />
  </div>
</template>

<script setup lang="ts">
import type {
  DocumentSelection,
  DocumentTextSelection,
  MarkdownOptions
} from '@marktext/document-core'
import { ref, shallowRef, markRaw, watch, onMounted, onBeforeUnmount } from 'vue'
import { debounce } from 'lodash'
import { createCoreHeadingToc } from '@/documentAuthority/coreHeadingToc'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { scrollSourceEditorToLine } from '@/util/sourceModeToc'
import { storeToRefs } from 'pinia'
import type CodeMirror from 'codemirror'
import codeMirror, { setCursorAtFirstLine, setTextDirection } from '../../codeMirror'
import { matchString, buildRegexValue, type ISearchQueryOptions } from '@muyajs/core'
import { countProjectedText } from '@/documentConsumers/documentProjectionConsumers'
import EditorSearch from '../search/index.vue'
import bus from '../../bus'
import { oneDarkThemes, railscastsThemes } from '@/config'
import {
  createCodeMirrorCoreAdapter,
  createCoreAuthorityPerformanceTestBridge,
  type CodeMirrorCoreAdapter,
  type CoreDocumentViewLease,
  type CoreAuthorityPerformanceTrace
} from '@/documentAuthority'
import { bindCodeMirrorSourceSyntax } from '@/documentAuthority/codeMirrorSourceSyntax'
import { createCodeMirrorRecoveryDraftCapture } from '@/documentAuthority/codeMirrorRecoveryDraftCapture'
import { sourceCodeCoreAdapterOptions } from '@/documentAuthority/sourceCodeCoreAdapterOptions'
import type { CoreRecoveryDraftInput } from '@shared/types/coreRecoveryDraft'
import {
  copyCodeMirrorPosition,
  captureCodeMirrorViewState,
  restoreCodeMirrorViewState,
  type CodeMirrorViewState
} from '@/documentAuthority/codeMirrorViewState'

interface SourceCursor {
  anchor: CodeMirror.Position
  focus: CodeMirror.Position
}

const props = defineProps<{
  markdown?: string
  textDirection: string
  coreLease: CoreDocumentViewLease
  corePerformanceTrace?: CoreAuthorityPerformanceTrace
  initialViewState?: CodeMirrorViewState
  initialDocumentSelection?: DocumentSelection
}>()
const emit = defineEmits<{ (event: 'core-fault', error: unknown): void }>()

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const sourceCodeContainer = ref<HTMLDivElement | null>(null)

// CodeMirror owns its mutable document and selection objects. Vue must not wrap
// those native objects in proxies that cannot cross the recovery IPC boundary.
const editor = shallowRef<CodeMirror.Editor | null>(null)
const viewDestroyed = ref(false)
let coreAdapter: CodeMirrorCoreAdapter | undefined
let detachCoreSourceSyntax: (() => void) | undefined
let coreCompositionInput: HTMLElement | undefined
let coreCompositionStart: (() => void) | undefined
let coreCompositionEnd: (() => void) | undefined
let coreSettlementCheck: (() => void) | undefined
let coreRecoveryDraftCapture: ReturnType<typeof createCodeMirrorRecoveryDraftCapture> | undefined
let projectedInitialSelection: DocumentTextSelection | undefined
let initialSelectionRevision: number | undefined
const captureRecoveryDraft = (error: unknown): CoreRecoveryDraftInput | undefined =>
  coreRecoveryDraftCapture?.(error)
const captureViewState = (): CodeMirrorViewState | undefined =>
  editor.value && sourceCodeContainer.value
    ? captureCodeMirrorViewState(editor.value, sourceCodeContainer.value)
    : undefined
const captureDocumentSelection = (): DocumentSelection | undefined => {
  const selection = coreAdapter?.documentSelection()
  if (selection === undefined) return undefined
  // A source caret cannot express a position inside a normalized model value.
  // Preserve that same position only while its exact projection is unchanged.
  return props.initialDocumentSelection !== undefined &&
    props.coreLease?.identity.revision === initialSelectionRevision &&
    JSON.stringify(selection) === JSON.stringify(projectedInitialSelection)
    ? props.initialDocumentSelection
    : selection
}
const configureCorePreferences = async (
  options: Readonly<Partial<MarkdownOptions>>
): Promise<void> => {
  if (!coreAdapter) throw new Error('Core Source preference view is unavailable')
  const outcome = await coreAdapter.configure(options)
  if (outcome === undefined) throw new Error('Core preferences were not applied')
}
const assertCloseAllowed = (): void => {
  if (coreAdapter?.isComposing()) {
    throw new Error('Finish text composition before closing the window')
  }
}
defineExpose({
  captureRecoveryDraft,
  captureViewState,
  captureDocumentSelection,
  configureCorePreferences,
  assertCloseAllowed
})

const { theme, sourceCode, sourceCodeLineNumbers } = storeToRefs(preferencesStore)
const { currentFile: currentTab } = storeToRefs(editorStore)

let sourceSearchEpoch = 0
let sourceSearchValue = ''
let sourceSearchOptions: ISearchQueryOptions = {}
let sourceSearchMatches: ReturnType<typeof matchString> = []
let sourceSearchIndex = -1
let sourceSearchRevision: number | undefined
let sourceSearchMarks: Array<{ clear(): void }> = []

const clearSourceSearchMarks = (): void => {
  for (const mark of sourceSearchMarks) mark.clear()
  sourceSearchMarks = []
}

const publishSourceSearch = (): void => {
  const result = {
    value: sourceSearchValue,
    index: sourceSearchIndex,
    matches: sourceSearchMatches.map((match) => ({
      start: match.index,
      end: match.index + match.match.length,
      match: match.match
    }))
  }
  const lease = props.coreLease
  editorStore.UPDATE_CORE_CONSUMER_SEARCH(lease.documentId, lease.identity, result)
}

const sourceSearchPosition = (cm: CodeMirror.Editor, offset: number): CodeMirror.Position =>
  coreAdapter?.sourcePosition(offset) ?? cm.posFromIndex(offset)

const presentSourceSearch = (selectMatch = true): void => {
  clearSourceSearchMarks()
  const cm = editor.value
  if (!cm) return
  sourceSearchMarks = sourceSearchMatches.map((match, index) =>
    cm.markText(
      sourceSearchPosition(cm, match.index),
      sourceSearchPosition(cm, match.index + match.match.length),
      { className: index === sourceSearchIndex ? 'source-search-current' : 'source-search-match' }
    )
  )
  const current = sourceSearchMatches[sourceSearchIndex]
  if (selectMatch && current !== undefined) {
    const from = sourceSearchPosition(cm, current.index)
    const to = sourceSearchPosition(cm, current.index + current.match.length)
    scrollSourceEditorToLine(cm, from.line, sourceCodeContainer.value)
    cm.setSelection(from, to, { scroll: false })
  }
  publishSourceSearch()
}

const refreshSourceSearch = async (selectMatch = true): Promise<void> => {
  const epoch = ++sourceSearchEpoch
  const lease = props.coreLease
  const cm = editor.value
  if (!cm) return
  const source = await lease.sourceAtBarrier()
  if (viewDestroyed.value || epoch !== sourceSearchEpoch) return
  sourceSearchRevision = lease.identity.revision
  sourceSearchMatches =
    sourceSearchValue === '' ? [] : matchString(source, sourceSearchValue, sourceSearchOptions)
  sourceSearchIndex = sourceSearchMatches.length === 0 ? -1 : 0
  presentSourceSearch(selectMatch)
}

const sourceSearchFailed = (error: unknown): void => {
  if (!viewDestroyed.value) emit('core-fault', error)
}

const handleSourceSearch = (payload: unknown): void => {
  const { value, opt } = payload as {
    value: string
    opt?: ISearchQueryOptions & { selectHighlight?: boolean }
  }
  sourceSearchValue = value
  sourceSearchOptions = opt ?? {}
  if (value === '') {
    ++sourceSearchEpoch
    sourceSearchMatches = []
    sourceSearchIndex = -1
    clearSourceSearchMarks()
    publishSourceSearch()
    if (opt?.selectHighlight) editor.value?.focus()
    return
  }
  refreshSourceSearch().catch(sourceSearchFailed)
}

const handleSourceFindAction = (direction: unknown): void => {
  if (direction !== 'prev' && direction !== 'next') return
  if (sourceSearchMatches.length === 0 || sourceSearchRevision !== props.coreLease.identity.revision) {
    return
  }
  sourceSearchIndex =
    (sourceSearchIndex + (direction === 'prev' ? -1 : 1) + sourceSearchMatches.length) %
    sourceSearchMatches.length
  presentSourceSearch()
}

const replaceSourceSearch = async (payload: unknown): Promise<void> => {
  const { value, opt } = payload as {
    value: string
    opt?: { isSingle?: boolean; isRegexp?: boolean }
  }
  const epoch = sourceSearchEpoch
  await coreAdapter?.settled()
  if (
    epoch !== sourceSearchEpoch ||
    viewDestroyed.value ||
    sourceSearchRevision !== props.coreLease.identity.revision
  ) {
    return
  }
  const matches =
    opt?.isSingle === false
      ? sourceSearchMatches
      : sourceSearchMatches.slice(sourceSearchIndex, sourceSearchIndex + 1)
  const cm = editor.value
  if (matches.length === 0 || !cm) return
  // Reverse source order preserves every authored match position. CodeMirror's
  // pre-change adapter submits this native operation to Core as one undo step.
  cm.operation(() => {
    for (const match of [...matches].reverse()) {
      cm.replaceRange(
        opt?.isRegexp ? buildRegexValue(match, value) : value,
        sourceSearchPosition(cm, match.index),
        sourceSearchPosition(cm, match.index + match.match.length),
        'search-replace'
      )
    }
  })
  await coreAdapter?.settled()
  await refreshSourceSearch()
}

const handleSourceReplace = (payload: unknown): void => {
  replaceSourceSearch(payload).catch(sourceSearchFailed)
}

const invalidateSourceSearch = (): void => {
  ++sourceSearchEpoch
  clearSourceSearchMarks()
  sourceSearchMatches = []
  sourceSearchIndex = -1
  if (sourceSearchValue !== '') refreshSourceSearch(false).catch(sourceSearchFailed)
}

watch(
  () => props.textDirection,
  (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      setTextDirection(editor.value, value)
    }
  }
)

watch(sourceCodeLineNumbers, (value) => {
  editor.value?.setOption('lineNumbers', value)
})

const getSourceCursor = (cm: CodeMirror.Editor): SourceCursor => ({
  anchor: copyCodeMirrorPosition(cm.getCursor('anchor')),
  focus: copyCodeMirrorPosition(cm.getCursor('head'))
})

const handleSelectAll = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value && editor.value.hasFocus()) {
    editor.value.execCommand('selectAll')
  } else {
    const activeElement = document.activeElement as HTMLElement | null
    const nodeName = activeElement?.nodeName
    if (nodeName === 'INPUT' || nodeName === 'TEXTAREA') {
      const selectable = activeElement as HTMLInputElement | HTMLTextAreaElement | null
      if (selectable && typeof selectable.select === 'function') {
        selectable.select()
      }
    }
  }
}

const refreshCoreSavedState = async (
  outcome: { session: number; revision: number } | undefined
): Promise<void> => {
  if (outcome === undefined) return
  await editorStore.REFRESH_CORE_SAVED_STATE(props.coreLease.documentId, {
    generation: outcome.session,
    revision: outcome.revision
  })
}

const handleUndo = () => {
  if (!sourceCode.value) {
    return
  }

  coreAdapter
    ?.history('undo')
    .then(refreshCoreSavedState)
    .catch((error) => {
      console.error('Core undo failed', error)
      requestCoreRecovery(error)
    })
}

const handleRedo = () => {
  if (!sourceCode.value) {
    return
  }

  coreAdapter
    ?.history('redo')
    .then(refreshCoreSavedState)
    .catch((error) => {
      console.error('Core redo failed', error)
      requestCoreRecovery(error)
    })
}

const requestCoreRecovery = (error: unknown): void => {
  const adapter = coreAdapter
  if (adapter === undefined || adapter.state().status === 'ready') return
  emit('core-fault', error)
}

// `cursorActivity` fires per drag step, so key the dedup on the ranges rather
// than on `getSelection()`, which copies the whole selection.
let lastSelectionKey = ''

const selectionKey = (cm: CodeMirror.Editor): string =>
  cm
    .listSelections()
    .map(({ anchor, head }) => `${anchor.line}:${anchor.ch}-${head.line}:${head.ch}`)
    .join(',')

let selectionCountEpoch = 0

const publishSelectionWordCount = (selectedText: string): void => {
  const hasSelection = selectedText.trim().length > 0
  if (!hasSelection && editorStore.selectionWordCount == null) return
  editorStore.SET_SELECTION_WORD_COUNT(hasSelection ? countProjectedText(selectedText) : null)
}

// The count covers what Revised shows of each selected source range, as Core
// projects it; CodeMirror's text would count CriticMarkup delimiters, deleted
// text and comments. Ranges join with a newline, as CodeMirror joins them.
const updateSelectionWordCount = (cm: CodeMirror.Editor) => {
  const key = selectionKey(cm)
  if (key === lastSelectionKey && editorStore.selectionWordCount != null) return
  lastSelectionKey = key

  const epoch = ++selectionCountEpoch
  const ranges = (coreAdapter?.documentSelection().ranges ?? [])
    .map(({ anchor, focus }) => ({ start: Math.min(anchor, focus), end: Math.max(anchor, focus) }))
    .filter((range) => range.end > range.start)
  if (ranges.length === 0) {
    publishSelectionWordCount('')
    return
  }
  const lease = props.coreLease
  Promise.all(ranges.map((range) => lease.selectionProjectionAtBarrier(range)))
    .then((projections) => {
      if (epoch !== selectionCountEpoch || viewDestroyed.value || props.coreLease !== lease) return
      publishSelectionWordCount(projections.map((projection) => projection.markdown).join('\n'))
    })
    .catch((error) => {
      if (epoch === selectionCountEpoch && !viewDestroyed.value) requestCoreRecovery(error)
    })
}

// #3580: in Source Code mode the WYSIWYG container is hidden, so the
// `scroll-to-header` bus event (emitted when a TOC entry is clicked) must scroll
// CodeMirror instead. Resolve the TOC entry to its heading line in the source.
let sourceTocIdentity: { generation: number; revision: number } | undefined
const updateSourceToc = async () => {
  const lease = props.coreLease
  if (viewDestroyed.value) return
  try {
    const projection = await lease.consumerProjectionAtBarrier()
    if (
      props.coreLease !== lease ||
      viewDestroyed.value ||
      lease.consumerProjection() !== projection
    ) {
      return
    }
    sourceTocIdentity = { ...lease.identity }
    editorStore.UPDATE_CORE_CONSUMER_TOC(
      lease.documentId,
      sourceTocIdentity,
      createCoreHeadingToc(projection)
    )
  } catch (error) {
    if (props.coreLease === lease && !viewDestroyed.value) requestCoreRecovery(error)
  }
}
const refreshSourceToc = debounce(updateSourceToc, 150)

const handleScrollToHeader = async (slug: unknown) => {
  const lease = props.coreLease
  await updateSourceToc()
  if (!editor.value || props.coreLease !== lease || viewDestroyed.value) return
  const identity = lease.identity
  const offset = editorStore.listToc.find((item) => item.slug === slug)?.sourceOffset
  if (
    sourceTocIdentity?.generation !== identity.generation ||
    sourceTocIdentity.revision !== identity.revision ||
    typeof offset !== 'number'
  ) {
    return
  }
  // `.source-code` is the scroll container (CodeMirror renders full-height with
  // viewportMargin: Infinity, so its own scroller never scrolls).
  scrollSourceEditorToLine(
    editor.value,
    editor.value.posFromIndex(offset).line,
    sourceCodeContainer.value
  )
}

onMounted(() => {
  if (!currentTab.value) return
  // reset currentTab scrollTop position because the codeMirror scroll position is completely different from the muya scroll position
  // reset blocks as well because the blocks are only valid in muya
  // reset cursor because this is a direct "key-cursor", not a muyaIndexCursor, which is {focus: number, anchor: number}
  currentTab.value.scrollTop = 0
  currentTab.value.blocks = undefined
  currentTab.value.cursor = undefined

  const { markdown, textDirection } = props
  const container = sourceCodeContainer.value
  const codeMirrorConfig: Record<string, unknown> = {
    value: markdown,
    lineNumbers: sourceCodeLineNumbers.value,
    autofocus: false,
    lineWrapping: true,
    styleActiveLine: true,
    direction: textDirection,
    viewportMargin: Infinity
  }

  if (railscastsThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'railscasts'
  } else if (oneDarkThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'one-dark'
  }

  bus.on('selectAll', handleSelectAll)
  bus.on('undo', handleUndo)
  bus.on('redo', handleRedo)
  bus.on('scroll-to-header', handleScrollToHeader)
  bus.on('searchValue', handleSourceSearch)
  bus.on('replaceValue', handleSourceReplace)
  bus.on('find-action', handleSourceFindAction)

  // CodeMirror's line tree relies on object identity and must not be proxied by Vue.
  const codeMirrorInstance = markRaw(codeMirror(container, codeMirrorConfig))

  codeMirrorInstance.on('contextmenu', (_cm: CodeMirror.Editor, event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  })

  setCursorAtFirstLine(codeMirrorInstance)

  editor.value = codeMirrorInstance
  publishSourceSearch()
  codeMirrorInstance.on('changes', invalidateSourceSearch)

  coreAdapter = createCodeMirrorCoreAdapter(
    codeMirrorInstance.getDoc(),
    props.coreLease.binding,
    {
      nativeHistoryScope: crypto.randomUUID(),
      ...sourceCodeCoreAdapterOptions(
        props.markdown ?? '',
        props.coreLease.lineEnding,
        props.coreLease.identity.revision
      ),
      ...(props.corePerformanceTrace === undefined
        ? {}
        : {
            performanceTrace: {
              documentId: props.coreLease.documentId,
              record: (event) => props.corePerformanceTrace?.capture(event)
            }
          })
    }
  )
  if (props.initialDocumentSelection !== undefined) {
    const projection = props.coreLease.binding.sourceSelectionAtBarrier(
      props.initialDocumentSelection
    )
    if (projection.type !== 'source-selection') {
      throw new Error('Core Source caret projection is unavailable')
    }
    projectedInitialSelection = projection.selection
    initialSelectionRevision = projection.revision
    codeMirrorInstance.setSelections(
      projection.selection.ranges.map(({ anchor, focus }) => ({
        anchor: coreAdapter!.sourcePosition(anchor),
        head: coreAdapter!.sourcePosition(focus)
      })),
      projection.selection.primary,
      { scroll: true }
    )
  }
  const syntaxLease = props.coreLease
  detachCoreSourceSyntax = bindCodeMirrorSourceSyntax({
    editor: codeMirrorInstance,
    adapter: coreAdapter,
    read: (revision) => syntaxLease.projectAcknowledgedSourceSyntax(revision),
    observe: (refresh) => syntaxLease.binding.observe(refresh),
    onFailure: (error) => emit('core-fault', error)
  })
  coreRecoveryDraftCapture = createCodeMirrorRecoveryDraftCapture({
    editor: codeMirrorInstance,
    lease: props.coreLease,
    pathname: currentTab.value?.pathname,
    initialSource: props.markdown,
    nativeIntent: () => coreAdapter?.recoveryDraft()
  })
  props.coreLease.setRecoveryDraftCapture(coreRecoveryDraftCapture)
  const input = codeMirrorInstance.getInputField?.() as HTMLElement | undefined
  if (input !== undefined) {
    coreCompositionInput = input
    coreCompositionStart = () => {
      try {
        coreAdapter?.compositionStart()
      } catch (error) {
        console.error('Core composition start failed', error)
        requestCoreRecovery(error)
      }
    }
    coreCompositionEnd = () => {
      coreAdapter?.compositionEnd().catch((error) => {
        console.error('Core composition commit failed', error)
        requestCoreRecovery(error)
      })
    }
    input.addEventListener('compositionstart', coreCompositionStart)
    input.addEventListener('compositionend', coreCompositionEnd)
  }
  let latest: unknown
  const stopObserving = props.coreLease.binding.observe((event) => {
    if (event.outcome.type !== 'applied') return
    refreshSourceToc()
    editorStore.LISTEN_FOR_CORE_CONTENT_CHANGE(
      props.coreLease?.documentId ?? '',
      Object.freeze({
        generation: event.identity.generation,
        revision: event.outcome.revision
      })
    )
    latest = Object.freeze({
      revision: event.outcome.revision,
      sourceLength: event.outcome.sourceLength,
      change: event.outcome.change
    })
  })
  codeMirrorInstance.on('cursorActivity', (cm: CodeMirror.Editor) => {
    updateSelectionWordCount(cm)
    editorStore.LISTEN_FOR_CORE_CURSOR_CHANGE(
      props.coreLease?.documentId ?? '',
      getSourceCursor(cm)
    )
  })
  editorStore.LISTEN_FOR_CORE_CURSOR_CHANGE(
    props.coreLease.documentId,
    getSourceCursor(codeMirrorInstance)
  )
  coreSettlementCheck = () => {
    sourceTocIdentity = undefined
    const adapter = coreAdapter
    if (adapter === undefined) return
    adapter.settled().catch(requestCoreRecovery)
  }
  codeMirrorInstance.on('change', coreSettlementCheck)
  updateSourceToc()
  props.coreLease.reconcileExternal(async (outcome) => {
    if (coreAdapter === undefined) throw new Error('Source view has no document owner')
    await coreAdapter.reconcileApplied(outcome)
  })
  props.coreLease.settleView(
    async () => {
      try {
        await coreAdapter?.settled()
      } catch (error) {
        requestCoreRecovery(error)
        throw error
      }
    },
    () => coreAdapter?.isSettled() === true
  )
  props.corePerformanceTrace?.record('first-editable-viewport', props.coreLease.documentId, {
    surface: 'source'
  })
  props.coreLease.onHandoff(() => {
    detachCoreSourceSyntax?.()
    detachCoreSourceSyntax = undefined
    refreshSourceToc.cancel()
    sourceTocIdentity = undefined
    if (coreSettlementCheck !== undefined) {
      codeMirrorInstance.off('change', coreSettlementCheck)
      coreSettlementCheck = undefined
    }
    if (coreCompositionStart !== undefined) {
      coreCompositionInput?.removeEventListener('compositionstart', coreCompositionStart)
    }
    if (coreCompositionEnd !== undefined) {
      coreCompositionInput?.removeEventListener('compositionend', coreCompositionEnd)
    }
    coreCompositionInput = undefined
    coreCompositionStart = undefined
    coreCompositionEnd = undefined
    stopObserving()
    coreAdapter?.dispose()
    coreAdapter = undefined
    coreRecoveryDraftCapture = undefined
    delete window.__marktextDocumentCore
  })
  const corePerformanceTestBridge = createCoreAuthorityPerformanceTestBridge(
    window.electron.process.env.PERF_TESTING === 'true',
    props.coreLease
  )
  if (corePerformanceTestBridge !== undefined) {
    window.__marktextDocumentCore = Object.freeze({
      documentId: props.coreLease.documentId,
      generation: props.coreLease.identity.generation,
      async settled (): Promise<void> {
        await coreAdapter?.settled()
      },
      latest: () => latest,
      ...corePerformanceTestBridge,
      performanceEvents: () => props.corePerformanceTrace?.events() ?? [],
      performanceSurface: () => 'source' as const,
      performanceStatus: () =>
        props.corePerformanceTrace?.status() ?? {
          accepting: false,
          eventCount: 0
        },
      async resolveCriticMarkup (kind, start, end, decision): Promise<void> {
        const adapter = coreAdapter
        if (adapter === undefined) {
          throw new Error('Core Source adapter is unavailable')
        }
        try {
          const state = adapter.state()
          if (state.status !== 'ready') {
            throw new Error('Core Source adapter is not ready')
          }
          await adapter.resolve(
            { kind, range: { start, end } },
            state.lastAcceptedRevision,
            decision
          )
        } catch (error) {
          requestCoreRecovery(error)
          throw error
        }
      }
    })
  }
  const initialViewState = props.initialViewState
  if (initialViewState !== undefined) {
    const restore = () => {
      if (!viewDestroyed.value && container !== null) {
        restoreCodeMirrorViewState(codeMirrorInstance, container, initialViewState)
      }
    }
    restore()
    // The replacement's scroll extent settles after its first layout.
    requestAnimationFrame(restore)
  }
  // A restored selection equal to the projected one raises no cursorActivity,
  // so the title bar's selected count is read once the caret is final.
  updateSelectionWordCount(codeMirrorInstance)
  // Constructor autofocus precedes CodeMirror's focus listener registration
  // and leaves a 20 ms interval where native input is ignored. Activate only
  // after its listeners, selection and Core ownership are established.
  codeMirrorInstance.getInputField().focus()
})

onBeforeUnmount(() => {
  ++sourceSearchEpoch
  clearSourceSearchMarks()
  editor.value?.off('changes', invalidateSourceSearch)
  detachCoreSourceSyntax?.()
  detachCoreSourceSyntax = undefined
  refreshSourceToc.cancel()
  viewDestroyed.value = true
  delete window.__marktextDocumentCore

  bus.off('selectAll', handleSelectAll)
  bus.off('undo', handleUndo)
  bus.off('redo', handleRedo)
  editorStore.SET_SELECTION_WORD_COUNT(null)
  lastSelectionKey = ''
  bus.off('scroll-to-header', handleScrollToHeader)
  bus.off('searchValue', handleSourceSearch)
  bus.off('replaceValue', handleSourceReplace)
  bus.off('find-action', handleSourceFindAction)
})
</script>

<style>
.source-view {
  position: relative;
}
.source-search-match {
  background: var(--selectionColor);
}
.source-search-current {
  background: var(--highlightThemeColor);
}
.source-code {
  height: calc(100vh - var(--titleBarHeight));
  box-sizing: border-box;
  overflow: auto;
}
.source-code .CodeMirror {
  height: auto;
  margin: 50px auto;
  max-width: var(--editorAreaWidth);
  background: transparent;
}
.source-code .CodeMirror-gutters {
  border-right: none;
  background-color: transparent;
}
.source-code .CodeMirror-activeline-background,
.source-code .CodeMirror-activeline-gutter {
  background: var(--floatHoverColor);
}
/* Fade the delimiters against the formula. Dimming the inherited colour rather
   than naming one is what carries across every theme; 0.65 is the lowest value
   still clearing 3:1 in all of them, with one-dark at 3.67 setting the floor. */
.source-code .CodeMirror .cm-formatting-math {
  opacity: 0.65;
}
</style>

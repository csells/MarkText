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
import { ref, shallowRef, markRaw, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { debounce } from 'lodash'
import { createCoreHeadingToc } from '@/documentAuthority/coreHeadingToc'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { findMarkdownHeadingLine, scrollSourceEditorToLine } from '@/util/sourceModeToc'
import { storeToRefs } from 'pinia'
import type CodeMirror from 'codemirror'
import codeMirror, { setCursorAtFirstLine, setTextDirection } from '../../codeMirror'
import {
  wordCount as getWordCount,
  matchString,
  buildRegexValue,
  type ISearchQueryOptions
} from '@muyajs/core'
import EditorSearch from '../search/index.vue'
import { adjustCursor } from '../../util'
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

interface MuyaIndexCursorLike {
  anchor: CodeMirror.Position
  focus: CodeMirror.Position
}

const props = defineProps<{
  markdown?: string
  muyaIndexCursor?: unknown
  textDirection: string
  coreLease?: CoreDocumentViewLease
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
const commitTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const viewDestroyed = ref(false)
const tabId = ref<string | null>(null)
let coreAdapter: CodeMirrorCoreAdapter | undefined
let detachCoreSourceSyntax: (() => void) | undefined
let coreCompositionInput: HTMLElement | undefined
let coreCompositionStart: (() => void) | undefined
let coreCompositionEnd: (() => void) | undefined
let coreSettlementCheck: (() => void) | undefined
let requestedSourceSnapshots = 0
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
  const lease = props.coreLease
  if (!coreAdapter || !lease) throw new Error('Core Source preference view is unavailable')
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

const {
  theme,
  sourceCode,
  sourceCodeLineNumbers,
  texMathDollars,
  texMathGfm,
  texMathSingleBackslash,
  texMathDoubleBackslash
} = storeToRefs(preferencesStore)
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
  if (lease === undefined) editorStore.SEARCH(result)
  else editorStore.UPDATE_CORE_CONSUMER_SEARCH(lease.documentId, lease.identity, result)
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
  const source = lease === undefined ? cm.getValue() : await lease.sourceAtBarrier()
  if (viewDestroyed.value || epoch !== sourceSearchEpoch) return
  sourceSearchRevision = lease?.identity.revision
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
  if (
    sourceSearchMatches.length === 0 ||
    (props.coreLease !== undefined && sourceSearchRevision !== props.coreLease.identity.revision)
  ) {
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
    (props.coreLease !== undefined && sourceSearchRevision !== props.coreLease.identity.revision)
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

const isValidMuyaIndexCursor = (cursor: unknown): cursor is MuyaIndexCursorLike => {
  const c = cursor as MuyaIndexCursorLike | null | undefined
  return !!(c && c.anchor && c.focus)
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

// A fresh instance reads these at mount; the watch is for a preference changed
// while the source view is already open (#5446).
const markdownMathMode = () => ({
  name: 'markdown-math',
  texMathDollars: texMathDollars.value,
  texMathGfm: texMathGfm.value,
  texMathSingleBackslash: texMathSingleBackslash.value,
  texMathDoubleBackslash: texMathDoubleBackslash.value
})

watch([texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash], () => {
  if (props.coreLease === undefined) editor.value?.setOption('mode', markdownMathMode())
})

const getMuyaCursor = (cm: CodeMirror.Editor): MuyaIndexCursorLike => {
  let focus = cm.getCursor('head')
  let anchor = cm.getCursor('anchor')
  const convertToMuyaCursor = (cursor: CodeMirror.Position) => {
    const line = cm.getLine(cursor.line)
    const preLine = cm.getLine(cursor.line - 1)
    const nextLine = cm.getLine(cursor.line + 1)
    return adjustCursor(
      cursor,
      preLine,
      line,
      nextLine,
      (lineNumber) => {
        return cm.getLine(lineNumber)
      },
      cm.lineCount()
    )
  }

  anchor = convertToMuyaCursor(anchor) // Selection start as Muya cursor
  focus = convertToMuyaCursor(focus) // Selection end as Muya cursor

  // Normalize cursor that `anchor` is always before `focus` because
  // this is the expected behavior in Muya.
  if (anchor && focus && anchor.line > focus.line) {
    const tmpCursor = focus
    focus = anchor
    anchor = tmpCursor
  }
  return { focus, anchor }
}

const getSourceCursor = (cm: CodeMirror.Editor): MuyaIndexCursorLike => ({
  anchor: copyCodeMirrorPosition(cm.getCursor('anchor')),
  focus: copyCodeMirrorPosition(cm.getCursor('head'))
})

const getMarkdownAndCursor = (cm: CodeMirror.Editor) => {
  const cursor = getMuyaCursor(cm)
  requestedSourceSnapshots += 1
  const markdown: string = cm.getValue()
  return { cursor, markdown }
}

/**
 * This is to write the OLD content of the editor before switching to another tab
 * @param id
 */
const prepareTabSwitch = () => {
  if (props.coreLease !== undefined) return
  if (commitTimer.value) clearTimeout(commitTimer.value)
  if (tabId.value && editor.value) {
    const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(editor.value)
    editorStore.LISTEN_FOR_CONTENT_CHANGE({
      id: tabId.value,
      markdown: newMarkdown,
      muyaIndexCursor: cursor
    })
    tabId.value = null
  }
}

interface FileChangePayloadLike {
  id: string
  markdown?: string
  muyaIndexCursor?: unknown
}

const handleFileChange = (payload: unknown) => {
  if (props.coreLease !== undefined) return
  const { id, markdown: newMarkdown, muyaIndexCursor } = payload as FileChangePayloadLike
  if (!editor.value) return

  // On same-tab reload (external file change), preserve scroll across
  // setValue. Snapshot every plausible scroll element (the outer
  // .source-code div, CodeMirror's own scroller, and the nearest scrollable
  // ancestor) and restore each, since which one is actually active depends
  // on CodeMirror's height:auto + outer overflow:auto interplay. Re-apply
  // on nextTick and the next animation frame to outlast layout side-effects
  // from sibling handlers: muya editor.vue also listens for file-changed.
  // A cross-tab switch must instead commit the outgoing tab's state; the
  // fresh markdown from disk would otherwise overwrite uncommitted edits.
  const isSameTabReload = tabId.value && tabId.value === id
  const scrollTargets: Array<{ el: HTMLElement; top: number }> = []
  if (isSameTabReload) {
    const seen = new Set<HTMLElement>()
    const consider = (el: HTMLElement | null | undefined) => {
      if (el && !seen.has(el)) {
        seen.add(el)
        scrollTargets.push({ el, top: el.scrollTop })
      }
    }
    consider(sourceCodeContainer.value)
    consider(editor.value.getScrollerElement?.() as HTMLElement | null | undefined)
    let node: HTMLElement | null = sourceCodeContainer.value?.parentElement ?? null
    while (node && node !== document.body) {
      const overflowY = window.getComputedStyle(node).overflowY
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight
      ) {
        consider(node)
        break
      }
      node = node.parentElement
    }
  } else {
    prepareTabSwitch()
    tabId.value = id
  }

  if (typeof newMarkdown === 'string') {
    editor.value.setValue(newMarkdown)
  }

  // t('editor.sourceCode.cursorNullComment')
  if (props.coreLease === undefined && isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor

    editor.value.setSelection(copyCodeMirrorPosition(anchor), copyCodeMirrorPosition(focus), {
      scroll: true
    }) // Scroll the focus into view.
  } else if (scrollTargets.length) {
    const restoreScroll = () => {
      for (const { el, top } of scrollTargets) el.scrollTop = top
    }
    restoreScroll()
    nextTick(restoreScroll)
    requestAnimationFrame(restoreScroll)
  } else {
    setCursorAtFirstLine(editor.value)
  }
}

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
  if (outcome === undefined || props.coreLease === undefined) return
  await editorStore.REFRESH_CORE_SAVED_STATE(props.coreLease.documentId, {
    generation: outcome.session,
    revision: outcome.revision
  })
}

const handleUndo = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value) {
    if (coreAdapter !== undefined) {
      coreAdapter
        .history('undo')
        .then(refreshCoreSavedState)
        .catch((error) => {
          console.error('Core undo failed', error)
          requestCoreRecovery(error)
        })
    } else {
      editor.value.execCommand('undo')
    }
  }
}

const handleRedo = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value) {
    if (coreAdapter !== undefined) {
      coreAdapter
        .history('redo')
        .then(refreshCoreSavedState)
        .catch((error) => {
          console.error('Core redo failed', error)
          requestCoreRecovery(error)
        })
    } else {
      editor.value.execCommand('redo')
    }
  }
}

const requestCoreRecovery = (error: unknown): void => {
  const adapter = coreAdapter
  const lease = props.coreLease
  if (adapter === undefined || lease === undefined || adapter.state().status === 'ready') return
  emit('core-fault', error)
}

interface ImageActionPayload {
  id: string
  result: string
  alt: string
}

const handleImageAction = (payload: unknown) => {
  if (props.coreLease !== undefined) return
  const cm = editor.value
  if (!cm) return

  const { id, result, alt } = payload as ImageActionPayload
  const value: string = cm.getValue()
  const focus = cm.getCursor('focus')
  const anchor = cm.getCursor('anchor')
  const lines: string[] = value.split('\n')
  const index = lines.findIndex((line: string) => line.indexOf(id) > 0)

  if (index > -1) {
    const oldLine = lines[index]
    lines[index] = oldLine.replace(new RegExp(`!\\[${id}\\]\\(.*\\)`), `![${alt}](${result})`)
    const newValue = lines.join('\n')
    cm.setValue(newValue)
    const match = /(!\[.*\]\(.*\))/.exec(oldLine)
    if (!match) {
      // t('editor.sourceCode.imageStructureDeletedComment')
      return
    }
    const range = {
      start: match.index,
      end: match.index + match[1].length
    }
    const delta = alt.length + result.length + 5 - match[1].length

    const adjustPointer = (pointer: CodeMirror.Position) => {
      if (!pointer) {
        return
      }
      if (pointer.line !== index) {
        return
      }
      if (pointer.ch <= range.start) {
        // do nothing.
      } else if (pointer.ch > range.start && pointer.ch < range.end) {
        pointer.ch = range.start + alt.length + result.length + 5
      } else {
        pointer.ch += delta
      }
    }

    adjustPointer(focus)
    adjustPointer(anchor)
    if (focus && anchor) {
      cm.setSelection(copyCodeMirrorPosition(anchor), copyCodeMirrorPosition(focus), {
        scroll: true
      })
    } else {
      setCursorAtFirstLine(cm)
    }
  }
}

// `cursorActivity` fires per drag step, so key the dedup on the ranges rather
// than on `getSelection()`, which copies the whole selection.
let lastSelectionKey = ''

const selectionKey = (cm: CodeMirror.Editor): string =>
  cm
    .listSelections()
    .map(({ anchor, head }) => `${anchor.line}:${anchor.ch}-${head.line}:${head.ch}`)
    .join(',')

const updateSelectionWordCount = (cm: CodeMirror.Editor) => {
  const key = selectionKey(cm)
  if (key === lastSelectionKey && editorStore.selectionWordCount != null) return
  lastSelectionKey = key

  const selectedText = cm.getSelection()
  const hasSelection = selectedText.trim().length > 0
  if (!hasSelection && editorStore.selectionWordCount == null) return

  editorStore.SET_SELECTION_WORD_COUNT(hasSelection ? getWordCount(selectedText) : null)
}

const saveContent = (cm: CodeMirror.Editor) => {
  if (props.coreLease !== undefined) return
  const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(cm)
  // Attention: the cursor may be `{focus: null, anchor: null}` when press `backspace`
  const wordCount = getWordCount(newMarkdown)
  // See "beforeDestroy" note
  if (!viewDestroyed.value) {
    if (tabId.value) {
      editorStore.LISTEN_FOR_CONTENT_CHANGE({
        id: tabId.value,
        markdown: newMarkdown,
        wordCount,
        muyaIndexCursor: cursor
      })
    } else {
      // This may occur during tab switching but should not occur otherwise.
      console.warn('LISTEN_FOR_CONTENT_CHANGE: Cannot commit changes because not tab id was set!')
    }
  }
}

const listenChange = (cm: CodeMirror.Editor) => {
  cm.on('cursorActivity', (instance: CodeMirror.Editor) => {
    saveContent(instance)
    updateSelectionWordCount(instance)
  })
}

// #3580: in Source Code mode the WYSIWYG container is hidden, so the
// `scroll-to-header` bus event (emitted when a TOC entry is clicked) must scroll
// CodeMirror instead. Resolve the TOC entry to its heading line in the source.
let sourceTocIdentity: { generation: number; revision: number } | undefined
const updateSourceToc = async () => {
  const lease = props.coreLease
  if (lease === undefined || viewDestroyed.value) return
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
  if (!editor.value) return
  if (props.coreLease !== undefined) {
    const lease = props.coreLease
    await updateSourceToc()
    if (props.coreLease !== lease || viewDestroyed.value) return
    const identity = lease.identity
    const offset = editorStore.listToc.find((item) => item.slug === slug)?.sourceOffset
    if (
      sourceTocIdentity?.generation !== identity.generation ||
      sourceTocIdentity.revision !== identity.revision ||
      typeof offset !== 'number'
    ) {
      return
    }
    scrollSourceEditorToLine(
      editor.value,
      editor.value.posFromIndex(offset).line,
      sourceCodeContainer.value
    )
    return
  }
  const index = editorStore.listToc.findIndex((item) => item.slug === slug)
  if (index < 0) return
  const line = findMarkdownHeadingLine(editor.value.getValue(), index)
  if (line < 0) return
  // `.source-code` is the scroll container (CodeMirror renders full-height with
  // viewportMargin: Infinity, so its own scroller never scrolls).
  scrollSourceEditorToLine(editor.value, line, sourceCodeContainer.value)
}

onMounted(() => {
  if (!currentTab.value) return
  const { id } = currentTab.value
  // reset currentTab scrollTop position because the codeMirror scroll position is completely different from the muya scroll position
  // reset blocks as well because the blocks are only valid in muya
  // reset cursor because this is a direct "key-cursor", not a muyaIndexCursor, which is {focus: number, anchor: number}
  currentTab.value.scrollTop = 0
  currentTab.value.blocks = undefined
  currentTab.value.cursor = undefined

  const { markdown, muyaIndexCursor, textDirection } = props
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

  bus.on('file-loaded', handleFileChange)
  bus.on('file-changed', handleFileChange)
  bus.on('selectAll', handleSelectAll)
  bus.on('undo', handleUndo)
  bus.on('redo', handleRedo)
  bus.on('image-action', handleImageAction)
  bus.on('scroll-to-header', handleScrollToHeader)
  bus.on('searchValue', handleSourceSearch)
  bus.on('replaceValue', handleSourceReplace)
  bus.on('find-action', handleSourceFindAction)

  // CodeMirror's line tree relies on object identity and must not be proxied by Vue.
  const codeMirrorInstance = markRaw(codeMirror(container, codeMirrorConfig))

  // Standalone compatibility retains its mode (see
  // src/renderer/src/codeMirror/markdownMathMode.ts); bound Source installs the
  // common model's syntax below, including owned literal-language boundaries.
  if (props.coreLease === undefined) codeMirrorInstance.setOption('mode', markdownMathMode())

  codeMirrorInstance.on('contextmenu', (_cm: CodeMirror.Editor, event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  })

  if (props.coreLease === undefined && isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor
    codeMirrorInstance.setSelection(copyCodeMirrorPosition(anchor), copyCodeMirrorPosition(focus), {
      scroll: true
    })
  } else {
    setCursorAtFirstLine(codeMirrorInstance)
  }

  editor.value = codeMirrorInstance
  tabId.value = id
  updateSelectionWordCount(codeMirrorInstance)
  publishSourceSearch()
  codeMirrorInstance.on('changes', invalidateSourceSearch)

  if (props.coreLease !== undefined) {
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
        mode: 'core',
        worker: 'dedicated',
        revision: event.outcome.revision,
        sourceLength: event.outcome.sourceLength,
        requestedSourceSnapshots,
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
        mode: 'core',
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
  } else {
    listenChange(codeMirrorInstance)
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
  if (props.coreLease !== undefined) delete window.__marktextDocumentCore
  if (commitTimer.value) clearTimeout(commitTimer.value)

  bus.off('file-loaded', handleFileChange)
  bus.off('file-changed', handleFileChange)
  bus.off('selectAll', handleSelectAll)
  bus.off('undo', handleUndo)
  bus.off('redo', handleRedo)
  bus.off('image-action', handleImageAction)
  editorStore.SET_SELECTION_WORD_COUNT(null)
  lastSelectionKey = ''
  bus.off('scroll-to-header', handleScrollToHeader)
  bus.off('searchValue', handleSourceSearch)
  bus.off('replaceValue', handleSourceReplace)
  bus.off('find-action', handleSourceFindAction)

  if (props.coreLease === undefined && editor.value) {
    const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(editor.value)
    bus.emit('file-changed', {
      id: tabId.value,
      markdown: newMarkdown,
      muyaIndexCursor: cursor,
      renderCursor: true
    })
  }
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

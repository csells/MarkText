<template>
  <div
    ref="sourceCodeContainer"
    class="source-code"
  />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useEditorStore } from '@/store/editor'
import { useLayoutStore } from '@/store/layout'
import { usePreferencesStore } from '@/store/preferences'
import { findMarkdownHeadingLine, scrollSourceEditorToLine } from '@/util/sourceModeToc'
import { storeToRefs } from 'pinia'
import codeMirror, { setCursorAtFirstLine, setTextDirection } from '../../codeMirror'
import {
  appendCommentReplyMetadata,
  COMMENT_MARKER_PATTERN,
  createCommentMetadata,
  encodeCommentMetadata,
  nextCommentId,
  parseCommentMetadataDefinition,
  parseMarkdownComments,
  updateCommentMetadataInMarkdown,
  wordCount as getWordCount,
  type ICommentMetadata,
  type ICommentReplyInput,
  type TUpdateCommentThreadPatch
} from '@muyajs/core'
import { adjustCursor } from '../../util'
import bus from '../../bus'
import { oneDarkThemes, railscastsThemes } from '@/config'

// CodeMirror 5 ships no first-party types; the wrapper in src/renderer/src/
// codeMirror/index.ts also keeps the surface intentionally loose.
type CMInstance = any
type CMCursor = any

interface CMPosition {
  line: number
  ch: number
}

interface SourceCommentRange {
  start: CMPosition
  end: CMPosition
}

interface SourceCommentIndexRange {
  id: string
  start: number
  end: number
}

interface SourceCommentSyntaxIndexRange {
  start: number
  end: number
}

interface SourceCommentCandidate {
  id: string
  range: SourceCommentRange
}

interface SourceSelectionSnapshot {
  anchor: CMPosition
  focus: CMPosition
}

interface MuyaIndexCursorLike {
  anchor: CMCursor
  focus: CMCursor
}

const props = defineProps<{
  markdown?: string
  muyaIndexCursor?: unknown
  textDirection: string
}>()

const editorStore = useEditorStore()
const layoutStore = useLayoutStore()
const preferencesStore = usePreferencesStore()

const sourceCodeContainer = ref<HTMLDivElement | null>(null)

const editor = ref<CMInstance>(null)
const viewDestroyed = ref(false)
const tabId = ref<string | null>(null)

const { theme, sourceCode } = storeToRefs(preferencesStore)
const { currentFile: currentTab } = storeToRefs(editorStore)

const isValidMuyaIndexCursor = (cursor: unknown): cursor is MuyaIndexCursorLike => {
  const c = cursor as MuyaIndexCursorLike | null | undefined
  return !!(c && c.anchor && c.focus)
}

const clampSourceCursor = (cm: CMInstance, cursor: CMPosition): CMPosition => {
  const lastLine = Math.max(0, cm.lineCount() - 1)
  const line = Math.min(Math.max(cursor.line, 0), lastLine)
  const lineText = cm.getLine(line) ?? ''
  return {
    line,
    ch: Math.min(Math.max(cursor.ch, 0), lineText.length)
  }
}

const restoreSourceSelection = (cm: CMInstance, selection: SourceSelectionSnapshot): void => {
  cm.setSelection(
    clampSourceCursor(cm, selection.anchor),
    clampSourceCursor(cm, selection.focus),
    { scroll: false }
  )
}

const cloneSourceCursor = (cursor: CMPosition): CMPosition => ({
  line: cursor.line,
  ch: cursor.ch
})

watch(
  () => props.textDirection,
  (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      setTextDirection(editor.value, value)
    }
  }
)

const getMarkdownAndCursor = (cm: CMInstance) => {
  let focus = cm.getCursor('head')
  let anchor = cm.getCursor('anchor')

  const markdown: string = cm.getValue()
  const convertToMuyaCursor = (cursor: CMCursor) => {
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
  return { cursor: { focus, anchor }, markdown }
}

/**
 * This is to write the OLD content of the editor before switching to another tab
 * @param id
 */
const prepareTabSwitch = () => {
  if (tabId.value) {
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
  let sourceSelection: SourceSelectionSnapshot | null = null
  if (isSameTabReload) {
    const cursor = cloneSourceCursor(editor.value.getCursor())
    sourceSelection = editor.value.somethingSelected?.()
      ? {
          anchor: cloneSourceCursor(editor.value.getCursor('anchor')),
          focus: cloneSourceCursor(editor.value.getCursor('head'))
        }
      : { anchor: cursor, focus: cursor }
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

  const restoreSameTabSourceView = () => {
    if (sourceSelection && editor.value) restoreSourceSelection(editor.value, sourceSelection)
    for (const { el, top } of scrollTargets) el.scrollTop = top
  }

  if (typeof newMarkdown === 'string') {
    if (sourceSelection) {
      editor.value.operation(() => {
        editor.value.setValue(newMarkdown)
        restoreSourceSelection(editor.value, sourceSelection)
      })
    } else {
      editor.value.setValue(newMarkdown)
    }
  }

  // t('editor.sourceCode.cursorNullComment')
  if (!isSameTabReload && isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor

    editor.value.setSelection(anchor, focus, { scroll: true }) // Scroll the focus into view.
  } else if (scrollTargets.length) {
    restoreSameTabSourceView()
    nextTick(restoreSameTabSourceView)
    requestAnimationFrame(restoreSameTabSourceView)
    window.setTimeout(restoreSameTabSourceView, 0)
  } else {
    setCursorAtFirstLine(editor.value)
  }
}

const handleInvalidateImageCache = () => {
  if (editor.value) {
    editor.value.invalidateImageCache()
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

const handleUndo = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value) {
    editor.value.execCommand('undo')
  }
}

const handleRedo = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value) {
    editor.value.execCommand('redo')
  }
}

const getSourceCommentRange = (cm: CMInstance): SourceCommentRange | null => {
  const anchor = cm.getCursor('anchor') as CMPosition
  const focus = cm.getCursor('head') as CMPosition
  const anchorIndex = cm.indexFromPos(anchor)
  const focusIndex = cm.indexFromPos(focus)
  if (anchorIndex === focusIndex) return null

  return anchorIndex < focusIndex
    ? { start: anchor, end: focus }
    : { start: focus, end: anchor }
}

const collectCommentIds = (markdown: string): string[] => {
  const ids = new Set<string>()
  const comments = parseMarkdownComments(markdown)
  for (const thread of comments.threads) ids.add(thread.id)
  for (const range of comments.ranges) ids.add(range.id)

  const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'g')
  let markerMatch: RegExpExecArray | null
  while ((markerMatch = markerRegExp.exec(markdown))) {
    const id = markerMatch[2]
    if (id) ids.add(id)
  }

  for (const line of markdown.split(/\r\n|\n|\r/u)) {
    const metadata = parseCommentMetadataDefinition(line)
    if (metadata) ids.add(metadata.id)
  }

  return [...ids]
}

const sourceLineEnding = (markdown: string): string => {
  if (markdown.includes('\r\n')) return '\r\n'
  if (markdown.includes('\r')) return '\r'
  return '\n'
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const SOURCE_COMMENT_MARKER_START_REGEXP = new RegExp(`^${COMMENT_MARKER_PATTERN}`, 'u')

const lineEndLength = (rawLine: string): number => {
  const match = /(?:\r\n|\n|\r)$/u.exec(rawLine)
  return match ? match[0].length : 0
}

const sourceFencedCodeIndexRanges = (markdown: string): SourceCommentSyntaxIndexRange[] => {
  const ranges: SourceCommentSyntaxIndexRange[] = []
  const lineRegExp = /[^\r\n]*(?:\r\n|\n|\r|$)/gu
  let lineMatch: RegExpExecArray | null
  let fence:
    | {
      char: '`' | '~'
      length: number
      start: number
    }
    | null = null

  while ((lineMatch = lineRegExp.exec(markdown))) {
    const rawLine = lineMatch[0]
    if (rawLine.length === 0) break

    const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine))
    if (fence) {
      const closing = /^( {0,3})(`{3,}|~{3,})(?:[ \t]*)$/u.exec(lineText)
      if (
        closing &&
        closing[2][0] === fence.char &&
        closing[2].length >= fence.length
      ) {
        ranges.push({ start: fence.start, end: lineMatch.index + rawLine.length })
        fence = null
      }
      continue
    }

    const opening = /^( {0,3})(`{3,}|~{3,})/u.exec(lineText)
    if (opening) {
      fence = {
        char: opening[2][0] as '`' | '~',
        length: opening[2].length,
        start: lineMatch.index
      }
    }
  }

  if (fence) ranges.push({ start: fence.start, end: markdown.length })
  return ranges
}

const sourceInlineCodeIndexRanges = (
  markdown: string,
  ignoredRanges: SourceCommentSyntaxIndexRange[]
): SourceCommentSyntaxIndexRange[] => {
  const ranges: SourceCommentSyntaxIndexRange[] = []
  const lineRegExp = /[^\r\n]*(?:\r\n|\n|\r|$)/gu
  let lineMatch: RegExpExecArray | null

  while ((lineMatch = lineRegExp.exec(markdown))) {
    const rawLine = lineMatch[0]
    if (rawLine.length === 0) break
    if (indexInsideRanges(lineMatch.index, ignoredRanges)) continue

    const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine))
    let cursor = 0
    while (cursor < lineText.length) {
      const start = lineText.indexOf('`', cursor)
      if (start < 0) break

      let tickCount = 1
      while (lineText[start + tickCount] === '`') tickCount += 1

      const marker = '`'.repeat(tickCount)
      const end = lineText.indexOf(marker, start + tickCount)
      if (end < 0) break

      ranges.push({
        start: lineMatch.index + start,
        end: lineMatch.index + end + tickCount
      })
      cursor = end + tickCount
    }
  }

  return ranges
}

const indexInsideRanges = (index: number, ranges: SourceCommentSyntaxIndexRange[]): boolean =>
  ranges.some(range => index >= range.start && index < range.end)

const rangesOverlap = (
  start: number,
  end: number,
  ranges: SourceCommentSyntaxIndexRange[]
): boolean =>
  ranges.some(range => start < range.end && end > range.start)

const sourceFrontMatterIndexRanges = (markdown: string): SourceCommentSyntaxIndexRange[] => {
  const opening = /^(---|\+\+\+)[ \t]*(?:\r\n|\n|\r)/u.exec(markdown)
  if (!opening) return []

  const marker = opening[1]
  const lineRegExp = /[^\r\n]*(?:\r\n|\n|\r|$)/gu
  lineRegExp.lastIndex = opening[0].length
  let lineMatch: RegExpExecArray | null
  while ((lineMatch = lineRegExp.exec(markdown))) {
    const rawLine = lineMatch[0]
    if (rawLine.length === 0) break

    const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine))
    if (lineText.trim() === marker) {
      return [{ start: 0, end: lineMatch.index + rawLine.length }]
    }
  }

  return [{ start: 0, end: markdown.length }]
}

const sourceMathBlockIndexRanges = (
  markdown: string,
  ignoredRanges: SourceCommentSyntaxIndexRange[]
): SourceCommentSyntaxIndexRange[] => {
  const ranges: SourceCommentSyntaxIndexRange[] = []
  const lineRegExp = /[^\r\n]*(?:\r\n|\n|\r|$)/gu
  let lineMatch: RegExpExecArray | null
  let start: number | null = null

  while ((lineMatch = lineRegExp.exec(markdown))) {
    const rawLine = lineMatch[0]
    if (rawLine.length === 0) break
    if (indexInsideRanges(lineMatch.index, ignoredRanges)) continue

    const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine))
    if (!/^ {0,3}\$\$[ \t]*$/u.test(lineText)) continue

    if (start == null) {
      start = lineMatch.index
    } else {
      ranges.push({ start, end: lineMatch.index + rawLine.length })
      start = null
    }
  }

  if (start != null) ranges.push({ start, end: markdown.length })
  return ranges
}

const sourceHtmlBlockIndexRanges = (
  markdown: string,
  ignoredRanges: SourceCommentSyntaxIndexRange[]
): SourceCommentSyntaxIndexRange[] => {
  const ranges: SourceCommentSyntaxIndexRange[] = []
  const lineRegExp = /[^\r\n]*(?:\r\n|\n|\r|$)/gu
  let lineMatch: RegExpExecArray | null
  let start: number | null = null
  let closing: RegExp | null = null

  while ((lineMatch = lineRegExp.exec(markdown))) {
    const rawLine = lineMatch[0]
    if (rawLine.length === 0) break
    if (indexInsideRanges(lineMatch.index, ignoredRanges)) continue

    const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine))
    const trimmed = lineText.trim()
    if (start != null) {
      if (!trimmed || closing?.test(trimmed)) {
        ranges.push({ start, end: lineMatch.index + rawLine.length })
        start = null
        closing = null
      }
      continue
    }

    if (/^<!--/u.test(trimmed)) {
      if (SOURCE_COMMENT_MARKER_START_REGEXP.test(trimmed)) continue

      if (/-->/u.test(trimmed)) {
        ranges.push({ start: lineMatch.index, end: lineMatch.index + rawLine.length })
      } else {
        start = lineMatch.index
        closing = /-->/u
      }
      continue
    }

    const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s|>|\/>)/u.exec(trimmed)
    if (!tag) continue

    if (new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu').test(trimmed) || /\/>\s*$/u.test(trimmed)) {
      ranges.push({ start: lineMatch.index, end: lineMatch.index + rawLine.length })
    } else {
      start = lineMatch.index
      closing = new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu')
    }
  }

  if (start != null) ranges.push({ start, end: markdown.length })
  return ranges
}

const sourceIndentedCodeIndexRanges = (
  markdown: string,
  ignoredRanges: SourceCommentSyntaxIndexRange[]
): SourceCommentSyntaxIndexRange[] => {
  const ranges: SourceCommentSyntaxIndexRange[] = []
  const lineRegExp = /[^\r\n]*(?:\r\n|\n|\r|$)/gu
  let lineMatch: RegExpExecArray | null

  while ((lineMatch = lineRegExp.exec(markdown))) {
    const rawLine = lineMatch[0]
    if (rawLine.length === 0) break
    if (indexInsideRanges(lineMatch.index, ignoredRanges)) continue

    const lineText = rawLine.slice(0, rawLine.length - lineEndLength(rawLine))
    if (/^(?: {4,}|\t)/u.test(lineText)) {
      ranges.push({ start: lineMatch.index, end: lineMatch.index + rawLine.length })
    }
  }

  return ranges
}

const sourceCommentIgnoredIndexRanges = (markdown: string): SourceCommentSyntaxIndexRange[] => {
  const frontMatterRanges = sourceFrontMatterIndexRanges(markdown)
  const fencedRanges = sourceFencedCodeIndexRanges(markdown)
  const blockRanges = [
    ...frontMatterRanges,
    ...fencedRanges,
    ...sourceMathBlockIndexRanges(markdown, [...frontMatterRanges, ...fencedRanges])
  ]
  const htmlRanges = sourceHtmlBlockIndexRanges(markdown, blockRanges)
  const blockAndHtmlRanges = [...blockRanges, ...htmlRanges]
  const indentedRanges = sourceIndentedCodeIndexRanges(markdown, blockAndHtmlRanges)
  const blockIgnoredRanges = [...blockAndHtmlRanges, ...indentedRanges]

  return [
    ...blockIgnoredRanges,
    ...sourceInlineCodeIndexRanges(markdown, blockIgnoredRanges)
  ]
}

const sourceCommentIndexRanges = (
  markdown: string,
  ignoredRanges = sourceCommentIgnoredIndexRanges(markdown)
): SourceCommentIndexRange[] => {
  const ranges: SourceCommentIndexRange[] = []
  const openMarkers = new Map<string, number>()
  const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'g')
  let markerMatch: RegExpExecArray | null

  while ((markerMatch = markerRegExp.exec(markdown))) {
    if (indexInsideRanges(markerMatch.index, ignoredRanges)) continue

    const id = markerMatch[2]
    if (!id) continue

    if (markerMatch[1] === '~') {
      const start = openMarkers.get(id)
      if (start == null) continue

      ranges.push({
        id,
        start,
        end: markerMatch.index
      })
      openMarkers.delete(id)
    } else if (!openMarkers.has(id)) {
      openMarkers.set(id, markerMatch.index + markerMatch[0].length)
    }
  }

  return ranges
}

const sourceCommentDiagnosticSyntaxRange = (
  markdown: string,
  id: string
): SourceCommentSyntaxIndexRange | null => {
  const markerRegExp = new RegExp(`<!--MC:~?${escapeRegExp(id)}-->`, 'g')
  const markerMatch = markerRegExp.exec(markdown)
  if (markerMatch) {
    return {
      start: markerMatch.index,
      end: markerMatch.index + markerMatch[0].length
    }
  }

  const lineRegExp = /[^\r\n]*(?:\r\n|\n|\r|$)/gu
  let lineMatch: RegExpExecArray | null
  while ((lineMatch = lineRegExp.exec(markdown))) {
    const rawLine = lineMatch[0]
    if (rawLine.length === 0) break

    const lineText = rawLine.replace(/(?:\r\n|\n|\r)$/u, '')
    const metadata = parseCommentMetadataDefinition(lineText)
    if (metadata?.id === id) {
      return {
        start: lineMatch.index,
        end: lineMatch.index + lineText.length
      }
    }
  }

  return null
}

const sourceCommentSyntaxIndexRanges = (
  markdown: string,
  ignoredRanges = sourceCommentIgnoredIndexRanges(markdown)
): SourceCommentSyntaxIndexRange[] => {
  const ranges: SourceCommentSyntaxIndexRange[] = []
  const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'g')
  let markerMatch: RegExpExecArray | null

  while ((markerMatch = markerRegExp.exec(markdown))) {
    if (indexInsideRanges(markerMatch.index, ignoredRanges)) continue

    ranges.push({
      start: markerMatch.index,
      end: markerMatch.index + markerMatch[0].length
    })
  }

  const lineRegExp = /[^\r\n]*(?:\r\n|\n|\r|$)/gu
  let lineMatch: RegExpExecArray | null
  while ((lineMatch = lineRegExp.exec(markdown))) {
    const rawLine = lineMatch[0]
    if (rawLine.length === 0) break

    const lineText = rawLine.replace(/(?:\r\n|\n|\r)$/u, '')
    if (indexInsideRanges(lineMatch.index, ignoredRanges)) continue

    if (parseCommentMetadataDefinition(lineText)) {
      ranges.push({
        start: lineMatch.index,
        end: lineMatch.index + lineText.length
      })
    }
  }

  return ranges
}

const activeSourceCommentIds = (cm: CMInstance, markdown: string): string[] => {
  const anchorIndex = cm.indexFromPos(cm.getCursor('anchor'))
  const focusIndex = cm.indexFromPos(cm.getCursor('head'))
  const selectionStart = Math.min(anchorIndex, focusIndex)
  const selectionEnd = Math.max(anchorIndex, focusIndex)

  return sourceCommentIndexRanges(markdown)
    .filter((range) => {
      if (selectionStart === selectionEnd) {
        return selectionStart >= range.start && selectionStart <= range.end
      }

      return selectionEnd >= range.start && selectionStart <= range.end
    })
    .map(range => range.id)
}

const commentMetadataAppendix = (markdown: string, id: string): string => {
  const lineEnding = sourceLineEnding(markdown)
  const separator = markdown.endsWith('\n') || markdown.endsWith('\r')
    ? lineEnding
    : `${lineEnding}${lineEnding}`
  const metadata = encodeCommentMetadata(createCommentMetadata({}))
  return `${separator}[MC:${id}]: ${metadata}${lineEnding}`
}

const sourceCommentMarkdown = (
  cm: CMInstance,
  range: SourceCommentRange,
  id: string,
  markdown = cm.getValue()
): string => {
  const startIndex = cm.indexFromPos(range.start)
  const endIndex = cm.indexFromPos(range.end)
  const openMarker = `<!--MC:${id}-->`
  const closeMarker = `<!--MC:~${id}-->`
  const markedMarkdown = [
    markdown.slice(0, startIndex),
    openMarker,
    markdown.slice(startIndex, endIndex),
    closeMarker,
    markdown.slice(endIndex)
  ].join('')

  return `${markedMarkdown}${commentMetadataAppendix(markedMarkdown, id)}`
}

const getSourceCommentCandidate = (cm: CMInstance): SourceCommentCandidate | null => {
  const range = getSourceCommentRange(cm)
  if (!range) return null

  const markdown = cm.getValue()
  const startIndex = cm.indexFromPos(range.start)
  const endIndex = cm.indexFromPos(range.end)
  const ignoredRanges = sourceCommentIgnoredIndexRanges(markdown)
  if (rangesOverlap(startIndex, endIndex, ignoredRanges)) return null
  if (
    sourceCommentSyntaxIndexRanges(markdown, ignoredRanges).some(syntaxRange =>
      startIndex < syntaxRange.end && endIndex > syntaxRange.start
    )
  ) {
    return null
  }

  const id = nextCommentId(collectCommentIds(markdown))
  const parsed = parseMarkdownComments(sourceCommentMarkdown(cm, range, id, markdown))
  if (!parsed.ranges.some(commentRange => commentRange.id === id)) return null
  if (parsed.diagnostics.some(diagnostic => diagnostic.id === id)) return null

  return { id, range }
}

const syncSourceAddCommentMenu = (cm: CMInstance): void => {
  const enabled = !!getSourceCommentCandidate(cm)
  bus.emit('editor-add-comment-enabled-changed', enabled)
  const { windowId } = window.marktext?.env ?? { windowId: -1 }
  window.electron.ipcRenderer.send(
    'mt::editor-add-comment-selection-changed',
    windowId,
    enabled
  )
}

const showCommentsSidebar = (): void => {
  layoutStore.SET_LAYOUT({
    rightColumn: 'comments',
    showSideBar: true
  })
}

const handleAddComment = (): void => {
  if (!sourceCode.value || !editor.value) return

  const cm = editor.value
  const candidate = getSourceCommentCandidate(cm)
  if (!candidate) return

  const { id, range } = candidate
  const openMarker = `<!--MC:${id}-->`
  const closeMarker = `<!--MC:~${id}-->`

  cm.operation(() => {
    cm.replaceRange(closeMarker, range.end)
    cm.replaceRange(openMarker, range.start)

    const markedMarkdown = cm.getValue()
    const lastLine = cm.lastLine()
    const end = { line: lastLine, ch: cm.getLine(lastLine).length }
    cm.replaceRange(commentMetadataAppendix(markedMarkdown, id), end)
  })

  saveContent(cm)
  showCommentsSidebar()
  nextTick(() => bus.emit('comment:compose', id))
}

const replaceSourceCommentMetadata = (
  cm: CMInstance,
  id: string,
  updater: (metadata: ICommentMetadata) => ICommentMetadata
): boolean => {
  const markdown = cm.getValue()
  const nextMarkdown = updateCommentMetadataInMarkdown(markdown, id, updater)
  if (!nextMarkdown) return false

  if (nextMarkdown === markdown) {
    saveContent(cm)
    return true
  }

  const beforeParts = markdown.split(/(\r\n|\n|\r)/u)
  const afterParts = nextMarkdown.split(/(\r\n|\n|\r)/u)
  for (let index = 0; index < beforeParts.length; index += 2) {
    if (beforeParts[index] === afterParts[index]) continue

    const line = index / 2
    cm.replaceRange(
      afterParts[index],
      { line, ch: 0 },
      { line, ch: beforeParts[index].length }
    )
    saveContent(cm)
    return true
  }

  return false
}

const patchSourceCommentMetadata = (
  cm: CMInstance,
  id: string,
  patch: TUpdateCommentThreadPatch
): boolean =>
  replaceSourceCommentMetadata(cm, id, (metadata) => {
    const replies = Array.isArray(patch.replies) ? patch.replies : metadata.replies
    return {
      ...metadata,
      ...patch,
      version: 1,
      replies
    }
  })

const handleCommentReply = (payload: unknown): void => {
  if (!sourceCode.value || !editor.value) return
  const { id, reply } = (payload ?? {}) as { id?: string; reply?: ICommentReplyInput }
  if (!id || !reply?.body) return

  replaceSourceCommentMetadata(editor.value, id, metadata =>
    appendCommentReplyMetadata(metadata, reply)
  )
}

const handleCommentEdit = (payload: unknown): void => {
  if (!sourceCode.value || !editor.value) return
  const { id, patch } = (payload ?? {}) as { id?: string; patch?: TUpdateCommentThreadPatch }
  if (!id || !patch) return

  patchSourceCommentMetadata(editor.value, id, patch)
}

const handleCommentResolve = (id: unknown): void => {
  if (!sourceCode.value || !editor.value || typeof id !== 'string') return

  patchSourceCommentMetadata(editor.value, id, {
    status: 'resolved',
    updatedAt: new Date().toISOString()
  })
}

const handleCommentReopen = (id: unknown): void => {
  if (!sourceCode.value || !editor.value || typeof id !== 'string') return

  patchSourceCommentMetadata(editor.value, id, {
    status: 'open',
    updatedAt: new Date().toISOString()
  })
}

const handleCommentFocus = (id: unknown): void => {
  if (!sourceCode.value || !editor.value || typeof id !== 'string') return

  const cm = editor.value
  const markdown = cm.getValue()
  const range = sourceCommentIndexRanges(markdown).find(commentRange => commentRange.id === id)
  if (!range) return

  cm.focus()
  cm.setSelection(cm.posFromIndex(range.start), cm.posFromIndex(range.end), { scroll: true })
  editorStore.UPDATE_ACTIVE_COMMENTS([id])
}

const handleCommentDiagnosticFocus = (id: unknown): void => {
  if (!sourceCode.value || !editor.value || typeof id !== 'string') return

  const cm = editor.value
  const range = sourceCommentDiagnosticSyntaxRange(cm.getValue(), id)
  if (!range) {
    handleCommentFocus(id)
    return
  }

  cm.focus()
  cm.setSelection(cm.posFromIndex(range.start), cm.posFromIndex(range.end), { scroll: true })
  editorStore.UPDATE_ACTIVE_COMMENTS([id])
}

interface ImageActionPayload {
  id: string
  result: string
  alt: string
}

const handleImageAction = (payload: unknown) => {
  const { id, result, alt } = payload as ImageActionPayload
  const value: string = editor.value.getValue()
  const focus = editor.value.getCursor('focus')
  const anchor = editor.value.getCursor('anchor')
  const lines: string[] = value.split('\n')
  const index = lines.findIndex((line: string) => line.indexOf(id) > 0)

  if (index > -1) {
    const oldLine = lines[index]
    lines[index] = oldLine.replace(new RegExp(`!\\[${id}\\]\\(.*\\)`), `![${alt}](${result})`)
    const newValue = lines.join('\n')
    editor.value.setValue(newValue)
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

    const adjustPointer = (pointer: CMCursor) => {
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
      editor.value.setSelection(anchor, focus, { scroll: true })
    } else {
      setCursorAtFirstLine(editor.value)
    }
  }
}

const saveContent = (cm: CMInstance) => {
  const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(cm)
  // Attention: the cursor may be `{focus: null, anchor: null}` when press `backspace`
  const wordCount = getWordCount(newMarkdown)
  const comments = parseMarkdownComments(newMarkdown)
  editorStore.UPDATE_COMMENTS(comments)
  editorStore.UPDATE_ACTIVE_COMMENTS(activeSourceCommentIds(cm, newMarkdown))
  syncSourceAddCommentMenu(cm)
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

const flushSourceEditor = (): void => {
  if (editor.value) {
    saveContent(editor.value)
  }
}

const listenChange = () => {
  editor.value.on('changes', (cm: CMInstance) => {
    saveContent(cm)
  })
  editor.value.on('cursorActivity', (cm: CMInstance) => {
    saveContent(cm)
  })
}

// #3580: in Source Code mode the WYSIWYG container is hidden, so the
// `scroll-to-header` bus event (emitted when a TOC entry is clicked) must scroll
// CodeMirror instead. Resolve the TOC entry to its heading line in the source.
const handleScrollToHeader = (slug: unknown) => {
  if (!editor.value) return
  const index = editorStore.listToc.findIndex(item => item.slug === slug)
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
    lineNumbers: true,
    autofocus: true,
    lineWrapping: true,
    styleActiveLine: true,
    direction: textDirection,
    viewportMargin: Infinity,
    lineNumberFormatter (line: number) {
      if (line % 10 === 0 || line === 1) {
        return line
      } else {
        return ''
      }
    }
  }

  if (railscastsThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'railscasts'
  } else if (oneDarkThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'one-dark'
  }

  bus.on('file-loaded', handleFileChange)
  bus.on('flush-active-editor', flushSourceEditor)
  bus.on('invalidate-image-cache', handleInvalidateImageCache)
  bus.on('file-changed', handleFileChange)
  bus.on('selectAll', handleSelectAll)
  bus.on('undo', handleUndo)
  bus.on('redo', handleRedo)
  bus.on('addComment', handleAddComment)
  bus.on('comment:reply', handleCommentReply)
  bus.on('comment:edit', handleCommentEdit)
  bus.on('comment:resolve', handleCommentResolve)
  bus.on('comment:reopen', handleCommentReopen)
  bus.on('comment:focus', handleCommentFocus)
  bus.on('comment:diagnostic-focus', handleCommentDiagnosticFocus)
  bus.on('image-action', handleImageAction)
  bus.on('scroll-to-header', handleScrollToHeader)

  // For some reason, code mirror does not seem to play well with Vue's refs if we reference editor.value directly.
  // See https://github.com/codemirror/codemirror5/issues/6886 - hence, we need to use a local variable first.
  const codeMirrorInstance = codeMirror(container, codeMirrorConfig)

  // `markdown-comments` adds MC syntax decoration over the math-aware Markdown mode.
  codeMirrorInstance.setOption('mode', 'markdown-comments')

  codeMirrorInstance.on('contextmenu', (_cm: CMInstance, event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  })

  if (isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor
    codeMirrorInstance.setSelection(anchor, focus, { scroll: true })
  } else {
    setCursorAtFirstLine(codeMirrorInstance)
  }

  editor.value = codeMirrorInstance
  tabId.value = id

  listenChange()
  syncSourceAddCommentMenu(codeMirrorInstance)
})

onBeforeUnmount(() => {
  viewDestroyed.value = true

  bus.off('file-loaded', handleFileChange)
  bus.off('flush-active-editor', flushSourceEditor)
  bus.off('invalidate-image-cache', handleInvalidateImageCache)
  bus.off('file-changed', handleFileChange)
  bus.off('selectAll', handleSelectAll)
  bus.off('undo', handleUndo)
  bus.off('redo', handleRedo)
  bus.off('addComment', handleAddComment)
  bus.off('comment:reply', handleCommentReply)
  bus.off('comment:edit', handleCommentEdit)
  bus.off('comment:resolve', handleCommentResolve)
  bus.off('comment:reopen', handleCommentReopen)
  bus.off('comment:focus', handleCommentFocus)
  bus.off('comment:diagnostic-focus', handleCommentDiagnosticFocus)
  bus.off('image-action', handleImageAction)
  bus.off('scroll-to-header', handleScrollToHeader)

  const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(editor.value)
  bus.emit('file-changed', {
    id: tabId.value,
    markdown: newMarkdown,
    muyaIndexCursor: cursor,
    renderCursor: true
  })
})
</script>

<style>
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
</style>

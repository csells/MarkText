<template>
  <div
    class="source-code"
    data-document-surface="source"
  >
    <textarea
      ref="sourceInput"
      class="source-code-input"
      :aria-label="t('editor.sourceCode.label')"
      :aria-busy="!sourceReady"
      :disabled="!sourceReady"
      :dir="textDirection"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      wrap="soft"
      @beforeinput="handleBeforeInput"
      @compositionstart="handleCompositionStart"
      @compositionend="handleCompositionEnd"
      @keydown="handleKeydown"
      @paste="handlePaste"
      @drop="handleDrop"
      @copy="handleCopy"
      @cut="handleCut"
      @select="handleSelection"
    />
    <p
      v-if="failureMessage"
      class="source-code-error"
      role="alert"
      aria-live="assertive"
    >
      {{ failureMessage }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import bus from '../../bus'
import { decodeEditorCommandId } from '@shared/types/editorCommands'
import { t } from '../../i18n'
import {
  createSourceModeController,
  type SourceModeController,
  type SourceModePublication,
  type SourceModeSelection,
  type SourceModeSurface
} from './sourceModeController'
import {
  registerSourceModeInputSettlement,
  sourceModeDocumentPort
} from './sourceModeDocumentPort'
import {
  SOURCE_MODE_OPERATION_I18N_KEYS,
  type SourceModeOperation
} from './sourceModeLocalization'
import {
  createSourceTextProjection,
  type SourceTextProjection
} from './sourceTextProjection'

defineProps<{
  textDirection: string
}>()

const sourceInput = ref<HTMLTextAreaElement | null>(null)
const failureMessage = ref('')
const sourceReady = ref(false)

let controller: SourceModeController | null = null
let projection: SourceTextProjection = createSourceTextProjection('')
let publication: SourceModePublication | null = null
let applyingPublication = false
let composing = false
let compositionRange: Readonly<{ start: number; end: number }> | null = null
let pendingRefreshes = 0
let destroyed = false
let disposeInputSettlement = (): void => {}

const selectionEquals = (
  left: SourceModeSelection,
  right: SourceModeSelection
): boolean => left.anchor === right.anchor && left.focus === right.focus

const sourceSelection = (
  input: HTMLTextAreaElement,
  textProjection = projection
): SourceModeSelection => {
  const start = textProjection.sourceOffsetAt(input.selectionStart)
  const end = textProjection.sourceOffsetAt(input.selectionEnd)
  return input.selectionDirection === 'backward'
    ? Object.freeze({ anchor: end, focus: start })
    : Object.freeze({ anchor: start, focus: end })
}

const textRange = (
  selection: SourceModeSelection,
  textProjection = projection
): Readonly<{ start: number; end: number; direction: 'forward' | 'backward' }> => {
  const anchor = textProjection.textOffsetAt(selection.anchor)
  const focus = textProjection.textOffsetAt(selection.focus)
  return Object.freeze({
    start: Math.min(anchor, focus),
    end: Math.max(anchor, focus),
    direction: anchor > focus ? 'backward' : 'forward'
  })
}

const render = (
  source: string,
  selection: SourceModeSelection,
  verifiedPublication?: SourceModePublication
): void => {
  const input = sourceInput.value
  if (input === null) return

  const previousDocumentId = publication?.documentId
  const scrollTop = input.scrollTop
  const nextProjection = createSourceTextProjection(source)
  const range = textRange(selection, nextProjection)

  applyingPublication = true
  projection = nextProjection
  input.value = nextProjection.text
  input.setSelectionRange(range.start, range.end, range.direction)
  if (
    verifiedPublication === undefined ||
    previousDocumentId === undefined ||
    previousDocumentId === verifiedPublication.documentId
  ) {
    input.scrollTop = scrollTop
  } else {
    input.scrollTop = 0
  }
  if (verifiedPublication !== undefined) publication = verifiedPublication
  queueMicrotask(() => {
    applyingPublication = false
  })
}

const surface: SourceModeSurface = Object.freeze({
  mount: (nextPublication: SourceModePublication) => {
    render(
      nextPublication.source,
      nextPublication.selection,
      nextPublication
    )
  },
  preview: (source: string, selection: SourceModeSelection) => {
    render(source, selection)
  }
})

const reportFailure = (
  task: Promise<void>,
  operation: SourceModeOperation
): void => {
  failureMessage.value = ''
  task.catch(error => {
    console.error(`Source editor ${operation} failed`, error)
    failureMessage.value = t('editor.sourceCode.operationFailed', {
      operation: t(SOURCE_MODE_OPERATION_I18N_KEYS[operation])
    })
  })
}

const edit = (
  start: number,
  end: number,
  text: string,
  selection: SourceModeSelection
): void => {
  const activeController = controller
  if (activeController === null) return
  reportFailure(
    activeController.edit(Object.freeze({
      start,
      end,
      text,
      selection
    })),
    'edit'
  )
}

const previousCodePointOffset = (source: string, offset: number): number => {
  if (offset <= 0) return 0
  const previous = source.charCodeAt(offset - 1)
  if (
    previous >= 0xDC00 &&
    previous <= 0xDFFF &&
    offset > 1
  ) {
    const leading = source.charCodeAt(offset - 2)
    if (leading >= 0xD800 && leading <= 0xDBFF) return offset - 2
  }
  return offset - 1
}

const nextCodePointOffset = (source: string, offset: number): number => {
  if (offset >= source.length) return source.length
  const leading = source.charCodeAt(offset)
  if (
    leading >= 0xD800 &&
    leading <= 0xDBFF &&
    offset + 1 < source.length
  ) {
    const trailing = source.charCodeAt(offset + 1)
    if (trailing >= 0xDC00 && trailing <= 0xDFFF) return offset + 2
  }
  return offset + 1
}

const previousWordTextOffset = (text: string, offset: number): number => {
  let cursor = offset
  while (cursor > 0 && /\s/u.test(text[cursor - 1])) cursor -= 1
  while (cursor > 0 && !/\s/u.test(text[cursor - 1])) cursor -= 1
  return cursor
}

const nextWordTextOffset = (text: string, offset: number): number => {
  let cursor = offset
  while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1
  while (cursor < text.length && !/\s/u.test(text[cursor])) cursor += 1
  return cursor
}

const beforeLineTextOffset = (text: string, offset: number): number =>
  text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1

const afterLineTextOffset = (text: string, offset: number): number => {
  const lineBreak = text.indexOf('\n', offset)
  return lineBreak < 0 ? text.length : lineBreak + 1
}

const replacementForInput = (
  event: InputEvent,
  selection: SourceModeSelection
): Readonly<{
  start: number
  end: number
  text: string
}> | null => {
  let start = Math.min(selection.anchor, selection.focus)
  let end = Math.max(selection.anchor, selection.focus)
  let text = ''

  switch (event.inputType) {
    case 'insertText':
    case 'insertReplacementText':
    case 'insertFromYank':
      text = event.data ?? ''
      break
    case 'insertLineBreak':
    case 'insertParagraph':
      text = '\n'
      break
    case 'insertFromDrop':
      text = event.dataTransfer?.getData('text/plain') ?? event.data ?? ''
      break
    case 'deleteContentBackward':
      if (start === end) start = previousCodePointOffset(projection.source, start)
      break
    case 'deleteContentForward':
      if (start === end) end = nextCodePointOffset(projection.source, end)
      break
    case 'deleteWordBackward':
      if (start === end) {
        const displayStart = projection.textOffsetAt(start)
        start = projection.sourceOffsetAt(
          previousWordTextOffset(projection.text, displayStart)
        )
      }
      break
    case 'deleteWordForward':
      if (start === end) {
        const displayEnd = projection.textOffsetAt(end)
        end = projection.sourceOffsetAt(
          nextWordTextOffset(projection.text, displayEnd)
        )
      }
      break
    case 'deleteSoftLineBackward':
    case 'deleteHardLineBackward':
      if (start === end) {
        const displayStart = projection.textOffsetAt(start)
        start = projection.sourceOffsetAt(
          beforeLineTextOffset(projection.text, displayStart)
        )
      }
      break
    case 'deleteSoftLineForward':
    case 'deleteHardLineForward':
      if (start === end) {
        const displayEnd = projection.textOffsetAt(end)
        end = projection.sourceOffsetAt(
          afterLineTextOffset(projection.text, displayEnd)
        )
      }
      break
    case 'deleteByCut':
    case 'deleteByDrag':
    case 'deleteContent':
      break
    default:
      return null
  }
  return Object.freeze({ start, end, text })
}

const handleBeforeInput = (event: InputEvent): void => {
  if (!sourceReady.value) {
    event.preventDefault()
    return
  }
  if (composing || event.isComposing || event.inputType === 'insertCompositionText') {
    return
  }
  event.preventDefault()
  const input = sourceInput.value
  if (input === null) return

  if (event.inputType === 'historyUndo') {
    if (controller !== null) reportFailure(controller.undo(), 'undo')
    return
  }
  if (event.inputType === 'historyRedo') {
    if (controller !== null) reportFailure(controller.redo(), 'redo')
    return
  }

  const currentSelection = sourceSelection(input)
  if (event.inputType === 'insertFromPaste') {
    if (controller !== null) {
      reportFailure(controller.paste(currentSelection), 'paste')
    }
    return
  }
  const replacement = replacementForInput(event, currentSelection)
  if (replacement === null) return
  const caret = replacement.start + replacement.text.length
  edit(
    replacement.start,
    replacement.end,
    replacement.text,
    Object.freeze({ anchor: caret, focus: caret })
  )
}

const handleCompositionStart = (): void => {
  const input = sourceInput.value
  if (input === null) return
  const selection = sourceSelection(input)
  compositionRange = Object.freeze({
    start: Math.min(selection.anchor, selection.focus),
    end: Math.max(selection.anchor, selection.focus)
  })
  composing = true
}

const handleCompositionEnd = (event: CompositionEvent): void => {
  const range = compositionRange
  compositionRange = null
  composing = false
  if (range === null) return
  const text = typeof event.data === 'string' ? event.data : ''
  const caret = range.start + text.length
  edit(
    range.start,
    range.end,
    text,
    Object.freeze({ anchor: caret, focus: caret })
  )
}

const selectedCanonicalRange = (
  input: HTMLTextAreaElement
): Readonly<{ start: number; end: number }> => {
  const selection = sourceSelection(input)
  return Object.freeze({
    start: Math.min(selection.anchor, selection.focus),
    end: Math.max(selection.anchor, selection.focus)
  })
}

const handlePaste = (event: ClipboardEvent): void => {
  event.preventDefault()
  const input = sourceInput.value
  if (input === null) return
  reportFailure(
    controller?.paste(sourceSelection(input)) ?? Promise.resolve(),
    'paste'
  )
}

const handleDrop = (event: DragEvent): void => {
  event.preventDefault()
  const input = sourceInput.value
  if (input === null) return
  const range = selectedCanonicalRange(input)
  const text = event.dataTransfer?.getData('text/plain') ?? ''
  const caret = range.start + text.length
  edit(range.start, range.end, text, Object.freeze({
    anchor: caret,
    focus: caret
  }))
}

const handleCut = (event: ClipboardEvent): void => {
  const input = sourceInput.value
  if (input === null || controller === null) return
  const range = selectedCanonicalRange(input)
  if (range.start === range.end) return
  event.preventDefault()
  reportFailure(controller.cut(Object.freeze({
    start: range.start,
    end: range.end,
    text: '',
    selection: Object.freeze({
      anchor: range.start,
      focus: range.start
    })
  })), 'cut')
}

const handleCopy = (event: ClipboardEvent): void => {
  const input = sourceInput.value
  if (input === null || controller === null) return
  event.preventDefault()
  reportFailure(
    controller.copy(selectedCanonicalRange(input)),
    'copy'
  )
}

const handleKeydown = (event: KeyboardEvent): void => {
  const command = event.metaKey || event.ctrlKey
  if (command && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (controller !== null) {
      reportFailure(
        event.shiftKey ? controller.redo() : controller.undo(),
        event.shiftKey ? 'redo' : 'undo'
      )
    }
    return
  }
  if (command && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    if (controller !== null) reportFailure(controller.redo(), 'redo')
    return
  }
  if (event.key === 'Tab' && !command && !event.altKey) {
    event.preventDefault()
    const input = sourceInput.value
    if (input === null) return
    const range = selectedCanonicalRange(input)
    const caret = range.start + 1
    edit(range.start, range.end, '\t', Object.freeze({
      anchor: caret,
      focus: caret
    }))
  }
}

const handleSelection = (): void => {
  if (applyingPublication || composing || controller === null) return
  const input = sourceInput.value
  if (input === null || publication === null) return
  const selection = sourceSelection(input)
  if (selectionEquals(selection, publication.selection)) return
  publication = Object.freeze({ ...publication, selection })
  reportFailure(controller.select(selection), 'selection')
}

const handleSelectAll = (): void => {
  const input = sourceInput.value
  if (input === null || controller === null) return
  input.focus()
  input.select()
  const selection = Object.freeze({
    anchor: 0,
    focus: projection.source.length
  })
  reportFailure(controller.select(selection), 'selection')
}

const handleUndo = (): void => {
  if (controller !== null) reportFailure(controller.undo(), 'undo')
}

const handleRedo = (): void => {
  if (controller !== null) reportFailure(controller.redo(), 'redo')
}

// Source mode's arms of the one editor-command vocabulary; editor.vue's
// markup arms return early while Source mode is mounted.
const handleEditorCommand = (value: unknown): void => {
  switch (decodeEditorCommandId(value)) {
    case 'select-all': return handleSelectAll()
    case 'undo': return handleUndo()
    case 'redo': return handleRedo()
    default:
  }
}

const handleRefresh = (): void => {
  if (controller === null) return
  pendingRefreshes += 1
  sourceReady.value = false
  const operation = controller.refresh()
  reportFailure(operation, 'attachment')
  const settle = (): void => {
    pendingRefreshes -= 1
    if (pendingRefreshes === 0 && !destroyed) {
      sourceReady.value = true
    }
  }
  operation.then(settle, settle)
}

const handleScrollToHeader = (nodeId: unknown): void => {
  const input = sourceInput.value
  const current = publication
  if (input === null || current === null || typeof nodeId !== 'string') return
  const heading = current.outline.find(item => item.nodeId === nodeId)
  if (heading === undefined) return

  const textOffset = projection.textOffsetAt(heading.sourceOffset)
  applyingPublication = true
  input.focus()
  input.setSelectionRange(textOffset, textOffset)
  const line = projection.text.slice(0, textOffset).split('\n').length - 1
  const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight)
  if (Number.isFinite(lineHeight)) {
    input.scrollTop = Math.max(0, line * lineHeight - input.clientHeight / 3)
  }
  queueMicrotask(() => {
    applyingPublication = false
  })
  if (controller !== null) {
    reportFailure(controller.select(Object.freeze({
      anchor: heading.sourceOffset,
      focus: heading.sourceOffset
    })), 'headingSelection')
  }
}

onMounted(async () => {
  bus.on('file-loaded', handleRefresh)
  bus.on('file-changed', handleRefresh)
  bus.on('editor-command', handleEditorCommand)
  bus.on('scroll-to-header', handleScrollToHeader)

  const port = await sourceModeDocumentPort()
  if (destroyed) return
  controller = createSourceModeController(port, surface)
  disposeInputSettlement =
    registerSourceModeInputSettlement(controller.settled).dispose
  controller.start()
  sourceReady.value = true
  await nextTick()
  sourceInput.value?.focus()
})

onBeforeUnmount(() => {
  destroyed = true
  sourceReady.value = false
  disposeInputSettlement()
  disposeInputSettlement = () => {}
  bus.off('file-loaded', handleRefresh)
  bus.off('file-changed', handleRefresh)
  bus.off('editor-command', handleEditorCommand)
  bus.off('scroll-to-header', handleScrollToHeader)
  controller?.destroy()
  controller = null
})
</script>

<style>
.source-code {
  position: relative;
  height: calc(100vh - var(--titleBarHeight));
  box-sizing: border-box;
  overflow: hidden;
}

.source-code-input {
  display: block;
  box-sizing: border-box;
  width: min(var(--editorAreaWidth), calc(100% - 100px));
  height: calc(100% - 100px);
  margin: 50px auto;
  padding: 0;
  overflow: auto;
  resize: none;
  border: 0;
  outline: 0;
  color: var(--editorColor);
  background: transparent;
  font-family: var(
    --source-code-font-family,
    Menlo, Monaco, Consolas, "Liberation Mono", monospace
  );
  font-size: var(--source-code-font-size, 1em);
  line-height: 1.7;
  white-space: pre-wrap;
  tab-size: 4;
}

.source-code-error {
  position: absolute;
  right: 24px;
  bottom: 16px;
  max-width: min(520px, calc(100% - 48px));
  margin: 0;
  padding: 8px 12px;
  color: var(--notificationErrorColor, #fff);
  background: var(--notificationErrorBg, #b42318);
  border-radius: 4px;
}

.source-code-input::selection {
  background: var(--selection-color);
}
</style>

<template>
  <div
    class="editor-wrapper"
    :class="[{ typewriter: typewriter, focus: focus, source: sourceCode }]"
    :dir="textDirection"
  >
    <div
      ref="editorRef"
      class="editor-component"
      :aria-label="t('preferences.editor.title')"
      :aria-hidden="sourceCode || imageViewerVisible ? 'true' : undefined"
      :inert="sourceCode || imageViewerVisible || undefined"
    />
    <ImageViewerOverlay
      ref="imageViewerOverlayRef"
      :visible="imageViewerVisible"
      @close="setImageViewerVisible(false)"
      @restore-focus="restoreImageViewerFocus"
    />
    <el-dialog
      v-model="dialogTableVisible"
      :title="t('editor.insertTable.title')"
      :show-close="false"
      :modal="true"
      class="ag-insert-table-dialog"
      width="454px"
      center
      dir="ltr"
      @opened="focusTableRows"
      @closed="cancelTableShapeRequest"
    >
      <el-form
        :model="tableChecker"
        :inline="true"
      >
        <el-form-item :label="t('editor.insertTable.rows')">
          <el-input-number
            ref="rowInput"
            v-model="tableChecker.rows"
            size="mini"
            controls-position="right"
            :min="1"
            :max="30"
          />
        </el-form-item>
        <el-form-item :label="t('editor.insertTable.columns')">
          <el-input-number
            v-model="tableChecker.columns"
            size="mini"
            controls-position="right"
            :min="1"
            :max="20"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="cancelTableShapeRequest">
            {{ t('common.cancel') }}
          </el-button>
          <el-button
            type="primary"
            @click="handleDialogTableConfirm"
          >
            {{ t('common.ok') }}
          </el-button>
        </div>
      </template>
    </el-dialog>
    <CriticMarkupPromptDialog ref="criticMarkupPromptDialog" />
    <editor-search v-if="!sourceCode" />
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  shallowRef,
  reactive,
  computed,
  watch,
  nextTick,
  markRaw
} from 'vue'
import log from 'electron-log'
import {
  DocumentCoreIntentRejectedError,
  reportAsyncTask,
  type ICriticMarkupReviewEditor,
  type DocumentSelectionContext
} from '@marktext/document-view'
import {
  type ConsumerView,
  type BlockConversion,
  type InlineFormat
} from '@marktext/document-core'
import type {
  DocumentCoreExecutionReport,
  DocumentCoreHistoryState
} from '@shared/types/documentCore'
import type {
  ImageAssetSource,
  ImageSourceCapability
} from '@shared/types/imageAsset'
import { applyCursor, isIndexCursor } from '@/util/cursor'
import EditorSearch from '../search/index.vue'
import bus from '@/bus'
import {
  useDocumentCapabilityStore
} from '@/store/documentCapabilities'
import {
  documentCapabilityMenuState
} from './documentCapabilityMenu'
import { createApplicationMenuState } from '@/store/editor'
import { DEFAULT_EDITOR_FONT_FAMILY, DEFAULT_CODE_FONT_FAMILY } from '@/config'
import notice from '@/services/notification'
import { imageAssetSourceFromFile } from '@/services/imageAssetClient'
import {
  imageAssetStorage,
  isRemoteImageReference
} from '@/services/imageAssetPolicy'
import { uploadImage } from '@/services/uploaderClient'
import {
  admitImageInsertion,
  assertImageInsertionAdmission,
  completeAsyncImageInsertion,
  completeUploadedImageInsertion,
  insertImageReference,
  isImageInsertionAdmissionError,
  type ImageInsertionContext
} from '@/services/asyncImageInsertion'
import { revealStaticOutput } from '@/services/presentationEffects'
import { SpellcheckerLanguageCommand } from '@/commands'
import {
  SpellChecker,
  applySpellcheckerEnabledState,
  applySpellcheckerLanguage
} from '@/spellchecker'
import { isOsx, animatedScrollTo } from '@/util'
import { resolveTocHeadingElement } from '@/util/tocNavigation'
import { addCommonStyle } from '@/util/theme'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorStore } from '@/store/editor'
import type { FlushActiveEditorRequest } from '@/store/editor'
import { setLanguage as ensureDesktopLocale } from '@/i18n'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { presentSurfaceCommandOutcome } from './surfaceCommandOutcome'
import { type CriticMarkupTextRequest } from './criticMarkupReview'
import CriticMarkupPromptDialog from './CriticMarkupPromptDialog.vue'
import { useCriticMarkupReviewController } from './useCriticMarkupReviewController'
import { useCriticMarkupRejectionNotifier } from './useCriticMarkupRejectionNotifier'
import {
  createDocumentEditorHost,
  type DocumentEditorHost,
  type DocumentHostConfiguration,
  type DocumentHostInteraction
} from './documentCoreDesktopEditor'
import {
  createDocumentCoreRemoteSession,
  type DocumentCoreRemoteSession,
  type DocumentCoreRemoteSessionOptions
} from './documentCoreRemoteSession'
import {
  registerDocumentCoreTabCloser
} from './documentCoreTabLifecycle'
import {
  registerSourceModeDocumentPort,
  settleSourceModeInput
} from './sourceModeDocumentPort'
import { useDocumentSurfaceContext } from './useDocumentSurfaceContext'
import {
  documentSurfaceFromProjection
} from '@shared/types/documentSurface'
import { decodeEditorCommandId } from '@shared/types/editorCommands'
import {
  BLOCK_CONVERSION_COMMANDS,
  INLINE_FORMAT_COMMANDS
} from './editorCommandBindings'
import type {
  SourceModeCopyRequest,
  SourceModeDocumentPort,
  SourceModeEditRequest,
  SourceModeImageRequest,
  SourceModePasteRequest,
  SourceModeSelection,
  SourceModePublication
} from './sourceModeController'
import { useEditorLifecycle } from './useEditorLifecycle'
import {
  decodeEditorExportCommand,
  decodeMisspellingRequest,
  decodeReplaceRequest,
  decodeSearchRequest
} from './editorCommandDecoders'
import {
  decodeDocumentCoreStaticSinkReceipt
} from './documentCoreStaticSinkClientCodec'
import {
  applyDesktopDocumentViewLocale
} from './documentViewLocale'
import { createTableShapeDialogRequest } from './tableShapeDialogRequest'

// Importing the retained view package injects the document-core editor CSS.
import '@marktext/document-view'
import { type InputNumberInstance } from 'element-plus'
import ImageViewerOverlay from './imageViewerOverlay.vue'

const { t } = useI18n()
const STANDAR_Y = 320

type DesktopEditorInstance = DocumentEditorHost

defineProps<{
  markdown?: string
  cursor?: unknown
  textDirection: string
  platform?: string
}>()

// Get stores
const preferencesStore = usePreferencesStore()
const editorStore = useEditorStore()
const capabilityStore = useDocumentCapabilityStore()

// Use storeToRefs to extract reactive properties from the stores
const {
  // Preferences
  autoPairBracket,
  autoPairMarkdownSyntax,
  autoPairQuote,
  subscriptAndSuperscript,
  footnotes,
  gitLabMath,
  lineHeight,
  fontSize,
  codeFontSize,
  codeFontFamily,
  editorFontFamily,
  hideQuickInsertHint,
  hideLinkPopup,
  autoCheck,
  editorLineWidth,
  wrapCodeBlocks,
  hideScrollbar,
  spellcheckerEnabled,
  spellcheckerNoUnderline,
  spellcheckerLanguage,
  imageInsertAction,
  imagePreferRelativeDirectory,
  language,

  // Edit modes
  typewriter,
  focus,
  sourceCode
} = storeToRefs(preferencesStore)

// Editor store refs
const { currentFile } = storeToRefs(editorStore)

// Component state
const defaultFontFamily = DEFAULT_EDITOR_FONT_FAMILY
const resolveEditorFont = (family: string): string =>
  family ? `${family}, ${defaultFontFamily}` : defaultFontFamily
const resolveCodeFont = (family: string): string => `${family}, ${DEFAULT_CODE_FONT_FAMILY}`
const selectionChange = ref<DocumentSelectionContext | null>(null)
const editor = shallowRef<DesktopEditorInstance | null>(null)
const dialogTableVisible = ref(false)
const imageViewerVisible = ref(false)
const tableChecker = reactive({
  rows: 4,
  columns: 3
})

// Template refs
const editorRef = ref<HTMLDivElement | null>(null)
const imageViewerOverlayRef = ref<{
  getContainer: () => HTMLDivElement | null
} | null>(null)
const rowInput = ref<InputNumberInstance | null>(null)
const criticMarkupPromptDialog = ref<{
  request: CriticMarkupTextRequest
  cancel: () => void
} | null>(null)

const tableShapeDialogRequest = createTableShapeDialogRequest({
  open: () => {
    tableChecker.rows = 4
    tableChecker.columns = 3
    dialogTableVisible.value = true
    nextTick(() => rowInput.value?.focus())
  },
  close: () => {
    dialogTableVisible.value = false
  }
})
const requestTableShape = (signal: AbortSignal) =>
  tableShapeDialogRequest.request(signal)
const cancelTableShapeRequest = (): void => tableShapeDialogRequest.cancel()
const focusTableRows = (): void => rowInput.value?.focus()

// Non-reactive variables
let spellchecker: SpellChecker | null = null
let switchLanguageCommand: SpellcheckerLanguageCommand | null = null
let imageViewer: SimpleImageViewer | null = null
// The engine has no `scroll` event; we listen on the scroll container directly.
let scrollHandler: ((e: Event) => void) | null = null
let disposeDocumentCoreTabCloser = () => {}
let disposeSourceModeDocumentPort = () => {}
let disposeImageAssetInput = () => {}

const documentCoreHistoryByTab = new Map<string, DocumentCoreHistoryState>()
let activeRemoteSession: DocumentCoreRemoteSession | null = null

const configureEditor = (
  options: DocumentHostConfiguration,
  context: string
): void => {
  const targetEditor = editor.value
  if (targetEditor === null) return
  reportAsyncTask(targetEditor.configure(options), context)
}

// Build a JSON-serializable cursor from the engine selection (drop the live
// block references so it survives the buffered-state round-trip). `setCursor`
// re-resolves the target blocks from `anchorPath`/`focusPath`.
const serializeCursor = (
  selection: DocumentSelectionContext | null
) => {
  if (!selection) return null
  return {
    anchor: { offset: selection.anchor.offset },
    focus: { offset: selection.focus.offset }
  }
}

class SimpleImageViewer {
  container: HTMLElement
  scale: number
  translateX: number
  translateY: number
  isDragging: boolean
  startX: number
  startY: number
  img!: HTMLImageElement
  _onWheel!: (e: WheelEvent) => void
  _onMousedown!: (e: MouseEvent) => void
  _onMousemove!: (e: MouseEvent) => void
  _onMouseup!: () => void

  constructor (container: HTMLElement, { url }: { url: string }) {
    this.container = container
    this.scale = 1
    this.translateX = 0
    this.translateY = 0
    this.isDragging = false
    this.startX = 0
    this.startY = 0
    this._init(url)
  }

  _init (url: string) {
    this.container.innerHTML = ''
    this.img = document.createElement('img')
    this.img.src = url
    this.img.style.cssText =
      'max-width:90vw;max-height:90vh;object-fit:contain;transform-origin:center center;user-select:none;display:block;'
    this.img.draggable = false
    this.container.appendChild(this.img)
    this._bindEvents()
  }

  _updateTransform () {
    this.img.style.transform = `translate(${this.translateX}px,${this.translateY}px) scale(${this.scale})`
  }

  _bindEvents () {
    this._onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      this.scale = Math.max(0.1, Math.min(10, this.scale * factor))
      this._updateTransform()
    }
    this._onMousedown = (e: MouseEvent) => {
      if (e.button !== 0) return
      this.isDragging = true
      this.startX = e.clientX - this.translateX
      this.startY = e.clientY - this.translateY
      this.container.style.cursor = 'grabbing'
      e.preventDefault()
    }
    this._onMousemove = (e: MouseEvent) => {
      if (!this.isDragging) return
      this.translateX = e.clientX - this.startX
      this.translateY = e.clientY - this.startY
      this._updateTransform()
    }
    this._onMouseup = () => {
      this.isDragging = false
      this.container.style.cursor = 'grab'
    }
    this.container.addEventListener('wheel', this._onWheel, { passive: false })
    this.container.addEventListener('mousedown', this._onMousedown)
    document.addEventListener('mousemove', this._onMousemove)
    document.addEventListener('mouseup', this._onMouseup)
  }

  destroy () {
    this.container.removeEventListener('wheel', this._onWheel)
    this.container.removeEventListener('mousedown', this._onMousedown)
    document.removeEventListener('mousemove', this._onMousemove)
    document.removeEventListener('mouseup', this._onMouseup)
    this.container.innerHTML = ''
  }
}

// Watchers
watch(typewriter, (value) => {
  if (value) {
    scrollToCursor()
  }
})

watch(focus, (value) => {
  if (editor.value) {
    editor.value.setFocusMode(value)
  }
})

// In Source mode, Paragraph and Format commands are unavailable because their
// semantic target surface is hidden. On return to the semantic view, re-apply
// the CURRENT cursor context rather than blanket-enabling everything (#3531).
watch(sourceCode, (isSource) => {
  if (isSource) {
    cancelTableShapeRequest()
    publishCapabilityMenuState()
    window.electron.ipcRenderer.send(
      'mt::set-document-clipboard-menu-state',
      { surface: 'source', hasSelection: false }
    )
    return
  }
  nextTick(() => {
    if (selectionChange.value) {
      pushSelectionMenuState(selectionChange.value)
    } else {
      publishCapabilityMenuState()
      publishDocumentClipboardMenuState(false)
    }
  })
})

watch(fontSize, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ fontSize: value }, 'Update editor font size')
  }
})

watch(lineHeight, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ lineHeight: value }, 'Update editor line height')
  }
})

watch(editorFontFamily, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor(
      { editorFontFamily: resolveEditorFont(value) },
      'Update editor font family'
    )
  }
})

watch(subscriptAndSuperscript, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor(
      { subscriptAndSuperscript: value },
      'Update subscript and superscript'
    )
  }
})

watch(footnotes, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ footnotes: value }, 'Update footnotes')
  }
})

watch(gitLabMath, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ gitLabMath: value }, 'Update GitLab math')
  }
})

watch(hideQuickInsertHint, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor(
      { hideQuickInsertHint: value },
      'Update quick-insert hint'
    )
  }
})

watch(editorLineWidth, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ editorLineWidth: value }, 'Update editor line width')
  }
})

watch(wrapCodeBlocks, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ wrapCodeBlocks: value }, 'Update code-block wrapping')
  }
})

watch(autoPairBracket, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ autoPairBrackets: value }, 'Update bracket pairing')
  }
})

watch(autoPairMarkdownSyntax, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ autoPairMarkdown: value }, 'Update Markdown pairing')
  }
})

watch(autoPairQuote, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ autoPairQuotes: value }, 'Update quote pairing')
  }
})

watch(hideLinkPopup, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ hideLinkTools: value }, 'Update link tools')
  }
})

watch(autoCheck, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ autoCheckTasks: value }, 'Update task checking')
  }
})

watch(codeFontSize, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor({ codeFontSize: value }, 'Update code font size')
    addCommonStyle({
      codeFontSize: value,
      codeFontFamily: codeFontFamily.value,
      hideScrollbar: hideScrollbar.value
    })
  }
})

watch(codeFontFamily, (value, oldValue) => {
  if (value !== oldValue) {
    configureEditor(
      { codeFontFamily: resolveCodeFont(value) },
      'Update code font family'
    )
    addCommonStyle({
      codeFontSize: codeFontSize.value,
      codeFontFamily: value,
      hideScrollbar: hideScrollbar.value
    })
  }
})

watch(hideScrollbar, (value, oldValue) => {
  if (value !== oldValue) {
    addCommonStyle({
      codeFontSize: codeFontSize.value,
      codeFontFamily: codeFontFamily.value,
      hideScrollbar: value
    })
  }
})

watch(spellcheckerEnabled, (value, oldValue) => {
  if (value !== oldValue) {
    // Set the document view's spellcheck container attribute.
    configureEditor({ spellcheck: value }, 'Update editor spellcheck')

    if (spellchecker) {
      reportAsyncTask(
        applySpellcheckerEnabledState(
          spellchecker,
          value,
          spellcheckerLanguage.value
        ),
        'Update spell checker'
      )
    }
  }
})

watch(spellcheckerNoUnderline, (value, oldValue) => {
  if (value !== oldValue) {
    // Hide only the spelling squiggle; the native checker (and its right-click
    // suggestions) stays controlled by `spellcheckerEnabled`.
    configureEditor(
      { hideSpellcheckMarks: value },
      'Update spellcheck marks'
    )
  }
})

watch(spellcheckerLanguage, (value, oldValue) => {
  if (value !== oldValue && spellchecker) {
    reportAsyncTask(
      applySpellcheckerLanguage(spellchecker, value),
      'Switch spell checker language'
    )
  }
})

watch(currentFile, (value, oldValue) => {
  if (value?.id !== oldValue?.id) {
    cancelTableShapeRequest()
  }
  if (value && value !== oldValue) {
    scrollToCursor(0)
    // Hide float tools if needed.
    if (editor.value) {
      editor.value.dismissTransientTools()
    }
  }
})

const keyup = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    setImageViewerVisible(false)
  }
}

const setImageViewerVisible = (status: boolean) => {
  imageViewerVisible.value = status
  if (!status && imageViewer) {
    imageViewer.destroy()
    imageViewer = null
  }
}

const restoreImageViewerFocus = (): void => {
  editor.value?.focus()
}

const switchSpellcheckLanguage = (languageCode: unknown) => {
  if (typeof languageCode !== 'string' || languageCode.length === 0) {
    throw new TypeError('Spell checker language requires a non-empty string.')
  }
  const checker = spellchecker
  if (checker === null) {
    throw new Error('Spell checker is not initialized.')
  }

  // This method is also called from bus, so validate state before continuing.
  if (!checker.isEnabled) {
    throw new Error(t('editor.spellcheck.disabledError'))
  }

  applySpellcheckerLanguage(checker, languageCode)
    .catch((error: unknown) => {
      log.error(
        t('editor.spellcheck.errorSwitchingLanguage', { languageCode })
      )
      log.error(error)

      const errMsg = (error as { message?: string } | null | undefined)?.message ?? String(error)
      notice.notify({
        title: t('editor.spellcheck.title'),
        type: 'error',
        message: t('editor.spellcheck.switchError', {
          languageCode,
          error: errMsg
        })
      })
    })
}

const openSpellcheckerLanguageCommand = () => {
  if (!isOsx) {
    bus.emit('show-command-palette', switchLanguageCommand)
  }
}

const replaceMisspelling = (payload: unknown) => {
  const { replacement } = decodeMisspellingRequest(payload)
  const targetEditor = editor.value
  if (targetEditor === null) return
  reportAsyncTask(
    targetEditor.replaceCurrentWord(replacement),
    'Replace misspelling'
  )
}

const handleUndo = () => {
  if (sourceCode.value) {
    // The native source input owns undo, redo, and select-all in Source mode.
    return
  }

  const targetEditor = editor.value
  if (targetEditor === null) return
  reportAsyncTask(targetEditor.dispatchIntent({ kind: 'undo' }), 'Undo')
}

const handleRedo = () => {
  if (sourceCode.value) {
    // The native source input owns undo, redo, and select-all in Source mode.
    return
  }

  const targetEditor = editor.value
  if (targetEditor === null) return
  reportAsyncTask(targetEditor.dispatchIntent({ kind: 'redo' }), 'Redo')
}

const handleSelectAll = () => {
  if (sourceCode.value) {
    // The native source input owns undo, redo, and select-all in Source mode.
    return
  }

  if (editor.value && editor.value.hasFocus()) {
    editor.value.selectAll()
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

// Custom copyAsRich copyAsHtml pasteAsPlainText.
// `copyAsRich` writes the rendered HTML to `text/html` AND the plain text to
// `text/plain`, so pasting into Word/email yields formatted rich text (whereas
// `copyAsHtml` blanks `text/html` and puts the HTML source into `text/plain`).
const handleCopyPaste = (
  command: 'copy-as-rich' | 'copy-as-html' | 'paste-as-plain-text'
) => {
  if (sourceCode.value) {
    notice.notify({
      title: t('editor.sourceCode.semanticClipboardUnavailableTitle'),
      type: 'warning',
      message: t('editor.sourceCode.semanticClipboardUnavailable')
    })
    return
  }
  const targetEditor = editor.value
  if (!targetEditor) return
  if (command === 'paste-as-plain-text') {
    reportAsyncTask(
      targetEditor.pasteAsPlainText(),
      'Paste as plain text'
    )
  } else if (command === 'copy-as-html') {
    reportAsyncTask(targetEditor.copyAsHtml(), 'Copy as HTML')
  } else {
    reportAsyncTask(targetEditor.copyAsRich(), 'Copy as rich text')
  }
}

type ImageAssetInput = string | File | ImageSourceCapability

const isImageSourceCapability = (
  value: unknown
): value is ImageSourceCapability => (
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  'schema' in value &&
  value.schema === 'image-source-capability-1' &&
  'token' in value &&
  typeof value.token === 'string' &&
  value.token.length > 0
)

type ImageInsertionHostPort = Pick<
  DesktopEditorInstance,
  'settled' | 'snapshot' | 'selection' | 'insertSourceImage' |
  'insertImageAsset'
> & Readonly<{
  insertImage: (image: Readonly<{ src: string }>) => Promise<void>
}>

// The image service's port is implemented over the host's intent seam:
// this adapter is the one insert-image construction site for markup
// insertions.
const imageInsertionHostPort = (
  host: DesktopEditorInstance
): ImageInsertionHostPort => Object.freeze({
  settled: host.settled,
  snapshot: host.snapshot,
  selection: host.selection,
  insertSourceImage: host.insertSourceImage,
  insertImageAsset: host.insertImageAsset,
  insertImage: (image: Readonly<{ src: string }>) =>
    host.dispatchTargetedIntent({
      kind: 'insert-image',
      src: image.src,
      alt: ''
    })
})

const imageInsertionContext = (
): ImageInsertionContext<ImageInsertionHostPort> => {
  const host = editor.value
  return Object.freeze({
    documentId: currentFile.value?.id ?? null,
    surface: sourceCode.value ? 'source' : 'markup',
    host: host === null ? null : imageInsertionHostPort(host)
  })
}

const insertPersistedImage = async (image: ImageAssetInput): Promise<void> => {
  const tab = currentFile.value
  if (tab === null || tab === undefined || !tab.id) {
    throw new Error('Image insertion requires an admitted document')
  }
  const action = imageInsertAction.value
  const preferDocumentRelative = imagePreferRelativeDirectory.value
  const documentPersisted = tab.pathname.length > 0
  const admission = await admitImageInsertion(imageInsertionContext)
  if (typeof image === 'string' && isRemoteImageReference(image)) {
    await completeAsyncImageInsertion(
      admission,
      Promise.resolve(image),
      imageInsertionContext,
      insertImageReference
    )
    return
  }

  if (typeof image === 'string') {
    throw new TypeError(
      'Local image insertion requires a main-minted source capability'
    )
  }
  const source: ImageAssetSource = image instanceof File
    ? await imageAssetSourceFromFile(image)
    : Object.freeze({
      kind: 'native-capability',
      token: image.token
    })
  await assertImageInsertionAdmission(admission, imageInsertionContext)

  if (action === 'upload' && source.kind === 'binary') {
    let uploaded: Awaited<ReturnType<typeof uploadImage>> | null = null
    try {
      uploaded = await uploadImage(
        admission.documentId,
        source
      )
    } catch (error) {
      notice.notify({
        title: 'Upload Image',
        type: 'warning',
        message: String(error)
      })
    }
    if (uploaded !== null) {
      if (uploaded.deletionClipboard !== null) {
        editorStore.SHOW_IMAGE_DELETION_CAPABILITY(
          uploaded.deletionClipboard
        )
      }
      try {
        await completeUploadedImageInsertion(
          admission,
          Promise.resolve(uploaded),
          imageInsertionContext
        )
      } catch (error) {
        if (!isImageInsertionAdmissionError(error)) throw error
        notice.notify({
          title: 'Upload Image',
          type: 'warning',
          message: 'The image was uploaded, but the insertion target changed.'
        })
      }
      return
    }
  }

  const storage = imageAssetStorage({
    action,
    source: source.kind,
    documentPersisted,
    preferDocumentRelative
  })
  await completeAsyncImageInsertion(
    admission,
    Promise.resolve(source),
    imageInsertionContext,
    async (target, surface, admittedSource) => {
      await target.insertImageAsset({
        documentId: admission.documentId,
        source: admittedSource,
        storage: admittedSource.kind === 'binary' && storage === 'reference'
          ? 'configured-folder'
          : storage,
        surface
      })
    }
  )
}

const insertImage = (src: unknown) => {
  if (typeof src !== 'string' && !isImageSourceCapability(src)) {
    throw new TypeError(
      'Insert image requires a URL or native source capability.'
    )
  }
  reportAsyncTask(
    insertPersistedImage(src),
    'Image asset insertion'
  )
}

// Search/replace/find return a live Search instance with circular renderer
// references, and each match carries a live `block`
// reference. The store deep-clones (JSON.stringify) its payload, so extract
// only the plain { index, matches, value } the search UI needs.
const toSearchMatches = (
  result: ReturnType<DesktopEditorInstance['search']>
) => {
  return {
    index: result.index,
    matches: result.matches.map((match) => ({
      start: match.start,
      end: match.end,
      match: match.match
    })),
    value: result.value
  }
}

const handleSearch = (payload: unknown) => {
  const { query, selectActiveMatch } = decodeSearchRequest(payload)
  const targetEditor = editor.value
  if (!targetEditor) return
  if (selectActiveMatch) targetEditor.selectActiveSearchMatch()
  editorStore.SEARCH(toSearchMatches(targetEditor.search(query)))
  scrollToHighlight()
}

const handReplace = (payload: unknown) => {
  const {
    query,
    replacement,
    isSingle
  } = decodeReplaceRequest(payload)
  const targetEditor = editor.value
  if (!targetEditor) return
  reportAsyncTask(
    targetEditor.replace(replacement, {
      query,
      isSingle
    }).then((result) => {
      if (editor.value !== targetEditor) return
      editorStore.SEARCH(toSearchMatches(result))
    }),
    'Search replacement'
  )
}

// `domNode` is the contenteditable + scroll container (it inherits the
// `.editor-component` class from the original mount point and `overflow:auto`).
const getScrollContainer = (): HTMLElement | null =>
  (editor.value?.domNode as HTMLElement | undefined) ?? null

// Viewport-relative caret rect. Used for typewriter + keep-cursor-visible scrolling
// when we are not inside a `selection-change` event (which already supplies it).
const getCursorY = (): number | null => {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const range = sel.getRangeAt(0).cloneRange()
  let rects = range.getClientRects()
  if (rects.length === 0 && range.startContainer) {
    const parent =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement
    rects = parent ? parent.getClientRects() : rects
  }
  return rects.length ? rects[0].y : null
}

const scrollToCursor = (duration = 300) => {
  nextTick(() => {
    const container = getScrollContainer()
    if (!container) return
    const y = getCursorY()
    if (y == null) return
    animatedScrollTo(container, container.scrollTop + y - STANDAR_Y, duration)
  })
}

const scrollToCords = (y: number) => {
  const container = getScrollContainer()
  if (!container) return
  // Depending on how much the user previously scrolled, sometimes the container has not fully rendered all elements.
  // Hence, container.scrollHeight < [saved scrollTop]
  // What we need to do is to temporarily add a padding to the container so that we can actually set the scrollTop without getting clamped.

  const maxScrollHeight = container.scrollHeight - container.clientHeight // max scroll height is actually calculated as such
  if (y > maxScrollHeight) {
    const editorId = container.firstElementChild as HTMLElement | null
    if (editorId) {
      editorId.style.paddingBottom = `${y - maxScrollHeight + 100}px` // 100px is the default editor padding
      // attach a resize observer so we know when to remove the padding when it is of the "correct" height
      resizeObserverForEditor.observe(editorId)
    }
  }
  requestAnimationFrame(() => {
    if (!container) return
    // wait for the padding to be applied (if any)
    container.style.visibility = 'visible'
    container.style.pointerEvents = 'auto'
    container.scrollTop = y
  })
}

// Smoothly scroll the editor so `anchor` sits at the standard top offset.
// Shared by the TOC, search-highlight, and any other "reveal this element"
// caller so the getBoundingClientRect + animatedScrollTo math lives once.
const scrollElementIntoView = (anchor: Element | null | undefined, duration = 300) => {
  const container = getScrollContainer()
  if (!container || !anchor) return
  const { y } = anchor.getBoundingClientRect()
  animatedScrollTo(container, container.scrollTop + y - STANDAR_Y, duration)
}

const scrollToHighlight = () => {
  return scrollToElement('.document-view-highlight')
}

/**
 * Scrolls to the rendered heading carrying the parser identity published by
 * the same document snapshot.
 */
const scrollToHeader = (nodeId: unknown) => {
  const targetEditor = editor.value
  if (!targetEditor) return
  scrollElementIntoView(resolveTocHeadingElement(targetEditor, nodeId))
}

// Scrolls to a non-heading in-document anchor target (e.g. a custom
// `<a id="...">`) resolved from a parser-authenticated anchor fragment.
const scrollToAnchorElement = (element: unknown) => {
  if (element instanceof Element) scrollElementIntoView(element)
}

const scrollToElement = (selector: string) => {
  // Scroll to search highlight word
  scrollElementIntoView(document.querySelector(selector))
}

const handleFindAction = (action: unknown) => {
  const targetEditor = editor.value
  if (!targetEditor) return
  if (action !== 'previous' && action !== 'next') {
    throw new TypeError(`Unknown find action: ${String(action)}`)
  }
  editorStore.SEARCH(toSearchMatches(targetEditor.find(action)))
  scrollToHighlight()
}

const handleExport = async (value: unknown) => {
  const command = decodeEditorExportCommand(value)
  const targetEditor = editor.value
  if (!targetEditor) {
    throw new Error('Cannot export without an active editor.')
  }
  const { type, options } = command

  const documentCoreId = (): string => {
    const id = currentFile.value?.id
    if (!id) {
      throw new Error(
        'Cannot export a document-core tab without its document id.'
      )
    }
    return id
  }
  const documentCoreView = (): ConsumerView => {
    const projection =
      targetEditor.getCriticMarkupReviewSnapshot().projection
    return projection === 'marked' ? 'markup' : projection
  }
  const snapshot = targetEditor.snapshot()
  const exportedDocumentId = documentCoreId()
  const exportedView = documentCoreView()
  const filename = currentFile.value?.filename ?? 'Untitled.md'
  const rawName = window.path.parse(filename).name
  const safeName = rawName
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f/\\]/g, ' ')
    .trim()
    .slice(0, 255)
  const suggestedName =
    safeName.length === 0 || safeName === '.' || safeName === '..'
      ? 'Untitled'
      : safeName

  try {
    const receipt = decodeDocumentCoreStaticSinkReceipt(
      await window.electron.ipcRenderer.invoke(
        'mt::document-core::materialize-static',
        type === 'print'
          ? {
              documentId: exportedDocumentId,
              revisionId: snapshot.revisionId,
              consumer: 'print',
              view: exportedView,
              options
            }
          : {
              documentId: exportedDocumentId,
              revisionId: snapshot.revisionId,
              consumer: type === 'styledHtml' ? 'styled-html' : 'pdf',
              view: exportedView,
              suggestedName,
              options
            }
      )
    )
    if (receipt.kind === 'cancelled') return
    if (receipt.kind === 'unavailable') {
      throw new Error('The current parser revision cannot be exported.')
    }
    if (receipt.kind === 'submitted') return
    if (receipt.kind === 'written' || receipt.kind === 'proof-written') {
      await notice.notify({
        title: t('store.editor.exportSuccessTitle'),
        message: t('store.editor.exportSuccessMessage', {
          name: window.path.basename(receipt.targetPath)
        }),
        showConfirm: true
      })
      await revealStaticOutput({
        documentId: exportedDocumentId,
        revisionId: receipt.revisionId,
        consumer: receipt.consumer,
        view: receipt.view
      })
      return
    }
    throw new TypeError(
      `Unknown static sink receipt: ${String((receipt as { kind: unknown }).kind)}`
    )
  } catch (err) {
    log.error(`Failed to ${type} document-core revision:`, err)
    notice.notify(type === 'print'
      ? {
          title: t('editor.print.failed'),
          type: 'error',
          message: t('editor.print.error', { title: options.title })
        }
      : {
          title: t('editor.export.failed', { type }),
          type: 'error',
          message: t('editor.export.errorExporting', { type })
        })
  }
}

// Push the current selection to the application-menu / toolbar state. Called on
// every document-view selection-change, and again right after a paragraph action: a no-op
// action (e.g. "Paragraph" inside a list/quote) fires no selection-change, so the
// clicked checkbox menu item's auto-toggled OS checkmark would otherwise linger.
// G5: the menu-row availability record — capability snapshot x selection
// context x surface — recomputed on every input that can change it.
const publishCapabilityMenuState = (): void => {
  const context = selectionChange.value
  window.electron.ipcRenderer.send(
    'mt::set-document-capability-menu-state',
    documentCapabilityMenuState(
      capabilityStore.snapshot,
      context === null ? null : createApplicationMenuState(context),
      sourceCode.value ? 'source' : 'markup'
    )
  )
}

const pushSelectionMenuState = (context: DocumentSelectionContext) => {
  editorStore.SELECTION_CHANGE(context)
  editorStore.SELECTION_FORMATS(context.activeInlineFormats)
  publishDocumentClipboardMenuState(context.selectedText.length > 0)
  publishCapabilityMenuState()
}

const publishDocumentClipboardMenuState = (hasSelection: boolean): void => {
  const surface = sourceCode.value
    ? 'source'
    : editor.value === null
      ? 'markup'
      : documentSurfaceFromProjection(editor.value.getProjection())
  window.electron.ipcRenderer.send(
    'mt::set-document-clipboard-menu-state',
    { surface, hasSelection }
  )
}

// Non-negotiable 10: these commands act on the semantic surface, so they are
// impossible in Source mode. Rejecting visibly is what distinguishes
// "cannot run here" from "ran and did nothing".
const rejectUnavailableInSource = (): void => {
  const tabId = currentFile.value?.id
  if (typeof tabId !== 'string') return
  presentSurfaceCommandOutcome(
    { kind: 'unavailable-in-surface', surface: 'source' },
    tabId,
    editorStore,
    t
  )
}

// These commands act on the semantic view, so they are impossible in Source
// mode — otherwise the Insert Table wizard could target the hidden surface
// (#3531). They reject visibly rather than returning silently.
// The one terminal fan-in for editor commands: an id resolves to a typed
// intent (or a UI affordance) here. Commands other components own — the
// find family — are ignored; their subscribers hold their own arms.
const handleEditorCommand = (value: unknown) => {
  const command = decodeEditorCommandId(value)
  switch (command) {
    case 'undo': return handleUndo()
    case 'redo': return handleRedo()
    case 'select-all': return handleSelectAll()
    case 'copy-as-rich':
    case 'copy-as-html':
    case 'paste-as-plain-text':
      return handleCopyPaste(command)
    case 'duplicate-block':
    case 'insert-paragraph':
    case 'delete-block':
      return handleParagraph(command)
    case 'insert-table':
      return handleRequestTable()
    case 'format-image':
      return handleOpenImageSelector()
    default:
  }
  const conversion = BLOCK_CONVERSION_COMMANDS[command]
  if (conversion !== undefined) return handleBlockConversion(conversion)
  const format = INLINE_FORMAT_COMMANDS[command]
  if (format !== undefined) return handleInlineFormat(format)
}

const handleRequestTable = () => {
  if (sourceCode.value) {
    rejectUnavailableInSource()
    return
  }
  const targetEditor = editor.value
  if (targetEditor === null) return
  reportAsyncTask(targetEditor.requestTable(), 'Create table')
}

const handleBlockConversion = (conversion: BlockConversion) => {
  if (sourceCode.value) {
    rejectUnavailableInSource()
    return
  }
  {
    const targetEditor = editor.value
    if (targetEditor === null) return
    reportAsyncTask(
      targetEditor.dispatchTargetedIntent({
        kind: 'convert-block',
        conversion
      }).then(() => {
        if (editor.value !== targetEditor) return
        // Re-sync the menu so a no-op action (e.g. "Paragraph" inside a
        // list/quote) does not leave the clicked checkbox item checked. A real
        // conversion fires its own selection-change, which resyncs again.
        if (selectionChange.value) {
          pushSelectionMenuState(selectionChange.value)
        }
      }).catch((error: unknown) => {
        // A refusal is a normal outcome of the command against the wrong
        // state — rapid menu alternation can resolve two clicks to the same
        // shape, and the second changes nothing (the zero-delta rule
        // rejects it visibly). Tell the user through the surface banner,
        // not the error reporter.
        if (!(error instanceof DocumentCoreIntentRejectedError)) throw error
        const tabId = currentFile.value?.id
        if (typeof tabId !== 'string') return
        presentSurfaceCommandOutcome(
          { kind: 'refused', reason: error.reason },
          tabId,
          editorStore,
          t
        )
      }),
      'Paragraph conversion'
    )
  }
}

// handle `duplicate`, `delete`, `create paragraph below`
const handleParagraph = (
  action: 'duplicate-block' | 'insert-paragraph' | 'delete-block'
) => {
  if (sourceCode.value) {
    rejectUnavailableInSource()
    return
  }
  const targetEditor = editor.value
  if (targetEditor === null) return
  const operation = action === 'insert-paragraph'
    ? targetEditor.dispatchTargetedIntent({
      kind: 'insert-paragraph',
      location: 'after'
    })
    : targetEditor.dispatchTargetedIntent({ kind: action })
  reportAsyncTask(operation, `Paragraph ${action}`)
}

const handleOpenImageSelector = () => {
  if (sourceCode.value) {
    rejectUnavailableInSource()
    return
  }
  const targetEditor = editor.value
  if (targetEditor === null) return
  reportAsyncTask(targetEditor.openImageSelector(), 'Open Image selector')
}

const handleInlineFormat = (format: InlineFormat) => {
  if (sourceCode.value) {
    rejectUnavailableInSource()
    return
  }
  const targetEditor = editor.value
  if (targetEditor === null) return
  reportAsyncTask(
    targetEditor.dispatchTargetedIntent({
      kind: 'format-text',
      format
    }).catch(
      (error: unknown) => {
        // A refusal (collapsed selection, stale target) is a normal outcome
        // of the command against the wrong state: tell the user through the
        // surface banner, not the error reporter.
        if (!(error instanceof DocumentCoreIntentRejectedError)) throw error
        const tabId = currentFile.value?.id
        if (typeof tabId !== 'string') return
        presentSurfaceCommandOutcome(
          { kind: 'refused', reason: error.reason },
          tabId,
          editorStore,
          t
        )
      }
    ),
    'Inline formatting'
  )
}

const requestCriticMarkupText: CriticMarkupTextRequest = (kind) => {
  // Release contenteditable focus before Element Plus starts trapping focus.
  // The document view retains its cached source selection for this menu/dialog round trip,
  // so the eventual command still applies to the intended text.
  handleModalOpening()
  return criticMarkupPromptDialog.value?.request(kind) ?? Promise.resolve(null)
}

const cancelCriticMarkupPrompt = (): void => criticMarkupPromptDialog.value?.cancel()

useCriticMarkupReviewController({
  editor: computed(() => editor.value as ICriticMarkupReviewEditor | null),
  documentId: computed(() => currentFile.value?.id ?? null),
  sourceCode,
  requestText: requestCriticMarkupText,
  cancelTextRequest: cancelCriticMarkupPrompt,
  commandNotificationSink: editorStore,
  translate: key => t(key)
})

useDocumentSurfaceContext({
  editor: computed(() => editor.value),
  documentId: computed(() => currentFile.value?.id ?? null),
  sourceCode,
  semanticRoot: editorRef
})

useCriticMarkupRejectionNotifier({
  editor: computed(() => editor.value),
  tabId: computed(() => currentFile.value?.id ?? null)
})

const handleDialogTableConfirm = () => {
  tableShapeDialogRequest.confirm(tableChecker)
}

interface FileLoadedPayload {
  id?: string
  cursor?: unknown
}

// Switching the mounted main-owned session publishes a mounted snapshot, not a
// document mutation. Keep all load/switch-only derived state in one explicit
// seed so the title-bar count and TOC describe the same canonical snapshot.
// This intentionally bypasses LISTEN_FOR_CONTENT_CHANGE, which also owns
// dirty/save bookkeeping and would turn a load into an edit.
const seedDerivedDocumentState = (activeEditor: DesktopEditorInstance): void => {
  const snapshot = activeEditor.snapshot()
  editorStore.UPDATE_TOC(activeEditor.getTOC())
  editorStore.UPDATE_WORD_COUNT(snapshot.facts.statistics)
  // The restored caret is a live context the menus must reflect immediately:
  // without this, Format and Paragraph stay disabled until the first real
  // selection change. SourceOnly revisions have no context to publish.
  const context = activeEditor.selection()
  if (context !== null) pushSelectionMenuState(context)
}

// listen for `open-single-file` event, it will call this method only when open a new file.
const setMarkdownToEditor = (payload: unknown) => {
  const { id, cursor: newCursor } = (payload ?? {}) as FileLoadedPayload
  const target = editor.value
  if (target === null || typeof id !== 'string') return
  reportAsyncTask(
    target.attachDocument(id).then(() => {
      if (!editor.value) return
      if (newCursor) {
        applyCursor(editor.value, newCursor)
        if (isIndexCursor(newCursor)) scrollToCursor()
      }
      seedDerivedDocumentState(editor.value)
      focusFreshEditor()
    }),
    'Document load'
  )
}

interface FileChangePayload {
  id?: string
  cursor?: unknown
  scrollTop?: number
}

// Main owns document open/reload and publishes the attached session by id.
const handleFileChange = (payload: unknown) => {
  const {
    id,
    cursor: newCursor,
    scrollTop
  } = (payload ?? {}) as FileChangePayload
  const target = editor.value
  if (target === null) return
  const container = getScrollContainer()
  if (!container) return

  if (typeof id === 'string') {
    reportAsyncTask(
      target.attachDocument(id).then(() => {
        if (!editor.value) return
        seedDerivedDocumentState(editor.value)
        if (newCursor) applyCursor(editor.value, newCursor)
        // An activated tab is where the user is about to type: take DOM focus
        // once the visibility-restore rAF has run, exactly like the
        // open-single-file path — otherwise a fresh untitled tab (or any tab
        // switch) leaves focus on the tab bar and keystrokes go nowhere. The
        // per-tab scrollTop restore owns the viewport here, so focusing must
        // not drag the container back to the caret.
        focusFreshEditor({ preserveScroll: true })
      }),
      'Document attachment'
    )
  }

  if (typeof scrollTop === 'number') {
    container.style.visibility = 'hidden'
    container.style.pointerEvents = 'none'
    scrollToCords(scrollTop)
  } else {
    container.style.visibility = 'visible'
    container.style.pointerEvents = 'auto'
    scrollToCursor(0)
  }
}

const handleInsertParagraph = (location: unknown) => {
  if (location !== 'before' && location !== 'after' && location !== undefined) {
    throw new TypeError(`Unknown paragraph insertion location: ${String(location)}`)
  }
  const targetEditor = editor.value
  if (targetEditor === null) return
  reportAsyncTask(
    targetEditor.dispatchTargetedIntent({
      kind: 'insert-paragraph',
      location: location ?? 'after'
    }),
    'Insert paragraph'
  )
}

const blurEditor = () => {
  editor.value?.blur()
}

const flushActiveEditor = (event?: unknown) => {
  const request = (() => {
    if (event === undefined) return undefined
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError('Flush request must be a closed record.')
    }
    const record = event as Record<string, unknown>
    const keys = Object.keys(record)
    if (
      keys.length !== 3 ||
      !keys.includes('defer') ||
      !keys.includes('complete') ||
      !keys.includes('fail') ||
      typeof record.defer !== 'function' ||
      typeof record.complete !== 'function' ||
      typeof record.fail !== 'function'
    ) {
      throw new TypeError('Flush request has an invalid contract.')
    }
    return event as FlushActiveEditorRequest
  })()
  // A dimensions dialog cannot outlive a persistence/lifecycle barrier. Its
  // pending view operation precedes flush in the host queue, so settle it first.
  cancelTableShapeRequest()
  const target = editor.value
  const settle = async (): Promise<void> => {
    // The Source textarea admits gestures through its own serial queue before
    // they reach the document session. Drain that queue first, then flush the
    // session so persistence can only observe the admitted canonical head.
    await settleSourceModeInput()
    await target?.flush()
  }
  if (request !== undefined) {
    request.defer()
    settle()
      .then(() => request.complete(), request.fail)
    return
  }
  reportAsyncTask(settle(), 'Flush active editor')
}

const focusEditor = () => {
  editor.value?.focus()
}

// Focus a freshly opened/created tab's editor. The sibling `file-changed`
// handler (emitted first, while the store commits the tab switch) hides the
// editor and queues a `requestAnimationFrame` via `scrollToCords` to restore
// it, and focus() is a no-op while the container is `visibility:hidden`. Our
// rAF is registered after that restore rAF, so it runs once the editor is
// visible; then take DOM focus (the host's `focus()` sets only the selection
// range — the contenteditable also needs focus or no caret blinks) and place
// the caret at the document start.
const focusFreshEditor = (
  options: Readonly<{ preserveScroll?: boolean }> = {}
) => {
  requestAnimationFrame(() => {
    const ed = editor.value
    if (!ed) return
    // Source mode owns the surface: focusing the hidden WYSIWYG host would
    // enqueue selection work the view rejects in SourceOnly state, and the
    // rejection is loudly reported. The source adapter takes its own focus.
    if (sourceCode.value) return
    if (options.preserveScroll) {
      // Focus and selection restoration both scroll the caret into view; a
      // tab switch restores the tab's own scrollTop instead, so reapply it
      // after focus wins the frame.
      const container = getScrollContainer()
      const scrollTop = container?.scrollTop ?? 0
      ed.domNode.focus({ preventScroll: true })
      ed.focus()
      if (container) container.scrollTop = scrollTop
      return
    }
    ed.domNode.focus()
    ed.focus()
  })
}

// When a focus-trapping modal (the command palette) opens, release the editor's
// contenteditable focus first. element-plus's el-dialog restores focus to the
// previously focused element on close; restoring it into the document
// contenteditable while its selection is uncommitted makes the focus-trap and
// selection handling fight, freezing the renderer. Blurring up
// front removes the editor as the restore target and avoids the loop.
const handleModalOpening = () => {
  if (editor.value && editor.value.hasFocus()) {
    editor.value.blur()
  }
}

// macOS Edit → Screenshot. Main captures the region and sends one sender-bound,
// single-use source capability; the native pathname never enters renderer.
const handleScreenShot = (source?: unknown) => {
  if (editor.value && isImageSourceCapability(source)) {
    reportAsyncTask(
      insertPersistedImage(source),
      'Screenshot image insertion'
    )
  }
}

const transferredImageFile = (
  transfer: DataTransfer | null
): File | null => {
  if (transfer === null) return null
  return Array.from(transfer.files).find(file =>
    file.type.startsWith('image/') ||
    /\.(?:jpe?g|png|gif|webp|svg)$/i.test(file.name)
  ) ?? null
}

const handleResetPaddingBottom = () => {
  const container = getScrollContainer()
  if (!container) return
  const firstChild = container.firstElementChild as HTMLElement | null
  if (!firstChild) return
  const newScollableHeightWithoutPadding =
    container.scrollHeight - container.clientHeight - parseFloat(firstChild.style.paddingBottom)

  if (currentFile.value && newScollableHeightWithoutPadding > currentFile.value.scrollTop) {
    container.style.paddingBottom = ''
    resizeObserverForEditor.unobserve(firstChild) // unobserve #ag-editor-id since we have removed the padding
  }
}

const handleLanguageChanged = (newLocale?: unknown) => {
  const target = editor.value
  if (target === null) return
  const locale = typeof newLocale === 'string' ? newLocale : language.value
  reportAsyncTask(
    applyDesktopDocumentViewLocale({
      language: locale,
      ensureDesktopLocale,
      translate: key => t(key),
      setLocale: resource => {
        if (editor.value === target) target.setLocale(resource)
      }
    }),
    'Update editor locale'
  )
}
const resizeObserverForEditor = new ResizeObserver(handleResetPaddingBottom)

useEditorLifecycle(async () => {
  const ele = editorRef.value
  if (!ele) return

  const environment = window.electron.process.env
  const bootstrapDocumentId = currentFile.value?.id ?? 'untitled-bootstrap'
  const activeDocumentId = (): string =>
    currentFile.value?.id ?? bootstrapDocumentId
  let mountedDocumentId = bootstrapDocumentId
  const remoteSession = await createDocumentCoreRemoteSession({
    documentId: activeDocumentId,
    onHistoryState: (documentId, state) => {
      mountedDocumentId = documentId
      documentCoreHistoryByTab.set(documentId, state)
      editorStore.APPLY_DOCUMENT_CORE_HISTORY_STATE(documentId, state)
    },
    // G5: the Edit menu's enablement is a projection of the one published
    // capability snapshot — it also encodes read-only projections, which a
    // raw history push cannot.
    onIntentCapabilities: (documentId, capabilities) => {
      if (documentId !== activeDocumentId()) return
      capabilityStore.UPDATE_CAPABILITIES(capabilities)
      publishCapabilityMenuState()
    },
    invoke: window.electron.ipcRenderer.invoke as unknown as
      DocumentCoreRemoteSessionOptions['invoke']
  })
  activeRemoteSession = remoteSession
  const mountedEditor = markRaw(await createDocumentEditorHost({
    element: ele,
    session: remoteSession,
    requestTableShape,
    configuration: {
      fontSize: fontSize.value,
      lineHeight: lineHeight.value,
      editorFontFamily: resolveEditorFont(editorFontFamily.value),
      codeFontSize: codeFontSize.value,
      codeFontFamily: resolveCodeFont(codeFontFamily.value),
      editorLineWidth: editorLineWidth.value,
      wrapCodeBlocks: wrapCodeBlocks.value,
      footnotes: footnotes.value,
      gitLabMath: gitLabMath.value,
      subscriptAndSuperscript: subscriptAndSuperscript.value,
      spellcheck: spellcheckerEnabled.value,
      hideSpellcheckMarks: spellcheckerNoUnderline.value,
      autoPairBrackets: autoPairBracket.value,
      autoPairQuotes: autoPairQuote.value,
      autoPairMarkdown: autoPairMarkdownSyntax.value,
      autoCheckTasks: autoCheck.value,
      hideQuickInsertHint: hideQuickInsertHint.value,
      hideLinkTools: hideLinkPopup.value,
      criticMarkupTrackChanges: false,
      criticMarkupProjection: 'marked'
    }
  }))
  await applyDesktopDocumentViewLocale({
    language: language.value,
    ensureDesktopLocale,
    translate: key => t(key),
    setLocale: locale => mountedEditor.setLocale(locale)
  })
  mountedEditor.setFocusMode(focus.value)
  editor.value = mountedEditor
  const sourcePublication = (): SourceModePublication => {
    const documentId = mountedDocumentId
    const snapshot = mountedEditor.snapshot()
    const history = documentCoreHistoryByTab.get(documentId)
    if (history === undefined) {
      throw new Error(`Main did not publish history state for ${documentId}`)
    }
    return Object.freeze({
      documentId,
      revisionId: snapshot.revisionId,
      source: snapshot.source,
      selection: snapshot.sourceSelection,
      history,
      outline: Object.freeze(mountedEditor.getTOC().map(item =>
        Object.freeze({
          nodeId: item.nodeId,
          slug: item.slug,
          sourceOffset: item.sourceOffset
        })
      ))
    })
  }
  const sourcePort: SourceModeDocumentPort = Object.freeze({
    snapshot: sourcePublication,
    subscribe: (
      listener: (publication: SourceModePublication) => void
    ) => {
      const publish = (): void => listener(sourcePublication())
      const content = mountedEditor.subscribeDocumentChange(publish)
      const selection = mountedEditor.subscribeSelection(publish)
      return Object.freeze({
        dispose: () => {
          content.dispose()
          selection.dispose()
        }
      })
    },
    edit: async (request: SourceModeEditRequest) => {
      const before = sourcePublication()
      if (request.revisionId !== before.revisionId) {
        throw new Error('Source gesture targets a stale verified revision')
      }
      await mountedEditor.editSource(
        request.start,
        request.end,
        request.text,
        request.selection
      )
      return sourcePublication()
    },
    cut: async (request: SourceModeEditRequest) => {
      const before = sourcePublication()
      if (request.revisionId !== before.revisionId) {
        throw new Error('Source cut targets a stale verified revision')
      }
      await mountedEditor.cutSource({
        start: request.start,
        end: request.end
      })
      return sourcePublication()
    },
    copy: async (request: SourceModeCopyRequest) => {
      const before = sourcePublication()
      if (request.revisionId !== before.revisionId) {
        throw new Error('Source copy targets a stale verified revision')
      }
      await mountedEditor.copySource({
        start: request.start,
        end: request.end
      })
    },
    paste: async (request: SourceModePasteRequest) => {
      const before = sourcePublication()
      if (request.revisionId !== before.revisionId) {
        throw new Error('Source paste targets a stale verified revision')
      }
      await mountedEditor.pasteSourceClipboard(request.selection)
      return sourcePublication()
    },
    insertImage: async (request: SourceModeImageRequest) => {
      await mountedEditor.insertSourceImage(request)
      return sourcePublication()
    },
    select: async (selection: SourceModeSelection) => {
      await mountedEditor.selectSource(selection)
      return sourcePublication()
    },
    undo: async () => {
      await mountedEditor.dispatchIntent({ kind: 'undo' })
      return sourcePublication()
    },
    redo: async () => {
      await mountedEditor.dispatchIntent({ kind: 'redo' })
      return sourcePublication()
    },
    settled: mountedEditor.settled
  })
  disposeSourceModeDocumentPort =
    registerSourceModeDocumentPort(sourcePort).dispose
  disposeDocumentCoreTabCloser = registerDocumentCoreTabCloser(
    async (documentId) => {
      const remote = activeRemoteSession
      if (remote === null) return
      await remote.closeDocument(documentId)
      documentCoreHistoryByTab.delete(documentId)
    }
  ).dispose
  // The first document's content is set via constructor options, so no
  // `file-loaded` / `setMarkdownToEditor` runs for it.
  seedDerivedDocumentState(mountedEditor)

  const container = getScrollContainer()!

  const isImageAuthoringTarget = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    (
      container.contains(target) ||
      (
        target instanceof Element &&
        target.closest('.source-code-input') !== null
      )
    )
  const insertTransferredImage = (
    event: ClipboardEvent | DragEvent,
    label: string
  ): void => {
    if (!isImageAuthoringTarget(event.target)) return
    const file = transferredImageFile(
      event instanceof ClipboardEvent
        ? event.clipboardData
        : event.dataTransfer
    )
    if (file === null) return
    event.preventDefault()
    event.stopImmediatePropagation()
    reportAsyncTask(
      insertPersistedImage(file),
      label
    )
  }
  const handleClipboardImage = (event: ClipboardEvent): void =>
    insertTransferredImage(event, 'Clipboard image insertion')
  const handleDroppedImage = (event: DragEvent): void =>
    insertTransferredImage(event, 'Dropped image insertion')
  window.addEventListener('paste', handleClipboardImage, true)
  window.addEventListener('drop', handleDroppedImage, true)
  disposeImageAssetInput = () => {
    window.removeEventListener('paste', handleClipboardImage, true)
    window.removeEventListener('drop', handleDroppedImage, true)
  }

  // Listen for language changes and update the engine locale.
  bus.on('language-changed', handleLanguageChanged)

  // Create spell check wrapper and enable spell checking if preferred.
  spellchecker = new SpellChecker(spellcheckerEnabled.value, spellcheckerLanguage.value)
  reportAsyncTask(
    applySpellcheckerEnabledState(
      spellchecker,
      spellcheckerEnabled.value,
      spellcheckerLanguage.value
    ),
    'Initialize spell checker'
  )

  // Register command palette entry for switching spellchecker language.
  switchLanguageCommand = new SpellcheckerLanguageCommand(spellchecker)
  setTimeout(() => bus.emit('cmd::register-command', switchLanguageCommand), 100)

  if (typewriter.value) {
    scrollToCursor()
  }

  // listen for bus events.
  bus.on('file-loaded', setMarkdownToEditor)
  bus.on('editor-command', handleEditorCommand)
  bus.on('export', handleExport)
  bus.on('searchValue', handleSearch)
  bus.on('replaceValue', handReplace)
  bus.on('find-action', handleFindAction)
  bus.on('insert-image', insertImage)
  bus.on('file-changed', handleFileChange)
  bus.on('flush-active-editor', flushActiveEditor)
  bus.on('editor-blur', blurEditor)
  bus.on('editor-focus', focusEditor)
  bus.on('insertParagraph', handleInsertParagraph)
  bus.on('scroll-to-header', scrollToHeader)
  bus.on('scroll-to-anchor-element', scrollToAnchorElement)
  bus.on('screenshot-captured', handleScreenShot)
  bus.on('show-command-palette', handleModalOpening)
  bus.on('switch-spellchecker-language', switchSpellcheckLanguage)
  bus.on('open-command-spellchecker-switch-language', openSpellcheckerLanguageCommand)
  bus.on('replace-misspelling', replaceMisspelling)

  // Every committed document mutation publishes a verified snapshot. The
  // desktop caches its derived source, counts, cursor, TOC, and block plan for
  // presentation only.
  editor.value.subscribeDocumentChange(() => {
    cancelTableShapeRequest()
    // There is a chance that this event is fired AFTER the tab is switched. If we purely rely on this.currentFile later on
    // it can cause invalid updates. Hence, we need the id to identify changes as part of each tab
    if (!editor.value) return
    const id = mountedDocumentId
    if (!id) return
    const markdown = editor.value.getMarkdown()
    const documentCoreHistory = documentCoreHistoryByTab.get(id)
    if (documentCoreHistory === undefined) {
      throw new Error(`Main did not publish history state for ${id}`)
    }
    const snapshot = editor.value.snapshot()
    editorStore.LISTEN_FOR_CONTENT_CHANGE({
      id,
      markdown,
      wordCount: snapshot.facts.statistics,
      cursor: serializeCursor(editor.value.selection()),
      documentCoreHistory,
      toc: editor.value.getTOC(),
      blocks: snapshot.blocks
    })
  })

  // The engine does not emit `scroll`; listen on the scroll container directly
  // so the desktop can persist each tab's scroll position.
  scrollHandler = () => {
    if (currentFile.value) {
      editorStore.updateScrollPosition(currentFile.value.id, container.scrollTop)
    }
  }
  container.addEventListener('scroll', scrollHandler, { passive: true })

  const previewImage = (src: string): void => {
    if (imageViewer) {
      imageViewer.destroy()
    }
    const viewerContainer = imageViewerOverlayRef.value?.getContainer()
    if (viewerContainer) {
      imageViewer = new SimpleImageViewer(viewerContainer, { url: src })
      setImageViewerVisible(true)
    }
  }
  editor.value.subscribeInteraction((interaction: DocumentHostInteraction) => {
    if (interaction.kind === 'copy-heading-link') {
      const activeEditor = editor.value
      if (activeEditor === null) return
      const projection = activeEditor.getProjection()
      const copyHeadingLink = window.electron.ipcRenderer.invoke(
        'mt::document-core::write-clipboard',
        {
          documentId: activeDocumentId(),
          revisionId: activeEditor.snapshot().revisionId,
          view: projection === 'marked' ? 'markup' : projection,
          consumer: 'copy-heading-link',
          targetNodeId: interaction.targetNodeId
        }
      ).then((receipt) => {
        if (
          receipt.kind === 'unavailable' ||
          receipt.kind === 'disabled'
        ) {
          throw new Error(
            `Document-core heading link is unavailable: ${receipt.reason}`
          )
        }
        if (receipt.kind !== 'written') {
          throw new Error(
            `Document-core heading link returned ${receipt.kind}`
          )
        }
        notice.notify({
          title: t('store.editor.anchorLinkCopied'),
          type: 'primary',
          time: 2000,
          showConfirm: false
        })
      })
      reportAsyncTask(copyHeadingLink, 'Copy parser-owned heading link')
    } else if (interaction.kind === 'navigate-link') {
      const activeEditor = editor.value
      if (activeEditor === null) return
      const openLink = window.electron.ipcRenderer.invoke(
        'mt::document-core::open-link',
        {
          documentId: activeDocumentId(),
          revisionId: activeEditor.snapshot().revisionId,
          targetNodeId: interaction.targetNodeId
        }
      ).then((receipt) => {
        if (receipt.kind === 'anchor') {
          editorStore.NAVIGATE_DOCUMENT_ANCHOR(receipt.fragment)
        }
      })
      reportAsyncTask(openLink, 'Open parser-owned document link')
    } else {
      previewImage(interaction.src)
    }
  })

  editor.value.subscribeSelection((context) => {
    const y = context.cursor?.y ?? null
    if (y != null) {
      if (typewriter.value) {
        const startPosition = container.scrollTop
        const toPosition = startPosition + y - STANDAR_Y

        // Prevent micro shakes and unnecessary scrolling.
        if (Math.abs(startPosition - toPosition) > 2) {
          animatedScrollTo(container, toPosition, 100)
        }
      }

      // Used to fix #628: auto scroll cursor to visible if the cursor is too low.
      if (container.clientHeight - y < 100) {
        // editableHeight is the lowest cursor position(till to top) that editor allowed.
        const editableHeight = container.clientHeight - 100
        animatedScrollTo(container, container.scrollTop + (y - editableHeight), 0)
      } else if (y < 100) {
        // Symmetric to #628: scroll up when the cursor rises above the top edge
        // (e.g. Arrow-Up), otherwise the caret leaves the viewport (#3329).
        animatedScrollTo(container, container.scrollTop + (y - 100), 0)
      }
    }

    selectionChange.value = context
    // Persist the caret so a selection-only publication survives an in-session
    // tab switch — `tab.cursor` is what `handleFileChange` replays on
    // re-activation. Cheap: serialized caret only.
    if (currentFile.value?.id && editor.value) {
      editorStore.PERSIST_CURSOR(
        currentFile.value.id,
        serializeCursor(editor.value.selection())
      )
    }
    pushSelectionMenuState(context)
  })

  document.addEventListener('keyup', keyup)
}, () => {
  cancelTableShapeRequest()
  disposeDocumentCoreTabCloser()
  disposeDocumentCoreTabCloser = () => {}
  disposeSourceModeDocumentPort()
  disposeSourceModeDocumentPort = () => {}
  disposeImageAssetInput()
  disposeImageAssetInput = () => {}

  capabilityStore.CLEAR_CAPABILITIES()
  publishCapabilityMenuState()
  window.electron.ipcRenderer.send(
    'mt::set-document-clipboard-menu-state',
    { surface: 'source', hasSelection: false }
  )
  bus.off('file-loaded', setMarkdownToEditor)
  bus.off('editor-command', handleEditorCommand)
  bus.off('export', handleExport)
  bus.off('searchValue', handleSearch)
  bus.off('replaceValue', handReplace)
  bus.off('find-action', handleFindAction)
  bus.off('insert-image', insertImage)
  bus.off('file-changed', handleFileChange)
  bus.off('flush-active-editor', flushActiveEditor)
  bus.off('editor-blur', blurEditor)
  bus.off('editor-focus', focusEditor)
  bus.off('insertParagraph', handleInsertParagraph)
  bus.off('scroll-to-header', scrollToHeader)
  bus.off('scroll-to-anchor-element', scrollToAnchorElement)
  bus.off('screenshot-captured', handleScreenShot)
  bus.off('show-command-palette', handleModalOpening)
  bus.off('switch-spellchecker-language', switchSpellcheckLanguage)
  bus.off('open-command-spellchecker-switch-language', openSpellcheckerLanguageCommand)
  bus.off('replace-misspelling', replaceMisspelling)
  bus.off('language-changed', handleLanguageChanged)

  document.removeEventListener('keyup', keyup)

  // Remove the manual scroll listener; the document host owns and releases its
  // subscriptions during `destroy()`.
  if (scrollHandler && editor.value) {
    const container = getScrollContainer()
    container?.removeEventListener('scroll', scrollHandler)
  }
  scrollHandler = null

  resizeObserverForEditor.disconnect()

  if (imageViewer) {
    imageViewer.destroy()
    imageViewer = null
  }

  if (editor.value) {
    const target = editor.value
    editor.value = null
    activeRemoteSession = null
    reportAsyncTask(target.destroy(), 'Destroy document editor')
  }
})
</script>

<style src="./editor.css"></style>

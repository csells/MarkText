<template>
  <div
    class="editor-wrapper"
    :class="[
      {
        typewriter: typewriter,
        focus: focus,
        source: sourceCode,
        'viewer-open': viewerOpen,
        'core-review-enabled': coreLease !== undefined
      }
    ]"
    :dir="textDirection"
  >
    <div
      v-show="coreDisplayMode === 'markup'"
      ref="editorSurfaceRef"
      class="editor-surface"
      @click="selectCoreDocumentAnnotation"
      @keydown.capture="activateCoreCommentMarker"
      @mousedown="preserveCoreCommentCaret"
    >
      <!-- Muya replaces its mount element. Vue owns this outer visibility boundary. -->
      <div
        ref="editorRef"
        class="editor-component"
      />
    </div>
    <div
      v-if="coreDisplayMode !== 'markup' && coreDisplayProjection !== undefined"
      class="core-reader-banner"
      role="status"
      data-testid="core-reader-banner"
    >
      <span>{{
        t(
          coreDisplayMode === 'original'
            ? 'editor.coreReview.originalBanner'
            : 'editor.coreReview.revisedBanner'
        )
      }}</span>
      <button
        type="button"
        class="button small"
        data-testid="core-reader-banner-markup"
        @click="handleCoreReviewCommand('markup')"
      >
        {{ t('editor.coreReview.backToMarkup') }}
      </button>
    </div>
    <CoreDocumentProjection
      v-if="coreDisplayMode !== 'markup' && coreDisplayProjection !== undefined"
      :projection="coreDisplayProjection"
      :kind="coreDisplayMode"
      :label="
        t(
          coreDisplayMode === 'original'
            ? 'editor.coreReview.originalDocument'
            : 'editor.coreReview.revisedDocument'
        )
      "
    />
    <Teleport to="#core-review-panel">
      <section class="core-review-panel-content">
        <h2 class="side-bar-title">
          {{ t('editor.coreReview.sidebarTitle') }}
        </h2>
        <div class="core-review-controls">
          <p
            v-if="coreLease === undefined || sourceCode"
            class="core-review-hint"
          >
            {{ t('editor.coreReview.sourceHint') }}
          </p>
          <nav
            v-if="coreLease !== undefined && !sourceCode"
            class="core-review-views"
            :aria-label="t('editor.coreReview.viewTitle')"
          >
            <button
              v-for="mode in ['markup', 'original', 'revised'] as const"
              :key="mode"
              type="button"
              class="button small"
              :data-testid="`critic-review-${mode}`"
              :aria-pressed="coreDisplayMode === mode"
              :disabled="!reviewCommandEnabled(mode, coreReviewCommandState)"
              @click="handleCoreReviewCommand(mode)"
            >
              {{ t(`editor.coreReview.${mode}`) }}
            </button>
          </nav>
          <button
            v-if="coreLease !== undefined && !sourceCode && coreDisplayMode === 'markup'"
            class="core-track-toggle button small"
            type="button"
            data-testid="critic-review-track-changes"
            :aria-pressed="coreTrackChangesEnabled"
            :disabled="!reviewCommandEnabled('track-changes', coreReviewCommandState)"
            :title="t('editor.coreReview.trackChangesDescription')"
            @click="handleCoreReviewCommand('track-changes')"
          >
            {{ t('editor.coreReview.trackChanges') }}
          </button>
          <nav
            v-if="
              coreReviewItem !== null && coreLease !== undefined && !sourceCode && !coreCommentOpen
            "
            class="core-review-navigation"
            :aria-label="t('editor.coreReview.title')"
          >
            <button
              type="button"
              class="button small"
              data-testid="critic-review-previous"
              :disabled="!reviewCommandEnabled('previous', coreReviewCommandState)"
              @click="handleCoreReviewCommand('previous')"
            >
              {{ t('editor.coreReview.previous') }}
            </button>
            <button
              type="button"
              class="button small"
              data-testid="critic-review-next"
              :disabled="!reviewCommandEnabled('next', coreReviewCommandState)"
              @click="handleCoreReviewCommand('next')"
            >
              {{ t('editor.coreReview.next') }}
            </button>
            <span class="core-review-position">{{
              t('editor.coreReview.position', {
                current: coreReviewPosition,
                total: coreReviewOverview.length
              })
            }}</span>
          </nav>
        </div>
        <div class="core-review-scroll side-bar-scroll">
          <details
            v-if="coreLease !== undefined && !sourceCode"
            class="core-review-hint app-disclosure"
          >
            <summary>{{ t('editor.coreReview.viewHelp') }}</summary>
            <p>{{ t('editor.coreReview.viewHint') }}</p>
          </details>
          <CoreReviewList
            v-if="coreLease !== undefined && !sourceCode"
            :entries="coreReviewOverview"
            :text-direction="textDirection"
            :active-start="coreReviewTargeted ? coreReviewItem?.range.start : undefined"
            :reveal-request="coreReviewRevealRequest"
            :busy="coreReviewResolving"
            :composing="coreCommentOpen && coreCommentTarget !== undefined"
            :composer-start="coreComposerPlacement.composerStart"
            :draft-start="coreComposerPlacement.draftStart"
            @select="selectCoreReviewEntry"
          >
            <template #composer>
              <CoreReviewCommentEditor
                v-if="!sourceCode && coreCommentTarget !== undefined"
                v-model="coreCommentOpen"
                v-model:draft-text="coreCommentDraft"
                :target-id="coreCommentTarget.id"
                :text-direction="textDirection"
                :default-text="coreCommentTarget.text"
                :submitting="coreReviewResolving"
                :error="coreCommentError"
                :notice="coreCommentEscapeNotice"
                :test-id-prefix="
                  coreCommentTarget.form === 'substitution'
                    ? 'critic-review-replacement'
                    : 'critic-review-comment'
                "
                :allow-empty="coreCommentTarget.form !== 'substitution'"
                :label="
                  t(
                    coreCommentTarget.form === 'substitution'
                      ? 'editor.coreReview.replacementPrompt'
                      : 'editor.coreReview.commentPrompt'
                  )
                "
                :submit-label="
                  t(
                    coreCommentTarget.form === 'substitution'
                      ? 'editor.coreReview.suggestReplacement'
                      : 'editor.coreReview.saveComment'
                  )
                "
                :cancel-label="t('common.cancel')"
                :target-changed-label="t('editor.coreReview.commentTargetChanged')"
                @submit="submitCoreComment"
              />
            </template>
            <template #actions>
              <div
                v-if="!coreCommentOpen"
                class="core-review-item-actions"
              >
                <button
                  v-if="!coreReviewUsesRemove"
                  type="button"
                  class="button small"
                  data-testid="critic-review-accept"
                  :disabled="!reviewCommandEnabled('accept', coreReviewCommandState)"
                  @click="handleCoreReviewCommand('accept')"
                >
                  {{ t('editor.coreReview.accept') }}
                </button>
                <button
                  v-if="!coreReviewUsesRemove"
                  type="button"
                  class="button small"
                  data-testid="critic-review-reject"
                  :disabled="!reviewCommandEnabled('reject', coreReviewCommandState)"
                  @click="handleCoreReviewCommand('reject')"
                >
                  {{ t('editor.coreReview.reject') }}
                </button>
                <button
                  v-if="coreReviewItem?.kind === 'highlight'"
                  type="button"
                  class="button small"
                  data-testid="critic-review-add-comment"
                  :disabled="!reviewCommandEnabled('add-comment', coreReviewCommandState)"
                  @click="commentOnCoreHighlight()"
                >
                  {{ t('editor.coreReview.addComment') }}
                </button>
                <button
                  v-if="coreReviewHasComment"
                  type="button"
                  class="button small"
                  data-testid="critic-review-edit-comment"
                  :disabled="!reviewCommandEnabled('edit-comment', coreReviewCommandState)"
                  @click="handleCoreReviewCommand('edit-comment')"
                >
                  {{ t('editor.coreReview.editComment') }}
                </button>
                <button
                  v-if="coreReviewUsesRemove"
                  type="button"
                  class="button small"
                  data-testid="critic-review-remove"
                  :disabled="!reviewCommandEnabled('remove', coreReviewCommandState)"
                  @click="handleCoreReviewCommand('remove')"
                >
                  {{ coreReviewRemoveLabel }}
                </button>
              </div>
            </template>
          </CoreReviewList>
          <div v-if="coreReviewItem !== null && !sourceCode && !coreCommentOpen">
            <div class="core-review-bulk">
              <button
                type="button"
                class="button small"
                data-testid="critic-review-accept-all"
                :disabled="!reviewCommandEnabled('accept-all', coreReviewCommandState)"
                @click="handleCoreReviewCommand('accept-all')"
              >
                {{ t('editor.coreReview.acceptAll') }}
              </button>
              <button
                type="button"
                class="button small"
                data-testid="critic-review-reject-all"
                :disabled="!reviewCommandEnabled('reject-all', coreReviewCommandState)"
                @click="handleCoreReviewCommand('reject-all')"
              >
                {{ t('editor.coreReview.rejectAll') }}
              </button>
            </div>
          </div>
          <p
            v-if="
              coreLease !== undefined &&
                !sourceCode &&
                !coreReviewItem &&
                !coreReviewRefreshPending &&
                !coreCommentOpen
            "
            class="core-review-hint"
          >
            {{ t('editor.coreReview.empty') }}
          </p>
        </div>
      </section>
    </Teleport>
    <media-viewer
      ref="mediaViewer"
      @open-change="viewerOpen = $event"
    />
    <el-dialog
      v-model="dialogTableVisible"
      :show-close="isShowClose"
      :modal="true"
      append-to-body
      class="ag-insert-table-dialog"
      width="454px"
      center
      dir="ltr"
    >
      <template #title>
        <div class="dialog-title">
          {{ t('editor.insertTable.title') }}
        </div>
      </template>
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
          <el-button @click="dialogTableVisible = false">
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
    <editor-search
      v-if="!sourceCode"
      :replace-available="markupEditingAvailable"
    />
  </div>
</template>

<script setup lang="ts">
import reviewCommentIcon from '@/assets/icons/review/comment.svg?url'
import reviewHighlightIcon from '@/assets/icons/review/highlight.svg?url'
import reviewAdditionIcon from '@/assets/icons/review/addition.svg?url'
import reviewReplacementIcon from '@/assets/icons/review/replacement.svg?url'
import { reviewStatus } from './reviewStatus'
import type { MarkdownOptions } from '@marktext/document-core'
import {
  provide,
  computed,
  ref,
  shallowRef,
  toRef,
  reactive,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
  markRaw
} from 'vue'
import { useLayoutStore } from '@/store/layout'
import {
  reviewCommands,
  reviewCommandEnabled,
  type ReviewCommandState,
  type ReviewContextCommand,
  type ReviewContextRequest,
  type ReviewContextReply,
  type ReviewContextAction
} from 'common/commands/review'
import CoreReviewList from './CoreReviewList.vue'
import {
  coreReviewComposerEscapes,
  coreReviewComposerPlacement,
  createCoreReviewComposer,
  type CoreReviewComposerState
} from './coreReviewComposer'
import { coreMarkdownOptionsFromPreferences } from '@/documentAuthority/coreMarkdownPreferences'
import {
  createReviewContextSession,
  reviewContextSelection
} from '../../documentAuthority/reviewContextSelection'
import log from 'electron-log'
import isEqual from 'lodash/isEqual'
import debounce from 'lodash/debounce'
import {
  Muya,
  type IPreviewDiagramPayload,
  type IMuyaOptions,
  type IReconcileRegion,
  type DocumentInput
} from '@muyajs/core'
import { registerDesktopMuyaPlugins } from './muyaPluginRegistration'
import { getMuyaLocale } from '@/util/muyaLocale'
import {
  exportStyledHTMLFromProjection,
  type ExportStyledHtmlOptions,
  type HeaderFooterPart
} from '@/util/exportHtml'
import {
  countProjectedDocument,
  countProjectedText,
  tocEntryOf,
  searchProjectedDocument,
  tocProjectedDocument,
  type ProjectedSearchOptions
} from '@/documentConsumers/documentProjectionConsumers'
import {
  executeProjectedSearchReplacement,
  type ProjectedSearchSnapshot
} from '@/documentConsumers/projectedSearchReplacementAuthority'
import {
  installProjectedSelectionClipboardGuard,
  installUnboundDocumentGuard,
  type ProjectedSelectionClipboardOperation
} from '@/documentConsumers/projectedClipboardGuard'
import {
  createProjectedSelectionClipboardAuthority,
  type ProjectedSelectionClipboardAuthority
} from '@/documentConsumers/projectedSelectionClipboardAuthority'
import { createLatestViewRefresh } from '@/documentConsumers/latestViewRefresh'
import type { CoreRecoveryDraftInput } from '@shared/types/coreRecoveryDraft'
import {
  createProjectedSearchPresentation,
  type ProjectedSearchPresentation,
  type ProjectedSearchPresentationBlock
} from '@/documentConsumers/projectedSearchPresentation'
import EditorSearch from '../search/index.vue'
import MediaViewer from '../mediaViewer/index.vue'
import CoreReviewCommentEditor from './CoreReviewCommentEditor.vue'
import CoreDocumentProjection from './CoreDocumentProjection.vue'
import bus from '@/bus'
import { DEFAULT_EDITOR_FONT_FAMILY, DEFAULT_CODE_FONT_FAMILY } from '@/config'
import notice from '@/services/notification'
import Printer, { type PrintPreparation } from '@/services/printService'
import { SpellcheckerLanguageCommand } from '@/commands'
import { SpellChecker } from '@/spellchecker'
import { isMac, animatedScrollTo } from '@/util'
import { moveImageToFolder, normalizeImageInput, uploadImage } from '@/util/fileSystem'
import { guessClipboardFilePath } from '@/util/clipboard'
import { getCssForOptions, getHtmlToc, type PdfCssOptions, type HtmlTocOptions } from '@/util/pdf'
import {
  getTocHeadingScrollTop,
  resolveTocHeadingElement,
  TOP_LEVEL_HEADINGS_SELECTOR
} from '@/util/tocNavigation'
import { findActiveHeadingSlug, type HeadingPosition } from '@/util/findActiveHeading'
import { caretScrollTarget } from '@/util/caretScrollTarget'
import { coreHeadingToc, createCoreHeadingToc } from '@/documentAuthority/coreHeadingToc'
import { addCommonStyle, setEditorWidth } from '@/util/theme'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorStore } from '@/store/editor'
import { useProjectStore } from '@/store/project'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import {
  canToggleCoreTrackChanges,
  createCoreAuthorityPerformanceTrace,
  createCoreAuthorityPerformanceTestBridge,
  createCoreTrackChangesMode,
  createMuyaPlainTextCoreAdapter,
  type CoreTrackChangesMode,
  type CoreAppliedReply,
  type CoreAuthorForm,
  type CoreAuthorityPerformanceTrace,
  type CoreDocumentViewLease,
  type CoreReviewDecision,
  type CoreReviewItemReply,
} from '@/documentAuthority'
import {
  createMuyaMarkupPresentationIndex,
  type MuyaMarkupPresentationIndex
} from '@/documentAuthority/muyaMarkupPresentationIndex'
import { createMuyaRecoveryDraftCapture } from '@/documentAuthority/muyaRecoveryDraftCapture'
import {
  createMuyaRevisedTextReader,
  type MuyaRevisedTextReader
} from '@/documentAuthority/muyaRevisedText'
import { presentPendingClipboardImage } from '@/documentAuthority/muyaPendingClipboardImage'
import {
  muyaClipboardSelection,
  muyaClipboardInputSelection,
  muyaClipboardCurrentSelection,
  muyaClipboardToModel,
  muyaActiveFormats,
  muyaCaretStep,
  muyaLineEndStep,
  muyaBackspaceRemovesGrapheme,
  muyaCodeLanguage,
  muyaEmojiContext,
  muyaFormatToModel,
  muyaInputToModel
} from '@/documentAuthority/muyaModelSelection'
import { resolveMuyaViewAcknowledgement } from '@/documentAuthority/resolveMuyaViewAcknowledgement'
import { muyaMarkupViewPatch } from '@/documentAuthority/muyaMarkupChanges'
import {
  muyaViewBindingsInItems,
  muyaViewBindingsInRoots,
  muyaViewEditableCount,
  muyaViewFindNear,
  muyaViewItemAtPath
} from '@/documentAuthority/muyaMarkupViewLookup'
import { composeMuyaReconcileRegion } from '@/documentAuthority/muyaReconcileRegion'
import { asMuyaStates, mappedMuyaSourceRange, type MuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import {
  reconcileMuyaDocumentView,
  restoreMuyaDocumentSelection
} from '@/documentAuthority/reconcileMuyaDocumentView'
import type { DocumentSelection } from '@marktext/document-core'
import type {
  MuyaPlainTextAuthorSelection,
  MuyaPlainTextBindings,
  MuyaPlainTextCoreAdapter
} from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { installMuyaInputDelivery } from '@/documentAuthority/muyaNativeInputDelivery'

// Importing the engine entrypoint auto-injects its editor CSS (the muya.ts
// module imports its stylesheets at load time). Desktop themes still target the
// legacy `ag-*` DOM (theme migration is a separate phase), so minor visual
// differences against the new `mu-*` DOM are expected.
import '@muyajs/core'
import '@/assets/themes/codemirror/one-dark.css'
import { type InputNumberInstance } from 'element-plus'

const { t } = useI18n()
const STANDAR_Y = 320

// The engine's `selection-change` / `json-change` payload. The consumed
// `@muyajs/core` declaration does not re-export this shape, so describe the
// fields the desktop reads (each is re-cast in the body); the index signature
// keeps the boundary permissive for anything not enumerated here.
interface MuyaChange {
  anchorPath?: Array<string | number>
  focusPath?: Array<string | number>
  anchorBlock?: { text?: string } | null
  focusBlock?: { text?: string } | null
  anchorBlockInfo?: { type?: string; functionType?: string } | null
  focusBlockInfo?: { type?: string; functionType?: string } | null
  affiliation?: EngineAffiliationEntry[]
  anchor?: { offset?: number } | null
  focus?: { offset?: number } | null
  cursorCoords?: { y?: number } | null
  formats?: SelectionFormatLike[]
  [key: string]: unknown
}

const props = defineProps<{
  textDirection: string
  platform?: string
  coreLease?: CoreDocumentViewLease
  /** The current document's lease in any view; exports read it while Source view is up. */
  coreDocumentLease?: CoreDocumentViewLease
  initialDocumentSelection?: DocumentSelection
  corePlainTextView?: MuyaMarkupView
  corePerformanceTrace?: CoreAuthorityPerformanceTrace
  coreTestCrashCoreOwner?: () => void
  coreTestStaleNextTransaction?: () => void
  commentComposerState?: CoreReviewComposerState
  /** The document's Track Changes mode, which outlives this view. */
  trackChangesModeFor?: (documentId: string) => CoreTrackChangesMode
  /** True once, for the first view of a newly opened document. */
  claimFreshDocument?: (documentId: string) => boolean
}>()
const emit = defineEmits<{
  (event: 'core-fault', error: unknown): void
}>()

// Get stores
const preferencesStore = usePreferencesStore()
const editorStore = useEditorStore()
provide('core-projection-follow-link', (href: string, anchorRoot: HTMLElement) => {
  editorStore.FORMAT_LINK_CLICK({ data: { href }, dirname: window.DIRNAME, anchorRoot })
})
const projectStore = useProjectStore()

// Use storeToRefs to extract reactive properties from the stores
const {
  // Preferences
  preferLooseListItem,
  autoPairBracket,
  autoPairMarkdownSyntax,
  autoPairQuote,
  bulletListMarker,
  orderListDelimiter,
  tabSize,
  listIndentation,
  frontmatterType,
  superSubScript,
  footnote,
  texMathDollars,
  texMathGfm,
  texMathSingleBackslash,
  texMathDoubleBackslash,
  highlightSyntax,
  inlineDiff,
  multilineBlockquote,
  isHtmlEnabled,
  softNewlineAsSpace,
  lineHeight,
  fontSize,
  codeFontSize,
  codeFontFamily,
  codeBlockLineNumbers,
  trimUnnecessaryCodeBlockEmptyLines,
  editorFontFamily,
  hideQuickInsertHint,
  hideLinkPopup,
  autoCheck,
  editorLineWidth,
  wrapCodeBlocks,
  imageInsertAction,
  imagePreferRelativeDirectory,
  imageRelativeDirectoryBase,
  imageRelativeDirectoryName,
  imageFolderPath,
  theme,
  sequenceTheme,
  hideScrollbar,
  spellcheckerEnabled,
  spellcheckerNoUnderline,
  spellcheckerLanguage,
  language,

  // Edit modes
  typewriter,
  focus,
  sourceCode
} = storeToRefs(preferencesStore)

// Editor store refs
const { currentFile } = storeToRefs(editorStore)

// Project store refs
const { projectTree } = storeToRefs(projectStore)

// Component state
// The preferences store keeps `sequenceTheme` a free-form string because it is
// read back from disk; the engine accepts only its two known values.
const toSequenceTheme = (value: string): IMuyaOptions['sequenceTheme'] =>
  value as IMuyaOptions['sequenceTheme']

const defaultFontFamily = DEFAULT_EDITOR_FONT_FAMILY
const resolveEditorFont = (family: string): string =>
  family ? `${family}, ${defaultFontFamily}` : defaultFontFamily
const resolveCodeFont = (family: string): string => `${family}, ${DEFAULT_CODE_FONT_FAMILY}`
const selectionChange = ref<unknown>(null)
// `shallowRef`: the engine instance is `markRaw`d anyway, and a deep ref
// would map `Muya` through `UnwrapRef` and lose the class's own type.
const editor = shallowRef<Muya | null>(null)
provide('core-projection-muya', editor)
provide(
  'core-projection-settings',
  computed(() => ({
    theme: theme.value,
    sequenceTheme: sequenceTheme.value,
    plantumlServer: preferencesStore.plantumlServer,
    htmlEnabled: isHtmlEnabled.value
  }))
)
let corePlainTextAdapter: MuyaPlainTextCoreAdapter | undefined
// Reactive props hide the outgoing lease while a mode/tab handoff is pending.
// Its mounted adapter still owns acknowledgements until onHandoff runs.
let coreBoundLease: CoreDocumentViewLease | undefined
let latestCorePlainTextChange: unknown
let coreAuthorityPerformanceTrace: CoreAuthorityPerformanceTrace | undefined
const coreAuthorSelection = ref<MuyaPlainTextAuthorSelection>()
const coreAuthorInvocationSelection = ref<MuyaPlainTextAuthorSelection>()
// The latest document revision this view has acknowledged. Undo can restore a
// selection equal to one already seen, over a document that has changed.
const coreDocumentRevision = ref<number>()
// Review forms Core can author over the selection. Code and other literal
// contexts have none, so authoring controls stay unavailable there.
const coreAuthorForms = shallowRef<readonly CoreAuthorForm[]>([])
const reviewLayoutStore = useLayoutStore()
const coreReviewOverview = shallowRef<NonNullable<CoreReviewItemReply['overview']>>([])
const coreReviewPosition = computed(
  () =>
    coreReviewOverview.value.findIndex(
      (entry) =>
        entry.item.range.start === coreReviewItem.value?.range.start &&
        entry.item.range.end === coreReviewItem.value?.range.end
    ) + 1
)
const coreReviewItem = ref<CoreReviewItemReply['item']>(null)
const coreReviewRevision = ref<number>()
const coreReviewCommentText = ref<string>()
const coreDisplayMode = ref<'markup' | 'original' | 'revised'>('markup')
const coreDisplayProjection = shallowRef<CoreReviewItemReply['commentProjection']>()
const coreDisplayLoading = ref(false)
// Original and Revised are read-only projections. Commands addressed to the
// hidden Markup editor must not change the document behind them.
const markupEditingAvailable = computed(
  () => !sourceCode.value && coreDisplayMode.value === 'markup'
)
const coreCommentComposer = props.commentComposerState ?? reactive(createCoreReviewComposer())
const coreCommentOpen = toRef(coreCommentComposer, 'open')
const coreCommentDraft = toRef(coreCommentComposer, 'draft')
const coreCommentError = toRef(coreCommentComposer, 'error')
const coreCommentTarget = toRef(coreCommentComposer, 'target')
const coreComposerPlacement = computed(() =>
  coreReviewComposerPlacement(coreCommentTarget.value, coreReviewOverview.value)
)
const coreCommentEscapeNotice = computed(() =>
  coreReviewComposerEscapes(coreCommentComposer, coreMarkdownOptionsFromPreferences(preferencesStore))
    ? t('editor.coreReview.commentEscapeNotice')
    : ''
)
const coreReviewResolving = ref(false)
const coreReviewTargeted = ref(false)
// Counts clicks and selection gestures on annotations in the text; each asks
// the sidebar to show the selected card, as Google Docs does.
const coreReviewRevealRequest = ref(0)
// A caret the review list could not yet place, rechecked on its next publish.
let pendingCoreCaret: { readonly path: string, readonly offset: number } | undefined
const reviewToolbarIcons: Record<string, string> = {
  'add-comment': reviewCommentIcon,
  'mark-highlight': reviewHighlightIcon,
  'mark-addition': reviewAdditionIcon,
  'suggest-replacement': reviewReplacementIcon
}
const coreReviewRefreshPending = ref(false)
const coreReviewBusy = computed(() => coreReviewResolving.value || coreReviewRefreshPending.value)
const coreReviewRefresh = createLatestViewRefresh<CoreReviewItemReply>({
  pending: (value) => {
    coreReviewRefreshPending.value = value
  },
  publish: (reply) => {
    coreReviewOverview.value = reply.overview ?? []
    coreReviewItem.value = reply.item
    coreReviewRevision.value = reply.revision
    coreDocumentRevision.value = reply.revision
    coreReviewCommentText.value = reply.commentText
    nextTick(() => {
      const caret = pendingCoreCaret
      pendingCoreCaret = undefined
      const start = caret && coreItemAtCaret(caret.path, caret.offset)
      if (start !== undefined) selectCoreAnnotationAt(start, false)
      else if (coreReviewLocatedNode !== undefined) revealCoreReviewItem(false)
    })
  },
  fault: (error) => emit('core-fault', error)
})
const coreTrackChangesEnabled = ref(false)
let coreTrackChangesMode: CoreTrackChangesMode | undefined
const toggleCoreTrackChanges = (): void => {
  coreTrackChangesEnabled.value = coreTrackChangesMode?.toggle() ?? false
}
const coreEditableBindingCount = ref(0)
const coreReviewUsesRemove = computed(
  () =>
    coreReviewItem.value?.kind === 'highlight' ||
    coreReviewItem.value?.kind === 'comment' ||
    coreReviewItem.value?.kind === 'commented-span'
)
const coreReviewHasComment = computed(
  () => coreReviewItem.value?.kind === 'comment' || coreReviewItem.value?.kind === 'commented-span'
)
const coreReviewRemoveLabel = computed(() =>
  coreReviewItem.value?.kind === 'highlight'
    ? t('editor.coreReview.removeHighlight')
    : t('editor.coreReview.removeComment')
)
let uninstallCoreInputDelivery: (() => void) | undefined
let coreCompositionRoot: HTMLElement | undefined
let uninstallCoreSelectionClipboardGuard: (() => void) | undefined
let uninstallUnboundDocumentGuard: (() => void) | undefined
let coreSelectionClipboardAuthority: ProjectedSelectionClipboardAuthority | undefined
let coreSearchPresentation: ProjectedSearchPresentation | undefined
let coreConsumerInputEpoch = 0
let coreSearchProjectionEpoch = -1
let coreSearchSnapshot: ProjectedSearchSnapshot | undefined
const isShowClose = ref(false)
const dialogTableVisible = ref(false)
let tableDialogTarget:
  | {
    muya: Muya
    lease: CoreDocumentViewLease | undefined
    generation: number | undefined
    selectionId?: string
    confirming: boolean
    stopWaiting?: () => void
  }
  | undefined
const tableChecker = reactive({
  rows: 4,
  columns: 3
})

// Template refs
const editorRef = ref<HTMLDivElement | null>(null)
const mediaViewer = ref<InstanceType<typeof MediaViewer> | null>(null)
const viewerOpen = ref(false)
const editorSurfaceRef = ref<HTMLDivElement | null>(null)
const rowInput = ref<InputNumberInstance | null>(null)

// Non-reactive variables
let printer: Printer | null = null
let spellchecker: SpellChecker | null = null
let switchLanguageCommand: SpellcheckerLanguageCommand | null = null
// The engine has no `scroll` event; we listen on the scroll container directly.
let scrollHandler: ((e: Event) => void) | null = null
interface SelectionFormatLike {
  type: string
  [key: string]: unknown
}

// Container `blockName` → legacy `functionType`. The engine's affiliation
// entries carry `blockName` but not the legacy `functionType` the desktop
// menu-state builder keys off for `pre`/`figure` containers (table detection +
// Format-menu disable). Re-derive it here so `createApplicationMenuState`'s
// existing `pre`/`figure` branches fire. The `code$` / `multiplemath` /
// `frontmatter` / `html` / `table` values match the legacy muyajs vocabulary
// (`createApplicationMenuState`'s `/frontmatter|html|multiplemath|code$/` test
// and `=== 'table'` check).
const CONTAINER_FUNCTION_TYPE: Record<string, string> = {
  'code-block': 'fencecode',
  frontmatter: 'frontmatter',
  table: 'table',
  'html-block': 'html',
  'math-block': 'multiplemath',
  diagram: 'diagram'
}

interface EngineAffiliationEntry {
  type: string
  blockName: string
  listType?: string
  listItemType?: string
  isLooseListItem?: boolean
  [key: string]: unknown
}

// The engine's `selection-change` payload (since #4410) carries an
// `affiliation` chain (shared-ancestor paragraph-type blocks, outermost-first)
// plus per-endpoint `anchorBlockInfo`/`focusBlockInfo` describing the content
// leaf (`type: 'span'` + `functionType`), alongside the live `anchorBlock`/
// `focusBlock` refs (which carry `.text`). The desktop's application-menu state
// builder (`createApplicationMenuState`) and the selected-text derivation in
// `SELECTION_CHANGE` were written against the legacy `{ start, end, affiliation }`
// shape, so map the new payload onto it:
//   - `start.type`/`end.type` from the leaf info (`'span'`) so the
//     `start.type === 'span'` guards fire,
//   - `start.block.functionType`/`end.block.functionType` from the leaf info so
//     code-content / table-cell detection lights up,
//   - `start.block.text`/`end.block.text` from the live block so the store can
//     still slice the selected text (`SELECTION_CHANGE` → search prefill),
//   - `affiliation` straight through (entries already carry `type` +
//     `listType`/`listItemType`/`isLooseListItem`), surfacing a derived
//     `functionType` on `pre`/`figure` containers for table / code-fence keys.
const adaptSelectionChange = (changes: MuyaChange) => {
  const anchorPath = (changes.anchorPath ?? []) as Array<string | number>
  const focusPath = (changes.focusPath ?? anchorPath) as Array<string | number>
  const anchorBlock = changes.anchorBlock as { text?: string } | null | undefined
  const focusBlock = changes.focusBlock as { text?: string } | null | undefined
  const anchorInfo = changes.anchorBlockInfo as
    | { type?: string; functionType?: string }
    | null
    | undefined
  const focusInfo = changes.focusBlockInfo as
    | { type?: string; functionType?: string }
    | null
    | undefined
  const rawAffiliation = (changes.affiliation ?? []) as EngineAffiliationEntry[]
  const affiliation = rawAffiliation.map((entry) => {
    const functionType =
      entry.type === 'pre' || entry.type === 'figure'
        ? CONTAINER_FUNCTION_TYPE[entry.blockName]
        : undefined
    return functionType ? { ...entry, functionType } : entry
  })
  return {
    start: {
      key: anchorPath.join('/'),
      offset: (changes.anchor?.offset ?? 0) as number,
      block: { text: anchorBlock?.text, functionType: anchorInfo?.functionType },
      type: anchorInfo?.type
    },
    end: {
      key: focusPath.join('/'),
      offset: (changes.focus?.offset ?? 0) as number,
      block: { text: focusBlock?.text, functionType: focusInfo?.functionType },
      type: focusInfo?.type
    },
    affiliation
  }
}

// The engine reports only committed selections, so recounting per notification
// is cheap; a caret reports no text and stops here. The count covers what
// Revised shows of the selection, read from Core's acknowledged view. A block
// that view does not hold with this text keeps the text Core's state gave it.
const updateSelectionWordCount = (muya: Muya) => {
  const read = coreRevisedText
  const selectedText = muya.getSelectedText(
    (block, start, end) =>
      read?.(block.path, block.text, start, end) ?? block.text.slice(start, end)
  )
  const hasSelection = selectedText.trim().length > 0
  if (!hasSelection && editorStore.selectionWordCount == null) return

  editorStore.SET_SELECTION_WORD_COUNT(hasSelection ? countProjectedText(selectedText) : null)
}

// Build a JSON-serializable cursor from the engine selection (drop the live
// block references so it survives the buffered-state round-trip). `setCursor`
// re-resolves the target blocks from `anchorPath`/`focusPath`.
const serializeCursor = (
  selection: {
    anchor?: { offset: number; path?: Array<string | number> }
    focus?: { offset: number; path?: Array<string | number> }
  } | null
) => {
  if (!selection) return null
  return {
    anchor: selection.anchor ? { offset: selection.anchor.offset } : null,
    focus: selection.focus ? { offset: selection.focus.offset } : null,
    anchorPath: selection.anchor?.path,
    focusPath: selection.focus?.path
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

// In source-code mode and the read-only reader views the Paragraph and Format
// menus would operate on the hidden WYSIWYG engine, so grey them out. On return
// to the Markup editor, re-apply the menu
// state for the CURRENT cursor context (a code block/table still disables some
// items) rather than blanket-enabling everything (#3531).
watch(markupEditingAvailable, (available) => {
  const windowId = window.marktext?.env?.windowId ?? -1
  if (!available) {
    window.electron.ipcRenderer.send('mt::set-editor-format-menus-enabled', windowId, false)
    return
  }
  nextTick(() => {
    if (selectionChange.value) {
      pushSelectionMenuState(selectionChange.value as MuyaChange)
    } else {
      window.electron.ipcRenderer.send('mt::set-editor-format-menus-enabled', windowId, true)
    }
  })
})

// nextTick: the rebuilt headings have to be in the DOM before we pair them up.
watch(
  () => editorStore.listToc,
  () => {
    nextTick(rebuildHeadingCache)
  }
)

watch(fontSize, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ fontSize: value })
  }
})

watch(lineHeight, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ lineHeight: value })
  }
})

watch(editorFontFamily, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ editorFontFamily: resolveEditorFont(value) })
  }
})

watch(preferLooseListItem, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({
      preferLooseListItem: value
    })
  }
})

watch(tabSize, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ tabSize: value })
  }
})

watch(theme, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    // Agreement：Any black series theme needs to contain dark `word`.
    if (/dark/i.test(value)) {
      editor.value.setOptions(
        {
          mermaidTheme: 'dark',
          vegaTheme: 'dark'
        },
        true
      )
    } else {
      editor.value.setOptions(
        {
          mermaidTheme: 'default',
          vegaTheme: 'latimes'
        },
        true
      )
    }
  }
})

watch(sequenceTheme, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ sequenceTheme: toSequenceTheme(value) }, true)
  }
})

watch(
  () => preferencesStore.plantumlServer,
  (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      editor.value.setOptions({ plantumlServer: value }, true)
    }
  }
)

watch(listIndentation, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setListIndentation(value)
  }
})

watch(frontmatterType, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ frontmatterType: value })
  }
})

watch(isHtmlEnabled, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ disableHtml: !value }, true)
  }
})

watch(softNewlineAsSpace, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ softNewlineAsSpace: value }, true)
  }
})

watch(hideQuickInsertHint, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ hideQuickInsertHint: value })
  }
})

watch(editorLineWidth, (value, oldValue) => {
  if (value !== oldValue) {
    setEditorWidth(value)
  }
})

watch(wrapCodeBlocks, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ wrapCodeBlocks: value })
  }
})

watch(autoPairBracket, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ autoPairBracket: value })
  }
})

watch(autoPairMarkdownSyntax, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ autoPairMarkdownSyntax: value })
  }
})

watch(autoPairQuote, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ autoPairQuote: value })
  }
})

watch(trimUnnecessaryCodeBlockEmptyLines, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ trimUnnecessaryCodeBlockEmptyLines: value })
  }
})

watch(bulletListMarker, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ bulletListMarker: value })
  }
})

watch(orderListDelimiter, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ orderListDelimiter: value })
  }
})

watch(hideLinkPopup, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ hideLinkPopup: value })
  }
})

watch(autoCheck, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ autoCheck: value })
  }
})

watch(codeFontSize, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ codeFontSize: value })
    // Source-mode CodeMirror is a separate surface muya doesn't own.
    addCommonStyle({
      codeFontSize: value,
      codeFontFamily: codeFontFamily.value,
      hideScrollbar: hideScrollbar.value
    })
  }
})

watch(codeBlockLineNumbers, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ codeBlockLineNumbers: value }, true)
  }
})

watch(codeFontFamily, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ codeFontFamily: resolveCodeFont(value) })
    // Source-mode CodeMirror is a separate surface muya doesn't own.
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
  if (value === oldValue) return

  // Set Muya's spellcheck container attribute.
  editor.value?.setOptions({ spellcheckEnabled: value })

  // Disable native spell checker
  if (value) {
    spellchecker?.activateSpellchecker(spellcheckerLanguage.value)
  } else {
    spellchecker?.deactivateSpellchecker()
  }
})

watch(spellcheckerNoUnderline, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    // Hide only the spelling squiggle; the native checker (and its right-click
    // suggestions) stays controlled by `spellcheckerEnabled`.
    editor.value.setOptions({ spellcheckHideMarks: value })
  }
})

watch(spellcheckerLanguage, (value, oldValue) => {
  if (value !== oldValue && spellchecker) {
    spellchecker.lang = value
  }
})

watch(currentFile, (value, oldValue) => {
  if (value && value !== oldValue) {
    scrollToCursor(0)
    // Hide float tools if needed.
    if (editor.value) {
      editor.value.hideAllFloatTools()
    }
    // The viewer holds a node from the outgoing document, and keeps the
    // incoming one at `pointer-events: none` while it is up.
    mediaViewer.value?.close()
  }
})

watch(
  sourceCode,
  (value, oldValue) => {
    // The viewer holds a rendering of a document that is about to stop being
    // shown, and holds the editor behind it inert while it is up.
    if (value && value !== oldValue) mediaViewer.value?.close()
  },
  { flush: 'sync' }
)

// Methods
// muya types the callback as (linkInfo: ILinkInfo | null) and href itself can
// be null when the rendered link has no usable href (see issue #4356).
const jumpClick = (linkInfo: { href?: string | null } | null) => {
  if (!linkInfo) return
  const { href } = linkInfo
  editorStore.FORMAT_LINK_CLICK({ data: { href: href ?? null }, dirname: window.DIRNAME })
}

interface ImagePathSuggestion {
  type: 'directory' | 'file' | string
  file: string
  [key: string]: unknown
}

const imagePathAutoComplete = async (src: string) => {
  const files = (await editorStore.ASK_FOR_IMAGE_AUTO_PATH(src)) as unknown as ImagePathSuggestion[]
  return files.map((f) => {
    const iconClass = f.type === 'directory' ? 'icon-folder' : 'icon-image'
    return Object.assign(f, { iconClass, text: f.file + (f.type === 'directory' ? '/' : '') })
  })
}

const imageAction = async (image: string | File): Promise<string> => {
  // TODO(Refactor): Refactor this method.
  if (!currentFile.value) return ''
  const { filename, pathname: currentPathname } = currentFile.value
  image = normalizeImageInput(image)

  // Figure out the current working directory.
  // Save an image relative to the file, otherwise use the project root when available.
  const isTabSavedOnDisk = !!currentPathname
  let relativeBasePath: string | null = isTabSavedOnDisk
    ? window.path.dirname(currentPathname)
    : null
  if (isTabSavedOnDisk && imageRelativeDirectoryBase.value !== 'file' && projectTree.value) {
    const { pathname: rootPath } = projectTree.value as { pathname?: string }
    if (rootPath && window.fileUtils.isChildOfDirectory(rootPath, currentPathname)) {
      // Save assets relative to root directory.
      relativeBasePath = rootPath
    }
  }

  const getResolvedImagePath = (imagePath: string) => {
    const replacement = isTabSavedOnDisk
      ? filename.replace(/\.[^/.]+$/, '') // Filename w/o extension
      : ''
    return imagePath.replace(/\${filename}/g, replacement)
  }

  const resolvedGlobalImageFolderPath = getResolvedImagePath(imageFolderPath.value)
  const resolvedImageRelativeDirectoryName = getResolvedImagePath(imageRelativeDirectoryName.value) // assets/
  const resolvedImageRelativeFullDirectoryPath = relativeBasePath
    ? window.path.join(relativeBasePath, resolvedImageRelativeDirectoryName)
    : null // /root/dir/assets
  let destImagePath = ''
  switch (imageInsertAction.value) {
    case 'upload': {
      try {
        // Pass the full preferences state object to avoid dereferencing non-existent .value
        destImagePath = (await uploadImage(
          currentPathname,
          image,
          preferencesStore.$state as unknown as import('@/util/fileSystem').UploadImagePreferences
        )) as string
      } catch (err) {
        notice.notify({
          title: 'Upload Image',
          type: 'warning',
          message: err as string
        })
        destImagePath = (await moveImageToFolder(
          currentPathname,
          image,
          resolvedGlobalImageFolderPath
        )) as string
      }
      break
    }
    case 'folder': {
      if (isTabSavedOnDisk && imagePreferRelativeDirectory.value) {
        // `image` may be a path string (paste/drag/image-selector) — pass
        // `currentPathname` so moveImageToFolder can resolve relative paths
        // via `path.dirname(pathname)` instead of crashing on `dirname(null)`.
        destImagePath = (await moveImageToFolder(
          currentPathname,
          image,
          resolvedImageRelativeFullDirectoryPath as string,
          true,
          currentPathname
        )) as string
      } else {
        destImagePath = (await moveImageToFolder(
          currentPathname,
          image,
          resolvedGlobalImageFolderPath
        )) as string
      }
      break
    }
    case 'path': {
      if (typeof image === 'string') {
        // Input is a local path.
        destImagePath = image
      } else {
        // Save and move image to image folder if input is binary.

        // Respect user preferences if tab exists on disk.
        if (isTabSavedOnDisk && imagePreferRelativeDirectory.value) {
          destImagePath = (await moveImageToFolder(
            null as unknown as string,
            image,
            resolvedImageRelativeFullDirectoryPath as string,
            true,
            currentPathname
          )) as string
        } else {
          destImagePath = (await moveImageToFolder(
            currentPathname,
            image,
            resolvedGlobalImageFolderPath
          )) as string
        }
      }
      break
    }
  }

  return destImagePath
}

// Adapt the engine's `imageAction` contract (`{ src, alt, title }`) to the
// desktop's `imageAction(image)`; the engine keeps the alt text and title.
const muyaImageAction = (state: { src: string; alt?: string; title?: string }): Promise<string> =>
  imageAction(state.src)

const imagePathPicker = () => {
  return editorStore.ASK_FOR_IMAGE_PATH()
}

// Growing a selection across blocks fires no `selection-change`.
// TODO(Selection): drop this and its `keyup` branch once the engine reports it.
const SELECTION_KEYS = new Set([
  'Shift',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown'
])

const keyup = (event: KeyboardEvent) => {
  if (!sourceCode.value && editor.value && SELECTION_KEYS.has(event.key)) {
    updateSelectionWordCount(editor.value)
  }
}

const switchSpellcheckLanguage = (languageCode: unknown) => {
  // This method is also called from bus, so validate state before continuing.
  if (!spellchecker?.isEnabled) {
    throw new Error(t('editor.spellcheck.disabledError'))
  }

  const lang = languageCode as string

  spellchecker
    .switchLanguage(lang)
    .then((switched: boolean) => {
      if (!switched) {
        // Unable to switch language due to missing dictionary. The spell checker is now in an invalid state.
        notice.notify({
          title: t('editor.spellcheck.title'),
          type: 'warning',
          message: t('editor.spellcheck.languageMissing', { languageCode: lang })
        })
      }
    })
    .catch((error: unknown) => {
      log.error(t('editor.spellcheck.errorSwitchingLanguage', { languageCode: lang }))
      log.error(error)

      const errMsg = (error as { message?: string } | null | undefined)?.message ?? String(error)
      notice.notify({
        title: t('editor.spellcheck.title'),
        type: 'error',
        message: t('editor.spellcheck.switchError', {
          languageCode: lang,
          error: errMsg
        })
      })
    })
}

const handleInvalidateImageCache = () => {
  if (editor.value) {
    editor.value.invalidateImageCache()
  }
}

const openSpellcheckerLanguageCommand = () => {
  if (!isMac) {
    bus.emit('show-command-palette', switchLanguageCommand)
  }
}

const replaceMisspelling = (payload: unknown) => {
  const { word, replacement } = payload as { word: string; replacement: string }
  if (markupEditingAvailable.value && editor.value) {
    editor.value.replaceCurrentWordInlineUnsafe(word, replacement)
  }
}

const applyCorePlainTextEditability = (
  view: MuyaMarkupView,
  roots?: readonly [number, number],
  items?: readonly [number, number]
): void => {
  const muya = editor.value
  coreEditableBindingCount.value = muyaViewEditableCount(view)
  if (muya === null) return
  muya.setEditablePaths(
    (scope, itemScope) =>
      (scope === undefined
        ? view.bindings
        : itemScope === undefined
          ? muyaViewBindingsInRoots(view, scope[0], scope[1])
          : muyaViewBindingsInItems(view, scope[0], itemScope[0], itemScope[1]))
        .filter((binding) => binding.editable !== false)
        .map((binding) => binding.path),
    roots,
    items
  )
}

let coreMarkupPresentation: MuyaMarkupPresentationIndex | undefined
let coreAcknowledgedMarkupView: MuyaMarkupView | undefined
let coreRevisedText: MuyaRevisedTextReader | undefined
/** The acknowledged view's binding at a JSON-serialized path. */
const coreMarkupBindingAt = (key: string): MuyaMarkupView['bindings'][number] | undefined => {
  const view = coreAcknowledgedMarkupView
  return view === undefined ? undefined : muyaViewItemAtPath(view, 'bindings', JSON.parse(key))
}
/**
 * Roots of the presented document that views acknowledged since Muya last
 * reconciled have replaced; the rest already present the latest view.
 * Undefined when that is unknown, which reconciles every root.
 */
let coreMuyaReconcileRegion: IReconcileRegion | undefined
/** Whether acknowledged views wait for Muya to reconcile them; the region then describes them all. */
let coreMuyaReconcilePending = false
let coreAcknowledgedViewRevision = props.coreLease?.identity.revision
const coreMarkupDirtyPaths = new Map<string, readonly (string | number)[]>()
let coreDraftFrozen = false
let coreRecoveryDraftCapture: ReturnType<typeof createMuyaRecoveryDraftCapture> | undefined
const captureRecoveryDraft = (error: unknown): CoreRecoveryDraftInput | undefined => {
  coreDraftFrozen = true
  return coreRecoveryDraftCapture?.(error)
}

const invalidateCoreInputConsumers = (): void => {
  coreReviewRefresh.invalidate()
  refreshCorePassiveConsumers()
  coreConsumerInputEpoch += 1
  coreSearchProjectionEpoch = -1
  coreSearchSnapshot = undefined
  coreSearchPresentation?.clear()
  coreSelectionClipboardAuthority?.reset()
}

// Rejected operations preserve the attempted work through the existing recovery owner.
const observeCoreInput = (
  adapter: MuyaPlainTextCoreAdapter,
  result: 'accepted' | 'unsupported',
  tracked: boolean,
  input: unknown
): void => {
  latestCorePlainTextChange = Object.freeze({
    result,
    tracked,
    state: adapter.state(),
    change: structuredClone(input)
  })
  if (result === 'unsupported') {
    emit('core-fault', new Error('Core Muya operation requires reconciliation'))
    return
  }
  adapter.settled().catch((error) => {
    if (corePlainTextAdapter === adapter && adapter.state().status === 'faulted') {
      emit('core-fault', error)
    }
  })
}
const configureCorePreferences = async (
  options: Readonly<Partial<MarkdownOptions>>
): Promise<void> => {
  const adapter = corePlainTextAdapter
  const lease = coreBoundLease
  if (!adapter || !lease || !editor.value) throw new Error('Core preference view is unavailable')
  editor.value.flush()
  const outcome = await adapter.configure(options, (applied) => {
    // The actor has accepted the interpretation. Update presentation options
    // without asking Muya to reparse its flattened pending source.
    editor.value?.setOptions({
      superSubScript: options.subscriptAndSuperscript,
      footnote: options.footnotes,
      texMathDollars: options.texMathDollars,
      texMathGfm: options.texMathGfm,
      texMathSingleBackslash: options.texMathSingleBackslash,
      texMathDoubleBackslash: options.texMathDoubleBackslash
    })
    return reconcileCoreHistoryView(applied)
  })
  if (outcome === undefined) throw new Error('Core preferences were not applied')
}
const captureDocumentSelection = (): DocumentSelection | undefined =>
  editor.value && coreAcknowledgedMarkupView
    ? muyaClipboardCurrentSelection(editor.value, coreAcknowledgedMarkupView)
    : undefined
const assertCloseAllowed = (): void => {
  if (corePlainTextAdapter?.isComposing()) {
    throw new Error('Finish text composition before closing the window')
  }
}
defineExpose({
  captureRecoveryDraft,
  configureCorePreferences,
  assertCloseAllowed,
  captureDocumentSelection
})
const installCoreMarkupPresentation = (muya: Muya, view: MuyaMarkupView): void => {
  const previousView = coreAcknowledgedMarkupView
  const patch = muyaMarkupViewPatch(view)
  const regional = patch !== undefined && patch.previous === previousView
  coreAcknowledgedMarkupView = view
  coreRevisedText = createMuyaRevisedTextReader(view)
  coreMarkupPresentation = createMuyaMarkupPresentationIndex(
    view,
    coreMarkupPresentation,
    undefined,
    t('editor.coreReview.commentPrompt'),
    regional ? patch : undefined
  )
  if (regional && patch.nextEnd !== patch.previousEnd && coreMarkupDirtyPaths.size > 0) {
    // Paths still waiting to render follow their roots past the replaced ones.
    const shifted = [...coreMarkupDirtyPaths.values()].flatMap((path) => {
      const root = path[0]
      if (typeof root !== 'number' || root < patch.start) return [path]
      if (root < patch.previousEnd) return []
      return [[root + patch.nextEnd - patch.previousEnd, ...path.slice(1)]]
    })
    coreMarkupDirtyPaths.clear()
    for (const path of shifted) coreMarkupDirtyPaths.set(JSON.stringify(path), path)
  }
  for (const path of coreMarkupPresentation.changedPaths) {
    coreMarkupDirtyPaths.set(JSON.stringify(path), path)
  }
  muya.setInlinePresentation(coreMarkupPresentation.render)
}

const reconcileCoreHistoryView = (outcome: CoreAppliedReply): MuyaPlainTextBindings => {
  if (coreDraftFrozen) return coreAcknowledgedMarkupView ?? props.corePlainTextView ?? []
  const previousView = coreAcknowledgedMarkupView
  const { view, muya } = resolveMuyaViewAcknowledgement({
    lease: coreBoundLease,
    outcome,
    previousView,
    previousRevision: coreAcknowledgedViewRevision,
    currentEditor: () => editor.value
  })
  if (coreDraftFrozen) return view
  coreAcknowledgedViewRevision = outcome.revision
  coreDocumentRevision.value = outcome.revision
  if (muya === null) {
    coreAcknowledgedMarkupView = view
    coreMuyaReconcileRegion = undefined
    coreMuyaReconcilePending = true
    return view
  }
  const patch = muyaMarkupViewPatch(view)
  // The same view, as after an input that only moves the selection, replaces
  // no root, so presenting it again only places the selection.
  const change =
    view === previousView
      ? { start: 0, previousEnd: 0, nextEnd: 0 }
      : patch !== undefined && patch.previous === previousView
        ? { start: patch.start, previousEnd: patch.previousEnd, nextEnd: patch.nextEnd, ...(patch.items === undefined ? {} : { items: patch.items }) }
        : undefined
  if (!coreMuyaReconcilePending) coreMuyaReconcileRegion = change
  else if (view !== previousView) {
    coreMuyaReconcileRegion =
      change === undefined || coreMuyaReconcileRegion === undefined
        ? undefined
        : composeMuyaReconcileRegion(coreMuyaReconcileRegion, change)
  }
  coreMuyaReconcilePending = true
  if (view !== previousView) installCoreMarkupPresentation(muya, view)
  // Native input may still be waiting for Muya's animation-frame batch. Admit
  // that draft before deciding whether the acknowledged view can replace DOM.
  muya.flush()
  // Later native input is already visible. Its queued operation will be mapped
  // against these acknowledged bindings before the final draft is reconciled.
  if (corePlainTextAdapter?.hasPendingEdits()) return view
  reconcileMuyaDocumentView({
    muya,
    view,
    outcome,
    dirtyPaths: coreMarkupDirtyPaths.values(),
    applyEditability: applyCorePlainTextEditability,
    region: coreMuyaReconcileRegion
  })
  coreMarkupDirtyPaths.clear()
  coreMuyaReconcilePending = false
  coreMuyaReconcileRegion = undefined
  return view
}

/** Reconciles a preparation's outcome only while `lease` still owns this view. */
const reconcileWhileLeased =
  (lease: typeof props.coreLease, preparation: string) =>
    (outcome: CoreAppliedReply): MuyaPlainTextBindings => {
      if (props.coreLease !== lease) {
        throw new Error(`${preparation} view lease changed during preparation`)
      }
      return reconcileCoreHistoryView(outcome)
    }

const showCoreProjection = async (mode: 'markup' | 'original' | 'revised'): Promise<void> => {
  if (coreDisplayLoading.value || props.coreLease === undefined) return
  if (mode === 'markup') {
    coreDisplayMode.value = mode
    return
  }
  coreDisplayLoading.value = true
  clearCoreReviewTarget()
  try {
    await corePlainTextAdapter?.settled()
    coreDisplayProjection.value = await props.coreLease.displayProjectionAtBarrier(mode)
    coreDisplayMode.value = mode
  } catch (error) {
    emit('core-fault', error)
  } finally {
    coreDisplayLoading.value = false
  }
}

const refreshCoreReviewItem = async (
  direction: 'next' | 'previous',
  from: number | (() => number),
  passive = false
): Promise<void> => {
  const adapter = corePlainTextAdapter
  const lease = coreBoundLease
  if (adapter === undefined || lease === undefined) return
  await coreReviewRefresh.request(
    async (current) => {
      await adapter.settled()
      if (!current()) return undefined
      const anchor = typeof from === 'function' ? from() : from
      let reply = await lease.binding.reviewItemAtBarrier(direction, anchor, true)
      if (!current()) return undefined
      if (reply.type !== 'review-item') {
        throw new Error('Core Review navigation became stale')
      }
      if (reply.item === null) {
        const wrappedFrom = direction === 'next' ? 0 : reply.sourceLength
        if (wrappedFrom !== anchor) {
          reply = await lease.binding.reviewItemAtBarrier(direction, wrappedFrom, true)
          if (!current()) return undefined
          if (reply.type !== 'review-item') {
            throw new Error('Core Review navigation became stale')
          }
        }
      }
      return reply
    },
    { passive }
  )
}

watch(
  () => [reviewLayoutStore.showSideBar, reviewLayoutStore.rightColumn],
  () => {
    // Opening Review is deliberate: it reveals, and so targets, the current item.
    if (reviewLayoutStore.showSideBar && reviewLayoutStore.rightColumn === 'review') {
      nextTick(() => revealCoreReviewItem())
    }
  }
)
let coreReviewLocatedNode: HTMLElement | undefined
const clearCoreReviewTarget = (): void => {
  pendingCoreCaret = undefined
  coreReviewTargeted.value = false
  coreReviewLocatedNode?.classList.remove('core-review-current-block')
  coreReviewLocatedNode = undefined
}
/** The element that shows the current review item in the Markup view. */
const coreReviewItemNode = (): HTMLElement | undefined => {
  const item = coreReviewItem.value
  const view = coreAcknowledgedMarkupView
  if (!item || !view || coreDisplayMode.value !== 'markup') return undefined
  const range = item.kind === 'commented-span' ? item.highlightRange : item.range
  const comment = muyaViewFindNear(
    view,
    'comments',
    range.start,
    range.start,
    (anchor) => anchor.annotationRange.start === range.start
  )
  const binding = muyaViewFindNear(
    view,
    'bindings',
    range.start,
    range.end,
    (binding) => binding.sourceRange.start < range.end && binding.sourceRange.end > range.start
  )
  const path = comment?.path ?? binding?.path
  const block: HTMLElement | undefined =
    (path && editor.value?.editor.scrollPage?.queryBlock([...path])?.domNode) ?? undefined
  const origin = binding?.sourceRange.start ?? 0
  return (
    block?.querySelector<HTMLElement>(
      `[data-critic-start="${range.start - origin}"][data-critic-end="${range.end - origin}"]`
    ) ?? block
  )
}
const revealCoreReviewItem = (scroll = true): void => {
  const node = coreReviewItemNode()
  // A class change restyles everything inside the element, which in a long
  // code block is thousands of tokens, so the node keeping the item keeps it.
  if (node !== coreReviewLocatedNode) coreReviewLocatedNode?.classList.remove('core-review-current-block')
  coreReviewLocatedNode = node
  if (!node) return
  coreReviewTargeted.value = true
  if (!node.classList.contains('core-review-current-block')) node.classList.add('core-review-current-block')
  if (scroll) node.scrollIntoView({ block: 'center', behavior: 'instant' })
}
/** The source position of the Markup caret, or of a selection's focus. */
const coreCaretSource = (): number | undefined => {
  const focus = editor.value?.getSelection()?.focus
  const view = coreAcknowledgedMarkupView
  const binding = focus && view && muyaViewItemAtPath(view, 'bindings', focus.path)
  if (!focus || !binding) return undefined
  return mappedMuyaSourceRange(binding, {
    start: Math.min(focus.offset, binding.text.length),
    end: Math.min(focus.offset, binding.text.length)
  })?.start
}
/**
 * As Google Docs does, put the caret at the start of the current item with
 * keyboard focus in the document, so typing continues there.
 */
const placeCaretAtCoreReviewItem = (): void => {
  const item = coreReviewItem.value
  const muya = editor.value
  const view = coreAcknowledgedMarkupView
  if (!item || !muya || !view || coreDisplayMode.value !== 'markup') return
  restoreMuyaDocumentSelection(
    muya,
    view,
    { ranges: [{ anchor: item.range.start, focus: item.range.start }], primary: 0 },
    { projectSource: true }
  )
  muya.focus()
}
const navigateCoreReview = async (direction: 'next' | 'previous'): Promise<void> => {
  const item = coreReviewItem.value
  if (!item) return
  pendingCoreCaret = undefined
  // From a caret away from the current item, move to the item after or before it.
  const from = coreReviewTargeted.value
    ? undefined
    : coreDisplayMode.value === 'markup'
      ? coreCaretSource()
      : undefined
  if (coreDisplayMode.value !== 'markup') await showCoreProjection('markup')
  await refreshCoreReviewItem(
    direction,
    from ?? (direction === 'next' ? item.range.end : item.range.start)
  )
  revealCoreReviewItem()
  placeCaretAtCoreReviewItem()
}
const selectCoreReviewEntry = async (start: number): Promise<void> => {
  // A visible entry remains navigable during a view read. Its new request must
  // supersede pending caret-follow reads, rather than silently dropping the click.
  if (coreCommentOpen.value || coreReviewResolving.value) return
  pendingCoreCaret = undefined
  reviewLayoutStore.SET_LAYOUT({ showSideBar: true, rightColumn: 'review' })
  if (coreDisplayMode.value !== 'markup') await showCoreProjection('markup')
  await refreshCoreReviewItem('next', start)
  revealCoreReviewItem()
}

// Interpret only Core-rendered annotation coordinates, never document text.
const selectCoreDocumentAnnotation = (event: MouseEvent | KeyboardEvent): void => {
  const element =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-critic-start]')
      : null
  const view = coreAcknowledgedMarkupView
  if (!element || !view || coreCommentOpen.value || coreReviewResolving.value) return
  const binding = view.bindings.find((binding) =>
    editor.value?.editor.scrollPage?.queryBlock([...binding.path])?.domNode?.contains(element)
  )
  if (!binding) return
  const start = binding.sourceRange.start + Number(element.dataset.criticStart)
  // ADR 0004: a pointer hit only selects the entry; keyboard activation of the
  // comment marker is a deliberate request to open Review.
  selectCoreAnnotationAt(start, event instanceof KeyboardEvent, true)
}
/** The review item whose source range holds the caret, bounds included. */
const coreItemAtCaret = (path: string, offset: number): number | undefined => {
  const binding = coreMarkupBindingAt(path)
  if (!binding) return undefined
  // Muya places a caret past its block's text at the text's end.
  const at = Math.min(offset, binding.text.length)
  const position = mappedMuyaSourceRange(binding, { start: at, end: at })?.start
  if (position === undefined) return undefined
  return coreReviewOverview.value.find(
    (entry) => entry.item.range.start <= position && position <= entry.item.range.end
  )?.item.range.start
}
const selectCoreAnnotationAt = (start: number, open: boolean, gesture = false): void => {
  if (coreCommentOpen.value || coreReviewResolving.value) return
  if (open) reviewLayoutStore.SET_LAYOUT({ showSideBar: true, rightColumn: 'review' })
  const current = coreReviewItem.value
  if (
    current?.range.start === start ||
    (current?.kind === 'commented-span' && current.commentRange.start === start)
  ) {
    revealCoreReviewItem(false)
    if (gesture) coreReviewRevealRequest.value += 1
    return
  }
  const entry = coreReviewOverview.value.find(
    (entry) =>
      entry.item.range.start === start ||
      (entry.item.kind === 'commented-span' && entry.item.commentRange.start === start)
  )
  if (!entry) return
  refreshCoreReviewItem('next', entry.item.range.start)
    .then(() => {
      revealCoreReviewItem(false)
      if (gesture) coreReviewRevealRequest.value += 1
    })
    .catch((error) => emit('core-fault', error))
}

const preserveCoreCommentCaret = (event: MouseEvent): void => {
  if (event.target instanceof Element && event.target.closest('.mu-critic-comment-marker')) {
    event.preventDefault()
  }
}
const activateCoreCommentMarker = (event: KeyboardEvent): void => {
  if (
    (event.key === 'Enter' || event.key === ' ') &&
    event.target instanceof Element &&
    event.target.closest('.mu-critic-comment-marker')
  ) {
    event.preventDefault()
    event.stopPropagation()
    selectCoreDocumentAnnotation(event)
  }
}

const editCoreReviewComment = async (): Promise<void> => {
  const adapter = corePlainTextAdapter
  const item = coreReviewItem.value
  const authoredRevision = coreReviewRevision.value
  if (
    adapter === undefined ||
    item === null ||
    authoredRevision === undefined ||
    !coreReviewHasComment.value ||
    coreReviewResolving.value
  ) {
    return
  }
  if (coreCommentOpen.value) return
  coreCommentTarget.value = {
    id: `edit:${authoredRevision}:${item.range.start}:${item.range.end}`,
    revision: authoredRevision,
    text: coreReviewCommentText.value ?? '',
    item,
    entry: item
  }
  coreCommentError.value = ''
  coreCommentOpen.value = true
  reviewLayoutStore.SET_LAYOUT({ showSideBar: true, rightColumn: 'review' })
}

let coreCommentFocusPending = false
const restoreCoreCommentFocus = (): void => {
  if (!ownsCurrentDocument()) return
  // Submission closes the composer before its acknowledged review refresh finishes.
  // Focus only once the restored controls are enabled.
  if (coreReviewResolving.value) {
    coreCommentFocusPending = true
    return
  }
  coreCommentFocusPending = false
  if (coreCommentTarget.value?.item) {
    document
      .querySelector<HTMLButtonElement>('#core-review-panel .core-review-entry.active > button')
      ?.focus()
  } else editor.value?.focus()
}

watch(coreReviewResolving, (busy) => {
  if (!busy && coreCommentFocusPending) nextTick(restoreCoreCommentFocus)
})

const submitCoreComment = async (draft: { targetId: string; text: string }): Promise<void> => {
  const adapter = corePlainTextAdapter
  const target = coreCommentTarget.value
  if (
    adapter === undefined ||
    target === undefined ||
    target.id !== draft.targetId ||
    coreReviewResolving.value
  ) {
    return
  }
  coreReviewResolving.value = true
  coreCommentError.value = ''
  try {
    await adapter.settled()
    const state = adapter.state()
    if (!('revision' in state) || state.revision !== target.revision) {
      coreCommentError.value = t('editor.coreReview.commentTargetChanged')
      return
    }
    const outcome =
      target.item !== undefined
        ? await adapter.editComment(
          target.item,
          target.revision,
          draft.text,
          reconcileCoreHistoryView,
          coreCommandSelection()
        )
        : target.selection !== undefined
          ? await adapter.author(
            target.form ?? 'comment',
            target.selection,
            draft.text,
            reconcileCoreHistoryView
          )
          : undefined
    latestCorePlainTextChange = Object.freeze({
      result: target.item === undefined ? 'author' : 'edit-comment',
      form: target.form ?? 'comment',
      outcome,
      state: adapter.state()
    })
    if (outcome === undefined) {
      coreCommentError.value = t('editor.coreReview.commentSaveFailed')
      return
    }
    // The composer already disclosed an escaped comment payload.
    if (coreCommentEscapeNotice.value === '') discloseCoreAuthorEscapes(outcome)
    coreCommentOpen.value = false
    coreCommentDraft.value = undefined
    coreAuthorSelection.value = undefined
    coreAuthorInvocationSelection.value = undefined
    await refreshCoreReviewItem('next', target.item?.range.start ?? 0)
  } catch (error) {
    coreCommentError.value =
      error instanceof Error ? error.message : t('editor.coreReview.commentSaveFailed')
  } finally {
    coreReviewResolving.value = false
  }
}

const resolveCoreReviewItem = async (decision: CoreReviewDecision): Promise<void> => {
  const adapter = corePlainTextAdapter
  const item = coreReviewItem.value
  const authoredRevision = coreReviewRevision.value
  if (
    adapter === undefined ||
    item === null ||
    authoredRevision === undefined ||
    coreReviewResolving.value
  ) {
    return
  }
  coreReviewResolving.value = true
  try {
    const outcome = await adapter.resolve(
      item,
      authoredRevision,
      decision,
      reconcileCoreHistoryView,
      coreCommandSelection()
    )
    if (outcome === undefined) {
      await refreshCoreReviewItem('next', 0)
      return
    }
    await refreshCoreReviewItem('next', item.range.start)
  } catch (error) {
    emit('core-fault', error)
  } finally {
    coreReviewResolving.value = false
  }
}

/** The document selection a review command runs with, which its undo restores. */
const coreCommandSelection = (): MuyaPlainTextAuthorSelection | undefined => {
  const selection = coreDisplayMode.value === 'markup' ? editor.value?.getSelection() : undefined
  return selection == null
    ? undefined
    : Object.freeze({
      anchor: Object.freeze({ path: Object.freeze([...selection.anchor.path]), offset: selection.anchor.offset }),
      focus: Object.freeze({ path: Object.freeze([...selection.focus.path]), offset: selection.focus.offset })
    })
}

const resolveAllCoreReviewItems = async (decision: 'accept' | 'reject'): Promise<void> => {
  const adapter = corePlainTextAdapter
  if (adapter === undefined || coreReviewResolving.value) return
  coreReviewResolving.value = true
  try {
    const outcome = await adapter.resolveAll(decision, reconcileCoreHistoryView, coreCommandSelection())
    latestCorePlainTextChange = Object.freeze({
      result: 'resolve-all',
      decision,
      outcome,
      state: adapter.state()
    })
    await refreshCoreReviewItem('next', 0)
  } catch (error) {
    emit('core-fault', error)
  } finally {
    coreReviewResolving.value = false
  }
}

const authorCoreReview = async (
  form: 'addition' | 'comment' | 'highlight' | 'substitution',
  invocationSelection:
    | MuyaPlainTextAuthorSelection
    | undefined = coreAuthorInvocationSelection.value
): Promise<void> => {
  const adapter = corePlainTextAdapter
  const muya = editor.value
  if (adapter === undefined || muya === null || coreReviewResolving.value) return
  const liveSelection = muya.getSelection()
  const cached = selectionChange.value as MuyaChange | null
  const cachedAnchorPath = cached?.anchorPath
  const cachedFocusPath = cached?.focusPath
  const cachedAnchorOffset = cached?.anchor?.offset
  const cachedFocusOffset = cached?.focus?.offset
  const selection =
    invocationSelection ??
    coreAuthorSelection.value ??
    (liveSelection !== null
      ? Object.freeze({
        anchor: Object.freeze({
          path: Object.freeze([...liveSelection.anchor.path]),
          offset: liveSelection.anchor.offset
        }),
        focus: Object.freeze({
          path: Object.freeze([...liveSelection.focus.path]),
          offset: liveSelection.focus.offset
        })
      })
      : Array.isArray(cachedAnchorPath) &&
          Array.isArray(cachedFocusPath) &&
          typeof cachedAnchorOffset === 'number' &&
          typeof cachedFocusOffset === 'number'
        ? Object.freeze({
          anchor: Object.freeze({
            path: Object.freeze([...cachedAnchorPath]),
            offset: cachedAnchorOffset
          }),
          focus: Object.freeze({
            path: Object.freeze([...cachedFocusPath]),
            offset: cachedFocusOffset
          })
        })
        : null)
  if (
    selection === null ||
    (selection.anchor.offset === selection.focus.offset &&
      selection.anchor.path.join('/') === selection.focus.path.join('/'))
  ) {
    // A caret in a standalone highlight comments on that highlight.
    if (form === 'comment' && coreReviewHighlightTarget.value !== undefined) {
      coreAuthorInvocationSelection.value = undefined
      await commentOnCoreHighlight(coreReviewHighlightTarget.value)
      return
    }
    latestCorePlainTextChange = Object.freeze({
      result: 'author-unavailable',
      selection
    })
    coreAuthorInvocationSelection.value = undefined
    return
  }
  if (form === 'comment' || form === 'substitution') {
    if (coreCommentOpen.value) return
    await adapter.settled()
    const state = adapter.state()
    if (!('revision' in state)) return
    coreCommentTarget.value = {
      id: `author:${form}:${state.revision}:${JSON.stringify(selection)}`,
      revision: state.revision,
      text: '',
      form,
      selection,
      draftStart: adapter.selectionSourceRange(selection)?.start ?? Number.MAX_SAFE_INTEGER
    }
    coreCommentError.value = ''
    coreCommentOpen.value = true
    reviewLayoutStore.SET_LAYOUT({ showSideBar: true, rightColumn: 'review' })
    return
  }
  const text = ''
  coreReviewResolving.value = true
  try {
    const outcome = await adapter.author(
      form,
      Object.freeze({
        anchor: selection.anchor,
        focus: selection.focus
      }),
      text,
      reconcileCoreHistoryView
    )
    latestCorePlainTextChange = Object.freeze({
      result: 'author',
      form,
      outcome,
      state: adapter.state()
    })
    if (outcome !== undefined) {
      discloseCoreAuthorEscapes(outcome)
      coreAuthorSelection.value = undefined
      await refreshCoreReviewItem('next', 0)
      // As in Google Docs, the item just made holds the selection, so its card
      // is the active one until the caret leaves it.
      const authored = outcome.authorResult?.selection.start
      const entry = authored === undefined
        ? undefined
        : coreReviewOverview.value.find(({ item }) => item.range.start <= authored && authored <= item.range.end)
      if (entry !== undefined) {
        if (coreReviewItem.value?.range.start !== entry.item.range.start) {
          await refreshCoreReviewItem('next', entry.item.range.start)
        }
        revealCoreReviewItem(false)
      }
    }
  } catch (error) {
    emit('core-fault', error)
  } finally {
    coreAuthorInvocationSelection.value = undefined
    coreReviewResolving.value = false
  }
}

/** The standalone highlight the caret is in, which Add Comment comments on. */
const coreReviewHighlightTarget = computed(() => {
  const item = coreReviewItem.value
  if (!coreReviewTargeted.value || item === null || item === undefined || item.kind !== 'highlight') return undefined
  // An empty highlight has no text to comment on.
  const content = 'contentRange' in item ? item.contentRange : undefined
  return content !== undefined && content.end > content.start ? item : undefined
})

/**
 * Opens the comment composer on a standalone highlight's card. Saving adds a
 * gapless comment after the highlight, making one commented span (ADR 0003).
 */
const commentOnCoreHighlight = async (
  item: NonNullable<CoreReviewItemReply['item']> | undefined = coreReviewHighlightTarget.value
): Promise<void> => {
  const adapter = corePlainTextAdapter
  const content = item?.kind === 'highlight' && 'contentRange' in item ? item.contentRange : undefined
  if (adapter === undefined || item === undefined || content === undefined || coreCommentOpen.value) return
  await adapter.settled()
  const state = adapter.state()
  if (!('revision' in state) || coreCommentOpen.value) return
  coreCommentTarget.value = {
    id: `author:highlight-comment:${state.revision}:${item.range.start}:${item.range.end}`,
    revision: state.revision,
    text: '',
    form: 'comment',
    selection: Object.freeze({ start: content.start, end: content.end }),
    entry: item
  }
  coreCommentError.value = ''
  coreCommentOpen.value = true
  reviewLayoutStore.SET_LAYOUT({ showSideBar: true, rightColumn: 'review' })
}

/**
 * Backslash CriticMarkup escaping is a MarkText extension other tools may show
 * literally, so the author is told whenever authoring adds one (ADR 0015).
 */
const discloseCoreAuthorEscapes = (outcome: CoreAppliedReply): void => {
  if (outcome.authorResult?.escaped !== true) return
  notice
    .notify({
      title: t('editor.coreReview.sidebarTitle'),
      type: 'info',
      message: t('editor.coreReview.authorEscapeNotice')
    })
    .catch(() => undefined)
}

const beginCoreAuthorReview = (
  form: 'addition' | 'comment' | 'highlight' | 'substitution'
): void => {
  coreAuthorInvocationSelection.value ??= coreAuthorSelection.value
  authorCoreReview(form, coreAuthorInvocationSelection.value).catch((error) => {
    emit('core-fault', error)
  })
}

// A selection takes the forms Core can author over it; a caret in a
// standalone highlight can take a comment on that highlight.
const coreReviewAuthorForms = computed<readonly CoreAuthorForm[]>(() =>
  coreAuthorSelection.value !== undefined
    ? coreAuthorForms.value
    : coreReviewHighlightTarget.value !== undefined
      ? ['comment']
      : []
)
const coreReviewCommandState = computed<ReviewCommandState>(() => ({
  available: props.coreLease !== undefined && !sourceCode.value,
  editable: coreDisplayMode.value === 'markup',
  canAuthor: coreReviewAuthorForms.value.length > 0,
  authorForms: coreReviewAuthorForms.value,
  canTrack: canToggleCoreTrackChanges({
    enabled: coreTrackChangesEnabled.value,
    editableBindingCount: coreEditableBindingCount.value,
    resolving: coreReviewResolving.value
  }),
  tracking: coreTrackChangesEnabled.value,
  hasItem: coreReviewItem.value !== null,
  targeted: coreReviewTargeted.value && coreReviewItem.value !== null,
  hasComment: coreReviewHasComment.value,
  removable: coreReviewUsesRemove.value,
  busy: coreReviewBusy.value || coreCommentOpen.value || coreDisplayLoading.value,
  mode: coreDisplayMode.value
}))
watch([coreAuthorSelection, coreDocumentRevision], ([selection, revision], [previous, previousRevision]) => {
  // Selection observers re-report an unchanged range; keep its known forms
  // while the document is unchanged too.
  if (
    selection !== undefined &&
    previous !== undefined &&
    isEqual(selection, previous) &&
    revision === previousRevision
  ) {
    return
  }
  coreAuthorForms.value = []
  const lease = props.coreLease
  const adapter = corePlainTextAdapter
  if (selection === undefined || lease === undefined || adapter === undefined) return
  const current = () =>
    isEqual(coreAuthorSelection.value, selection) && coreDocumentRevision.value === revision
  adapter
    .settled()
    .then(async () => {
      if (!current()) return
      const range = adapter.selectionSourceRange(selection)
      const forms = range === undefined ? [] : await lease.authorFormsAtBarrier(range)
      if (current()) coreAuthorForms.value = forms ?? []
    })
    .catch((error) => {
      if (current()) emit('core-fault', error)
    })
})
// A closed composer, whether submitted or cancelled, ends its authoring invocation.
watch(coreCommentOpen, (open) => {
  if (open) return
  coreAuthorInvocationSelection.value = undefined
  // The composer lives on its card, which closing removes, so focus returns here.
  nextTick(restoreCoreCommentFocus)
})
const handleCoreReviewCommand = (value: unknown): void => {
  const command = reviewCommands.find((command) => command.id === value)?.id
  if (
    !command ||
    !reviewCommandEnabled(command, coreReviewCommandState.value) ||
    !ownsCurrentDocument()
  ) {
    return
  }
  pendingCoreCaret = undefined
  const run = async (): Promise<void> => {
    switch (command) {
      case 'show':
        // As in Google Docs, only this request and a comment composer open the panel.
        reviewLayoutStore.SET_LAYOUT({ showSideBar: true, rightColumn: 'review' })
        return
      case 'add-comment':
        beginCoreAuthorReview('comment')
        return
      case 'mark-highlight':
        beginCoreAuthorReview('highlight')
        return
      case 'mark-addition':
        beginCoreAuthorReview('addition')
        return
      case 'suggest-replacement':
        beginCoreAuthorReview('substitution')
        return
      case 'track-changes':
        toggleCoreTrackChanges()
        return
      case 'previous':
      case 'next':
        await navigateCoreReview(command)
        return
      case 'accept':
      case 'reject':
      case 'remove':
        await resolveCoreReviewItem(command)
        return
      case 'edit-comment':
        await editCoreReviewComment()
        return
      case 'accept-all':
        await resolveAllCoreReviewItems('accept')
        return
      case 'reject-all':
        await resolveAllCoreReviewItems('reject')
        return
      case 'markup':
      case 'original':
      case 'revised':
        await showCoreProjection(command)
    }
  }
  run().catch((error) => emit('core-fault', error))
}

const coreContextSession = createReviewContextSession<{
  deepest: NonNullable<ReturnType<typeof reviewContextSelection>>['deepest']
  comment: NonNullable<ReturnType<typeof reviewContextSelection>>['comment']
}>()
let coreContextRequestId = 0
const handleCoreContextRequest = (value: unknown): void => {
  const call = value as { request: ReviewContextRequest; claimed: boolean }
  if (!ownsCurrentDocument()) return
  call.claimed = true
  coreContextSession.clear()
  const { request } = call
  coreContextRequestId = request.requestId
  const prepare = async (): Promise<ReviewContextReply> => {
    const empty = { requestId: request.requestId }
    const lease = props.coreLease
    const adapter = corePlainTextAdapter
    if (
      !lease ||
      !adapter ||
      !coreReviewCommandState.value.available ||
      coreReviewResolving.value ||
      coreCommentOpen.value ||
      coreDisplayLoading.value ||
      coreDisplayMode.value !== 'markup'
    ) {
      return empty
    }
    const view = coreAcknowledgedMarkupView
    const element = document
      .elementFromPoint(request.x, request.y)
      ?.closest<HTMLElement>('[data-critic-start]')
    const binding =
      element &&
      view?.bindings.find((binding) =>
        editor.value?.editor.scrollPage?.queryBlock([...binding.path])?.domNode?.contains(element)
      )
    if (!binding || !element) return empty
    const start = binding.sourceRange.start + Number(element.dataset.criticStart)
    await adapter.settled()
    if (
      !ownsCurrentDocument() ||
      props.coreLease !== lease ||
      coreAcknowledgedMarkupView !== view
    ) {
      return empty
    }
    const reply = await lease.binding.reviewItemAtBarrier('next', 0, true)
    if (
      reply.type !== 'review-item' ||
      !ownsCurrentDocument() ||
      props.coreLease !== lease ||
      coreAcknowledgedMarkupView !== view
    ) {
      return empty
    }
    const target = reviewContextSelection(reply.overview ?? [], start)
    if (!target || coreContextRequestId !== request.requestId) return empty
    const state = {
      ...coreReviewCommandState.value,
      hasItem: true,
      targeted: true,
      busy: coreReviewResolving.value || coreCommentOpen.value || coreDisplayLoading.value,
      removable: ['comment', 'commented-span', 'highlight'].includes(target.deepest.item.kind),
      hasComment: target.comment !== undefined
    }
    const commands: ReviewContextCommand[] = (
      ['accept', 'reject', 'remove', 'edit-comment'] as const
    ).filter((command) => reviewCommandEnabled(command, state))
    if (target.deepest.item.kind === 'highlight' && state.editable && !state.busy) {
      commands.push('add-comment')
    }
    coreContextSession.set(
      request.requestId,
      { documentId: lease.documentId, revision: reply.revision, lease },
      target
    )
    return {
      requestId: request.requestId,
      commands,
      labels: {
        remove: target.deepest.item.kind === 'highlight' ? 'removeHighlight' : 'removeComment'
      }
    }
  }
  prepare()
    .then((reply) => window.electron.ipcRenderer.send('mt::review-context-reply', reply))
    .catch((error) => {
      coreContextSession.clear(request.requestId)
      window.electron.ipcRenderer.send('mt::review-context-reply', {
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error)
      })
    })
}
const handleCoreContextClosed = (value: unknown): void => {
  if (typeof value === 'number') {
    coreContextSession.clear(value)
    if (coreContextRequestId === value) coreContextRequestId = 0
  }
}
const handleCoreContextAction = (value: unknown): void => {
  const action = value as ReviewContextAction
  const lease = props.coreLease
  const adapter = corePlainTextAdapter
  if (!ownsCurrentDocument() || !lease || !adapter) {
    coreContextSession.clear()
    return
  }
  const initial = adapter.state()
  if (!('revision' in initial)) {
    coreContextSession.clear()
    return
  }
  const target = coreContextSession.take(action.requestId, {
    documentId: lease.documentId,
    revision: initial.revision,
    lease
  })
  if (!target) return
  const applicability = {
    ...coreReviewCommandState.value,
    busy: coreReviewResolving.value || coreCommentOpen.value || coreDisplayLoading.value,
    hasItem: true,
    targeted: true,
    removable: ['comment', 'commented-span', 'highlight'].includes(target.deepest.item.kind),
    hasComment: target.comment !== undefined
  }
  if (action.command === 'add-comment') {
    if (!applicability.busy && applicability.editable && target.deepest.item.kind === 'highlight') {
      commentOnCoreHighlight(target.deepest.item).catch((error) => emit('core-fault', error))
    }
    return
  }
  if (!reviewCommandEnabled(action.command, applicability)) return
  coreReviewItem.value = target.deepest.item
  coreReviewRevision.value = initial.revision
  coreReviewCommentText.value = target.deepest.commentText
  if (action.command === 'edit-comment' && target.comment) {
    coreCommentTarget.value = {
      id: `context:${action.requestId}`,
      revision: initial.revision,
      text: target.comment.commentText ?? '',
      item: target.comment.item,
      entry: target.comment.item
    }
    coreCommentError.value = ''
    coreCommentOpen.value = true
    reviewLayoutStore.SET_LAYOUT({ showSideBar: true, rightColumn: 'review' })
  } else if (action.command !== 'edit-comment') {
    // Admit the exact captured operation before a following save can enter
    // Core's queue. Resolution owns revision validation and subsequent refresh.
    resolveCoreReviewItem(action.command).catch((error) => emit('core-fault', error))
  }
}

const handleCoreHistory = (command: 'undo' | 'redo'): void => {
  const adapter = corePlainTextAdapter
  if (adapter === undefined) return
  editor.value?.flush()
  adapter
    .history(command, reconcileCoreHistoryView)
    .then((outcome) => {
      latestCorePlainTextChange = Object.freeze({
        result: 'history',
        command,
        outcome,
        state: adapter.state()
      })
      if (outcome !== undefined && coreBoundLease !== undefined) {
        editorStore
          .REFRESH_CORE_SAVED_STATE(coreBoundLease.documentId, {
            generation: outcome.session,
            revision: outcome.revision
          })
          .catch((error) => console.error('Core saved-state refresh failed', error))
      }
      refreshCoreReviewItem('next', 0).catch((error) => {
        emit('core-fault', error)
      })
    })
    .catch((error) => {
      emit('core-fault', error)
    })
}

const handleUndo = () => {
  if (!markupEditingAvailable.value) {
    return
  }

  handleCoreHistory('undo')
}

const handleRedo = () => {
  if (!markupEditingAvailable.value) {
    return
  }

  handleCoreHistory('redo')
}

const handleSelectAll = () => {
  if (sourceCode.value) {
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

const coreProjectionAtBarrier = async () => {
  const lease = props.coreLease
  if (lease === undefined) {
    throw new Error('Core consumer projection is unavailable')
  }
  const inputEpoch = coreConsumerInputEpoch
  const projection = await lease.consumerProjectionAtBarrier()
  const identity = Object.freeze({ ...lease.identity })
  if (inputEpoch !== coreConsumerInputEpoch || lease.consumerProjection() !== projection) {
    throw new Error('Core consumer projection identity changed')
  }
  return Object.freeze({ lease, identity, projection })
}

const refreshCoreConsumerCount = async (): Promise<boolean> => {
  const summaryLease = props.coreLease
  if (summaryLease === undefined) return false
  const inputEpoch = coreConsumerInputEpoch
  try {
    // Counts and the outline read only the Revised text and headings, which
    // Core reads after a regional edit without projecting the whole document.
    const summary = await summaryLease.consumerSummaryAtBarrier()
    if (summary !== undefined) {
      if (inputEpoch !== coreConsumerInputEpoch || props.coreLease !== summaryLease) {
        throw new Error('Core consumer summary identity changed')
      }
      const identity = Object.freeze({ ...summaryLease.identity })
      editorStore.UPDATE_CORE_CONSUMER_COUNT(
        summaryLease.documentId,
        identity,
        countProjectedText(summary.markdown)
      )
      editorStore.UPDATE_CORE_CONSUMER_TOC(
        summaryLease.documentId,
        identity,
        coreAcknowledgedMarkupView === undefined
          ? summary.headings.map(tocEntryOf)
          : coreHeadingToc(summary.headings, coreAcknowledgedMarkupView)
      )
      return true
    }
    const { lease, identity, projection } = await coreProjectionAtBarrier()
    editorStore.UPDATE_CORE_CONSUMER_COUNT(
      lease.documentId,
      identity,
      countProjectedDocument(projection)
    )
    editorStore.UPDATE_CORE_CONSUMER_TOC(
      lease.documentId,
      identity,
      coreAcknowledgedMarkupView === undefined
        ? [...tocProjectedDocument(projection)]
        : createCoreHeadingToc(projection, coreAcknowledgedMarkupView)
    )
    return true
  } catch (error) {
    if (inputEpoch === coreConsumerInputEpoch) emit('core-fault', error)
    return false
  }
}

// Counts, outline and passive Review navigation read whole-document projections.
// Refresh them after native input pauses so those reads cannot queue ahead of
// the next edit. Explicit search, clipboard and export still use their barriers.
// Each refresh starts in an idle period of its own, after any key already
// queued, so a key typed meanwhile waits for one of them at most.
const passiveIdleHandles = new Set<number>()
const whenIdle = (task: () => void): void => {
  const handle = requestIdleCallback(
    () => {
      passiveIdleHandles.delete(handle)
      task()
    },
    { timeout: 500 }
  )
  passiveIdleHandles.add(handle)
}
const debouncedCorePassiveConsumers = debounce(() => {
  whenIdle(() => {
    refreshCoreConsumerCount()
  })
  whenIdle(() => {
    refreshCoreReviewItem('next', () => coreReviewItem.value?.range.start ?? 0, true)
  })
}, 150)
const refreshCorePassiveConsumers = Object.assign(() => debouncedCorePassiveConsumers(), {
  cancel: (): void => {
    debouncedCorePassiveConsumers.cancel()
    for (const handle of passiveIdleHandles) cancelIdleCallback(handle)
    passiveIdleHandles.clear()
  }
})

const prepareCoreSelectionClipboard = async (flavor: 'html' | 'rich'): Promise<boolean> => {
  const authority = coreSelectionClipboardAuthority
  if (authority === undefined) return false
  const inputEpoch = coreConsumerInputEpoch
  try {
    const payload = await authority.prepare(flavor)
    return inputEpoch === coreConsumerInputEpoch && payload !== undefined
  } catch (error) {
    if (inputEpoch === coreConsumerInputEpoch) emit('core-fault', error)
    return false
  }
}

const retryCoreSelectionClipboard = (operation: ProjectedSelectionClipboardOperation): void => {
  prepareCoreSelectionClipboard('rich')
    .then((prepared) => {
      if (prepared && coreSelectionClipboardAuthority?.payload() !== undefined) {
        document.execCommand(operation)
      }
    })
    .catch((error) => {
      emit('core-fault', error)
    })
}

// Custom copyAsRich copyAsHtml pasteAsPlainText.
// `copyAsRich` writes the rendered HTML to `text/html` AND the plain text to
// `text/plain`, so pasting into Word/email yields formatted rich text (whereas
// `copyAsHtml` blanks `text/html` and puts the HTML source into `text/plain`).
const COPY_PASTE_METHOD_MAP: Record<string, 'copyAsRich' | 'copyAsHtml' | 'pasteAsPlainText'> = {
  copyAsRich: 'copyAsRich',
  copyAsHtml: 'copyAsHtml',
  pasteAsPlainText: 'pasteAsPlainText'
}
const handleCopyPaste = async (type: unknown): Promise<void> => {
  const method = COPY_PASTE_METHOD_MAP[type as string]
  // Without a Core lease this view has no document to copy or paste into;
  // Muya's own serialization and paste parsing never stand in for Core.
  if (method === undefined || editor.value === null || props.coreLease === undefined) return
  if (method === 'pasteAsPlainText') {
    if (markupEditingAvailable.value) editor.value.pasteAsPlainText()
    return
  }
  if (await prepareCoreSelectionClipboard(method === 'copyAsHtml' ? 'html' : 'rich')) {
    document.execCommand('copy')
  }
}

const insertImage = (src: unknown) => {
  if (markupEditingAvailable.value) {
    editor.value && editor.value.insertImage({ src: src as string })
  }
}

// muya's search/replace/find return the live Search instance (circular:
// Search -> muya -> ... -> ScrollPage) and each match carries a live `block`
// reference. The store deep-clones (JSON.stringify) its payload, so extract
// only the plain { index, matches, value } the search UI needs.
const toSearchMatches = (result: unknown) => {
  const r = (result ?? {}) as {
    index?: number
    value?: string
    matches?: Array<{ start: number; end: number; match: string }>
  }
  return {
    index: r.index ?? -1,
    matches: (r.matches ?? []).map((m) => ({ start: m.start, end: m.end, match: m.match })),
    value: r.value ?? ''
  }
}

const handleSearch = async (payload: unknown): Promise<void> => {
  if (sourceCode.value) return
  const { value, opt } = payload as { value: string; opt?: ProjectedSearchOptions }
  // Search reads only Core's projection; a view without a lease has none.
  if (props.coreLease !== undefined) {
    const inputEpoch = coreConsumerInputEpoch
    const selection =
      value === '' &&
      (opt as { selectHighlight?: boolean })?.selectHighlight &&
      coreSearchProjectionEpoch === inputEpoch
        ? coreSearchPresentation?.selection()
        : undefined
    coreSearchSnapshot = undefined
    try {
      const { lease, identity, projection } = await coreProjectionAtBarrier()
      const result = searchProjectedDocument(projection, value, opt ?? {})
      coreSearchSnapshot = Object.freeze({
        identity,
        result,
        options: Object.freeze({ ...(opt ?? {}) })
      })
      coreSearchPresentation?.present(result)
      if (selection !== undefined) {
        const muya = editor.value
        const anchor = muya?.editor.scrollPage?.queryBlock([...selection.anchor.path])
        const focus = muya?.editor.scrollPage?.queryBlock([...selection.focus.path])
        if (anchor?.isContent() && focus?.isContent()) {
          muya?.editor.selection.setSelection(
            { block: anchor, path: anchor.path, offset: selection.anchor.offset },
            { block: focus, path: focus.path, offset: selection.focus.offset }
          )
        }
      }
      coreSearchProjectionEpoch = inputEpoch
      editorStore.UPDATE_CORE_CONSUMER_SEARCH(lease.documentId, identity, toSearchMatches(result))
      scrollToHighlight()
    } catch (error) {
      if (inputEpoch === coreConsumerInputEpoch) emit('core-fault', error)
    }
  }
}

const replaceCoreSearch = async (payload: unknown): Promise<void> => {
  const lease = props.coreLease
  const adapter = corePlainTextAdapter
  const snapshot = coreSearchSnapshot
  if (lease === undefined || adapter === undefined || snapshot === undefined) return
  const { value, opt } = payload as {
    value: string
    opt?: Readonly<{ isSingle?: boolean; isRegexp?: boolean }>
  }
  const inputEpoch = coreConsumerInputEpoch
  try {
    const outcome = await executeProjectedSearchReplacement({
      snapshot,
      value,
      options: {
        isSingle: opt?.isSingle !== false,
        isRegexp: opt?.isRegexp === true
      },
      settle: () => adapter.settled(),
      isCurrent: () => inputEpoch === coreConsumerInputEpoch && coreSearchSnapshot === snapshot,
      replace: (identity, replacements) =>
        lease.replaceConsumerSearchAtBarrier(
          identity,
          replacements,
          trimUnnecessaryCodeBlockEmptyLines.value === true
        )
    })
    if (outcome === undefined) return
    if (outcome.type !== 'applied') {
      coreSearchSnapshot = undefined
      coreSearchProjectionEpoch = -1
      coreSearchPresentation?.clear()
      editorStore.UPDATE_CORE_CONSUMER_SEARCH(lease.documentId, lease.identity, {
        index: -1,
        matches: [],
        value: ''
      })
      return
    }
    await adapter.reconcileApplied(outcome, reconcileCoreHistoryView)
    const refreshed = await coreProjectionAtBarrier()
    const result = searchProjectedDocument(
      refreshed.projection,
      snapshot.result.value,
      snapshot.options
    )
    coreSearchSnapshot = Object.freeze({
      identity: refreshed.identity,
      result,
      options: snapshot.options
    })
    coreSearchProjectionEpoch = coreConsumerInputEpoch
    coreSearchPresentation?.present(result)
    editorStore.UPDATE_CORE_CONSUMER_SEARCH(
      refreshed.lease.documentId,
      refreshed.identity,
      toSearchMatches(result)
    )
    editorStore.UPDATE_CORE_CONSUMER_COUNT(
      refreshed.lease.documentId,
      refreshed.identity,
      countProjectedDocument(refreshed.projection)
    )
    editorStore.UPDATE_CORE_CONSUMER_TOC(
      refreshed.lease.documentId,
      refreshed.identity,
      coreAcknowledgedMarkupView === undefined
        ? [...tocProjectedDocument(refreshed.projection)]
        : createCoreHeadingToc(refreshed.projection, coreAcknowledgedMarkupView)
    )
    scrollToHighlight()
  } catch (error) {
    if (props.coreLease === lease) emit('core-fault', error)
  }
}

const handReplace = (payload: unknown) => {
  if (!markupEditingAvailable.value || props.coreLease === undefined) return
  replaceCoreSearch(payload).catch((error) => emit('core-fault', error))
}

const handleUploadedImage = (url: unknown, deletionUrl?: unknown) => {
  insertImage(url)
  editorStore.SHOW_IMAGE_DELETION_URL(deletionUrl as string)
}

// `muya.domNode` is the contenteditable + scroll container (it inherits the
// `.editor-component` class from the original mount point and `overflow:auto`).
// The legacy engine exposed the same element as `muya.container`.
const getScrollContainer = (): HTMLElement | null =>
  (editor.value?.domNode as HTMLElement | undefined) ?? null

// Viewport-relative caret rect (mirrors the engine's `Selection.getCursorCoords`
// / legacy `cursorCoords`). Used for typewriter + keep-cursor-visible scrolling
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

// Only the slug-to-element pairing is cached. Positions are not: typing body
// text moves every later heading without changing the TOC, so a stored offset
// is stale within a keystroke and the highlight lands a section ahead.
interface CachedHeading {
  slug: string
  el: HTMLElement
}

let headingElementCache: CachedHeading[] = []

const rebuildHeadingCache = (): void => {
  const container = getScrollContainer()
  if (!container || editorStore.listToc.length === 0) {
    headingElementCache = []
    return
  }
  const headingEls = container.querySelectorAll(TOP_LEVEL_HEADINGS_SELECTOR)
  headingElementCache = editorStore.listToc
    .map((item, index) => {
      const el = headingEls[index] as HTMLElement | undefined
      if (!el || typeof item.slug !== 'string') return null
      return { slug: item.slug, el }
    })
    .filter((entry): entry is CachedHeading => entry != null)
}

// Measured with `getBoundingClientRect`, not `offsetTop`: the caret's position
// is fractional, and rounding the headings to whole pixels reports the one the
// caret sits in as the heading above it.
const updateActiveHeading = (viewportY: number): void => {
  if (headingElementCache.length === 0) return
  const positions: HeadingPosition[] = headingElementCache.map(({ slug, el }) => ({
    slug,
    top: el.getBoundingClientRect().top
  }))
  editorStore.SET_ACTIVE_HEADING(findActiveHeadingSlug(positions, viewportY))
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

// Smoothly scroll the editor so `anchor` sits at the standard caret offset.
// Shared by search highlights and non-heading in-document anchors.
const scrollElementIntoView = (anchor: Element | null | undefined, duration = 300) => {
  const container = getScrollContainer()
  if (!container || !anchor) return
  const { y } = anchor.getBoundingClientRect()
  animatedScrollTo(container, container.scrollTop + y - STANDAR_Y, duration)
}

const scrollToHighlight = () => {
  return scrollToElement('.mu-highlight')
}

/**
 * Scrolls the editor to the heading for a TOC entry. See
 * `resolveTocHeadingElement` for why the slug is resolved by document order
 * against the top-level headings only.
 * @param slug The TOC entry's slug from the `scroll-to-header` bus event.
 */
const scrollToHeader = (slug: unknown) => {
  const container = getScrollContainer()
  if (!container) return
  const nativePath = editorStore.listToc.find((item) => item.slug === slug)?.nativePath
  const heading =
    props.coreLease !== undefined && Array.isArray(nativePath)
      ? editor.value?.editor.scrollPage?.queryBlock(nativePath)?.domNode
      : resolveTocHeadingElement(container, editorStore.listToc, slug)
  if (!heading) return
  animatedScrollTo(container, getTocHeadingScrollTop(container, heading), 300)
}

// Scrolls to a non-heading in-document anchor target (e.g. a custom
// `<a id="...">`) resolved by `FORMAT_LINK_CLICK` via `getElementById`.
const scrollToAnchorElement = (element: unknown) => {
  if (element instanceof Element) scrollElementIntoView(element)
}

const scrollToElement = (selector: string) => {
  // Scroll to search highlight word
  scrollElementIntoView(document.querySelector(selector))
}

const handleFindAction = (action: unknown) => {
  if (sourceCode.value) return
  if (props.coreLease !== undefined) {
    const direction = action === 'prev' ? 'previous' : action
    if (direction !== 'next' && direction !== 'previous') return
    if (
      coreSearchProjectionEpoch !== coreConsumerInputEpoch ||
      props.coreLease.consumerProjection() === undefined
    ) {
      coreSearchSnapshot = undefined
      coreSearchPresentation?.clear()
      return
    }
    const result = coreSearchPresentation?.navigate(direction)
    if (result === undefined) return
    editorStore.UPDATE_CORE_CONSUMER_SEARCH(
      props.coreLease.documentId,
      props.coreLease.identity,
      toSearchMatches(result)
    )
    scrollToHighlight()
  }
}

interface ExportOptions {
  type: string
  header?: unknown
  footer?: unknown
  headerFooterStyled?: unknown
  htmlTitle?: string
  pageSize?: string
  pageSizeWidth?: number
  pageSizeHeight?: number
  isLandscape?: boolean
  [key: string]: unknown
}

const handleExport = async (options: unknown) => {
  const opts = options as ExportOptions
  const { type, headerFooterStyled, htmlTitle } = opts

  if (!/^pdf|print|styledHtml$/.test(type)) {
    throw new Error(`Invalid type to export: "${type}".`)
  }

  const muya = editor.value
  if (!muya) return

  const extraCss = await getCssForOptions(opts as unknown as PdfCssOptions)
  const header = (opts.header ?? null) as HeaderFooterPart | null
  const footer = (opts.footer ?? null) as HeaderFooterPart | null
  const renderExportHtml = async (
    exportOptions: Omit<ExportStyledHtmlOptions, 'toc'>
  ): Promise<string> => {
    const documentLease = props.coreLease ?? props.coreDocumentLease
    if (documentLease === undefined) throw new Error('Core consumer projection is unavailable')
    const projection =
      documentLease === props.coreLease
        ? (await coreProjectionAtBarrier()).projection
        : await documentLease.consumerProjectionAtBarrier()
    return exportStyledHTMLFromProjection(muya, projection, {
      ...exportOptions,
      toc: getHtmlToc([...tocProjectedDocument(projection)], opts as unknown as HtmlTocOptions)
    })
  }

  switch (type) {
    case 'styledHtml': {
      try {
        const content = await renderExportHtml({
          title: htmlTitle || '',
          printOptimization: false,
          extraCss,
          dir: props.textDirection
        })
        editorStore.EXPORT({ type, content })
      } catch (err) {
        log.error('Failed to export document:', err)
        notice.notify({
          title: t('editor.export.failed', { type: htmlTitle || 'html' }),
          type: 'error',
          message:
            (err as { message?: string } | null | undefined)?.message ?? t('editor.export.error')
        })
      }
      break
    }
    case 'pdf': {
      // NOTE: We need to set page size via Electron.
      let preparation: PrintPreparation | undefined
      try {
        const { pageSize, pageSizeWidth, pageSizeHeight, isLandscape } = opts
        const pageOptions = {
          pageSize,
          pageSizeWidth,
          pageSizeHeight,
          isLandscape
        }

        const html = await renderExportHtml({
          title: '',
          printOptimization: true,
          extraCss,
          header,
          footer,
          headerFooterStyled: headerFooterStyled as boolean | undefined,
          dir: props.textDirection
        })
        preparation = await printer!.renderMarkdown(html, true, props.textDirection)
        if (!preparation.isCurrent()) return
        editorStore.EXPORT({ type, pageOptions })
      } catch (err) {
        log.error('Failed to export document:', err)
        notice.notify({
          title: t('editor.export.failed', { type: 'PDF' }),
          type: 'error',
          message: t('editor.export.errorExporting', { type: htmlTitle || 'PDF' })
        })
        preparation?.clearup()
      }
      break
    }
    case 'print': {
      // NOTE: Print doesn't support page size or orientation.
      let preparation: PrintPreparation | undefined
      try {
        const html = await renderExportHtml({
          title: '',
          printOptimization: true,
          extraCss,
          header,
          footer,
          headerFooterStyled: headerFooterStyled as boolean | undefined,
          dir: props.textDirection
        })
        preparation = await printer!.renderMarkdown(html, true, props.textDirection)
        if (!preparation.isCurrent()) return
        editorStore.PRINT_RESPONSE()
      } catch (err) {
        log.error('Failed to export document:', err)
        notice.notify({
          title: t('editor.print.failed'),
          type: 'error',
          message: t('editor.print.error', { title: htmlTitle || '' })
        })
        preparation?.clearup()
      }
      break
    }
  }
}

const handlePrintServiceClearup = () => {
  printer!.clearup()
}

// Push the current selection to the application-menu / toolbar state. Called on
// every muya selection-change, and again right after a paragraph action: a no-op
// action (e.g. "Paragraph" inside a list/quote) fires no selection-change, so the
// clicked checkbox menu item's auto-toggled OS checkmark would otherwise linger.
const pushSelectionMenuState = (changes: MuyaChange) => {
  // Selection state would re-enable Format/Paragraph menus disabled above.
  if (!markupEditingAvailable.value) return
  editorStore.SELECTION_CHANGE({
    ...adaptSelectionChange(changes),
    // Read the live block tree (O(1)) rather than getState(), which deep-clones
    // the whole document — this runs on every cursor move.
    hasFrontMatter: editor.value?.editor?.scrollPage?.firstChild?.blockName === 'frontmatter'
  })
  // The active inline formats ride along on selection-change — drive the format
  // menu/toolbar state from them.
  editorStore.SELECTION_FORMATS((changes.formats ?? []) as SelectionFormatLike[])
}

const releaseTableDialogTarget = (target = tableDialogTarget): void => {
  if (target === undefined) return
  if (tableDialogTarget === target) {
    tableDialogTarget = undefined
    dialogTableVisible.value = false
  }
  target.stopWaiting?.()
  target.stopWaiting = undefined
  const id = target.selectionId
  target.selectionId = undefined
  if (id === undefined || target.lease === undefined) return
  try {
    const released = target.lease.binding.releaseSelection(id)
    if (released.type !== 'selection-released') {
      throw new Error(`Table dialog target release was ${released.reason}`)
    }
  } catch (error) {
    if (editor.value === target.muya && props.coreLease === target.lease && !coreDraftFrozen) {
      emit('core-fault', error)
    } else {
      console.error('Retired table dialog target could not be released', error)
    }
  }
}
const ownsTableDialogTarget = (target: NonNullable<typeof tableDialogTarget>): boolean =>
  tableDialogTarget === target &&
  editor.value === target.muya &&
  props.coreLease === target.lease &&
  !sourceCode.value &&
  ownsCurrentDocument()
const readTableDialogSelection = (target: NonNullable<typeof tableDialogTarget>) => {
  const lease = target.lease
  const view = coreAcknowledgedMarkupView
  if (lease === undefined) return undefined
  if (
    coreDraftFrozen ||
    !corePlainTextAdapter ||
    corePlainTextAdapter.state().status !== 'ready' ||
    corePlainTextAdapter.hasPendingEdits() ||
    !view ||
    target.selectionId === undefined ||
    target.generation !== lease.identity.generation ||
    coreAcknowledgedViewRevision !== lease.identity.revision
  ) {
    throw new Error('Table dialog requires the current acknowledged document view')
  }
  const retained = lease.binding.retainedSelectionAtBarrier(target.selectionId)
  if (
    retained.type !== 'retained-selection' ||
    retained.status !== 'ready' ||
    retained.selectionRevision !== coreAcknowledgedViewRevision ||
    'start' in retained.selection
  ) {
    throw new Error('Table dialog target is no longer available')
  }
  return { view, selection: retained.selection }
}
const showTableDialog = (target: NonNullable<typeof tableDialogTarget>): void => {
  if (!ownsTableDialogTarget(target)) {
    releaseTableDialogTarget(target)
    return
  }
  readTableDialogSelection(target)
  target.stopWaiting?.()
  target.stopWaiting = undefined
  tableChecker.rows = 4
  tableChecker.columns = 3
  dialogTableVisible.value = true
  nextTick(() => {
    if (ownsTableDialogTarget(target) && dialogTableVisible.value) rowInput.value?.focus()
  })
}
watch(
  dialogTableVisible,
  (visible) => {
    if (!visible && !tableDialogTarget?.confirming) releaseTableDialogTarget()
  },
  { flush: 'sync' }
)
watch(
  () => props.coreLease,
  (lease) => {
    if (tableDialogTarget !== undefined && tableDialogTarget.lease !== lease) {
      releaseTableDialogTarget()
    }
  },
  { flush: 'sync' }
)
watch(
  sourceCode,
  (source) => {
    if (source) releaseTableDialogTarget()
  },
  { flush: 'sync' }
)

const handleEditParagraph = (type: unknown) => {
  // These commands act on the hidden WYSIWYG engine, so block them in
  // source-code mode (mirrors handleUndo/handleSelectAll) — otherwise e.g. the
  // Insert Table wizard opens and writes to the invisible editor (#3531).
  if (!markupEditingAvailable.value) {
    return
  }
  if (type === 'table') {
    const muya = editor.value
    if (muya === null || !ownsCurrentDocument()) return
    muya.flush()
    releaseTableDialogTarget()
    const lease = props.coreLease
    const adapter = corePlainTextAdapter
    const target: NonNullable<typeof tableDialogTarget> = {
      muya,
      lease,
      generation: lease?.identity.generation,
      confirming: false
    }
    try {
      if (lease !== undefined) {
        if (
          !adapter ||
          adapter.state().status !== 'ready' ||
          adapter.hasPendingEdits() ||
          coreAcknowledgedViewRevision !== lease.identity.revision
        ) {
          throw new Error('Table dialog requires an acknowledged document view')
        }
        const selection = captureDocumentSelection()
        if (selection === undefined) {
          throw new Error('Table dialog requires the current document selection')
        }
        const retained = lease.binding.retainSelection(selection)
        if (retained.type !== 'retained-selection') {
          throw new Error(`Table dialog target was ${retained.reason}`)
        }
        target.selectionId = retained.id
      }
      tableDialogTarget = target
      if (adapter !== undefined && !adapter.isSettled()) {
        // Imports still need the live editor selection when they finish. Keep
        // focus here until they settle; Core rebases the captured table target.
        const cancelWaiting = (event: KeyboardEvent) => {
          if (event.key === 'Escape') releaseTableDialogTarget(target)
        }
        document.addEventListener('keydown', cancelWaiting)
        target.stopWaiting = () => document.removeEventListener('keydown', cancelWaiting)
        adapter
          .settled()
          .then(() => showTableDialog(target))
          .catch((error) => {
            const current = ownsTableDialogTarget(target)
            releaseTableDialogTarget(target)
            if (current) emit('core-fault', error)
          })
      } else {
        showTableDialog(target)
      }
    } catch (error) {
      releaseTableDialogTarget(target)
      emit('core-fault', error)
    }
  } else if (editor.value) {
    editor.value.updateParagraph(type as string)
    // Re-sync the menu so a no-op action (e.g. "Paragraph" inside a list/quote)
    // does not leave the clicked checkbox item checked. A real conversion fires
    // its own selection-change, which resyncs again.
    if (selectionChange.value) {
      pushSelectionMenuState(selectionChange.value as MuyaChange)
    }
  }
}

// handle `duplicate`, `delete`, `create paragraph below`
const handleParagraph = (type: unknown) => {
  if (!markupEditingAvailable.value) {
    return
  }
  if (editor.value) {
    switch (type) {
      case 'duplicate': {
        return editor.value.duplicate()
      }
      case 'createParagraph': {
        return editor.value.insertParagraph('after', '', true)
      }
      case 'deleteParagraph': {
        return editor.value.deleteParagraph()
      }
      default:
        console.error(`unknown paragraph edit type: ${type}`)
    }
  }
}

const handleInlineFormat = (type: unknown) => {
  if (!markupEditingAvailable.value) {
    return
  }
  const muya = editor.value
  if (muya === null) return
  // Bound Muya opens the image tool itself once the format is applied.
  muya.format(type as string)
}

const handleDialogTableConfirm = async () => {
  const target = tableDialogTarget
  if (target === undefined || target.confirming) return
  target.confirming = true
  const dimensions = { ...tableChecker }
  dialogTableVisible.value = false
  // Release the modal's focus trap before restoring the document selection.
  await nextTick()
  try {
    if (!ownsTableDialogTarget(target)) return
    const retained = readTableDialogSelection(target)
    if (retained !== undefined) {
      // A dialog outlives native blocks replaced by reconciliation. Retain its
      // model target instead of Muya's cached block references.
      restoreMuyaDocumentSelection(target.muya, retained.view, retained.selection)
    }
    target.muya.createTable(dimensions)
  } catch (error) {
    emit('core-fault', error)
  } finally {
    releaseTableDialogTarget(target)
  }
}

const handleInsertParagraph = (location: unknown) => {
  if (!markupEditingAvailable.value) return
  editor.value && editor.value.insertParagraph(location as Parameters<Muya['insertParagraph']>[0])
}

const blurEditor = () => {
  editor.value?.blur(false, true)
}

const flushActiveEditor = () => {
  editor.value?.flush()
}

// The engine's `focus()` only sets the selection range; the contenteditable
// also needs DOM focus or no caret blinks.
const focusEditor = () => {
  const ed = editor.value
  if (!ed) return
  ed.domNode.focus()
  ed.focus()
}

// When a focus-trapping modal (the command palette) opens, release the editor's
// contenteditable focus first. element-plus's el-dialog restores focus to the
// previously focused element on close; restoring it into the engine's
// contenteditable while its selection is uncommitted makes the focus-trap and
// the engine's selection handling fight, freezing the renderer. Blurring up
// front removes the editor as the restore target and avoids the loop.
const handleModalOpening = () => {
  if (editor.value && editor.value.hasFocus()) {
    editor.value.blur(true, true)
  }
}

// macOS Edit → Screenshot. The main process captures the region, saves it to a
// PNG, and hands us the path. `document.execCommand('paste')` no longer fires in
// Electron 42 Chromium, so insert the saved image at the cursor through the
// engine (routing via `imageAction` → upload/folder/path).
const handleScreenShot = (filePath?: unknown) => {
  if (markupEditingAvailable.value && editor.value && typeof filePath === 'string' && filePath) {
    editor.value.pasteImage(filePath)
  }
}

// Re-rendering an unchanged document replaces a focused comment marker; the
// marker in the same place in the document keeps the focus.
const keepMarkerFocus = (render: () => void): void => {
  const focused = document.activeElement?.closest<HTMLElement>('.mu-critic-comment-marker')
  const root = focused?.closest<HTMLElement>('.editor-component')
  const index = root ? [...root.querySelectorAll('.mu-critic-comment-marker')].indexOf(focused!) : -1
  render()
  if (!focused || !root || focused.isConnected || index < 0) return
  root.querySelectorAll<HTMLElement>('.mu-critic-comment-marker')[index]?.focus()
}
const handleLanguageChanged = (newLocale?: unknown) => {
  const muya = editor.value
  if (muya) {
    const locale = typeof newLocale === 'string' ? newLocale : language.value
    keepMarkerFocus(() => muya.locale(getMuyaLocale(locale)))
  }
}
// Translation loading is asynchronous; observe the translated value after it lands.
watch(
  () => t('editor.coreReview.commentPrompt'),
  () => {
    const muya = editor.value
    const view = coreAcknowledgedMarkupView
    if (!muya || !view) return
    keepMarkerFocus(() => {
      installCoreMarkupPresentation(muya, view)
      for (const path of coreMarkupPresentation?.changedPaths ?? []) {
        const block = muya.editor.scrollPage?.queryBlock([...path])
        if (block?.isContent()) block.update()
      }
    })
    if (coreReviewLocatedNode !== undefined) revealCoreReviewItem(false)
  }
)

const coreViewDocumentId = props.coreLease?.documentId
const ownsCurrentDocument = () =>
  coreViewDocumentId !== undefined &&
  props.coreLease?.documentId === coreViewDocumentId &&
  currentFile.value?.id === coreViewDocumentId
watch(
  coreReviewCommandState,
  (state) => {
    // The selection toolbar draws the same commands; redraw it so it never
    // disagrees with the menu.
    editor.value?.eventCenter.emit('inline-toolbar-actions-change')
    if (!ownsCurrentDocument()) return
    window.electron.ipcRenderer.send('mt::review-command-state', state)
    reviewStatus.tracking = state.available && state.tracking
    reviewStatus.commands = state
  },
  { immediate: true }
)

onMounted(() => {
  const initialCoreScrollTop =
    coreViewDocumentId === currentFile.value?.id ? (currentFile.value?.scrollTop ?? 0) : 0
  printer = new Printer()
  const ele = editorRef.value
  if (!ele) return

  // Registration is process-global; the registrar preserves the component's
  // original once-per-renderer guard and exact plugin order/options.
  registerDesktopMuyaPlugins({
    imageAction: muyaImageAction,
    imagePathPicker,
    imagePathAutoComplete,
    jumpClick
  })

  const options: Partial<IMuyaOptions> = {
    inlineToolbarActions: () =>
      props.coreLease === undefined
        ? []
        : reviewCommands
          .filter((command) =>
            ['add-comment', 'mark-highlight', 'mark-addition', 'suggest-replacement'].includes(
              command.id
            )
          )
          .map((command) => ({
            id: command.id,
            label: t(`editor.coreReview.${command.label}`),
            icon: reviewToolbarIcons[command.id],
            enabled: reviewCommandEnabled(command.id, coreReviewCommandState.value),
            run: () => handleCoreReviewCommand(command.id)
          })),
    focusMode: focus.value,
    // Core parses the document; Muya renders only the Core view's state.
    markdown: '',
    locale: getMuyaLocale(language.value),
    preferLooseListItem: preferLooseListItem.value,
    autoPairBracket: autoPairBracket.value,
    autoPairMarkdownSyntax: autoPairMarkdownSyntax.value,
    trimUnnecessaryCodeBlockEmptyLines: trimUnnecessaryCodeBlockEmptyLines.value,
    autoPairQuote: autoPairQuote.value,
    bulletListMarker: bulletListMarker.value,
    orderListDelimiter: orderListDelimiter.value,
    tabSize: tabSize.value,
    fontSize: fontSize.value,
    lineHeight: lineHeight.value,
    editorFontFamily: resolveEditorFont(editorFontFamily.value),
    codeFontSize: codeFontSize.value,
    codeFontFamily: resolveCodeFont(codeFontFamily.value),
    wrapCodeBlocks: wrapCodeBlocks.value,
    codeBlockLineNumbers: codeBlockLineNumbers.value,
    listIndentation: listIndentation.value,
    frontmatterType: frontmatterType.value,
    superSubScript: superSubScript.value,
    footnote: footnote.value,
    texMathDollars: texMathDollars.value,
    texMathGfm: texMathGfm.value,
    texMathSingleBackslash: texMathSingleBackslash.value,
    texMathDoubleBackslash: texMathDoubleBackslash.value,
    highlightSyntax: highlightSyntax.value,
    inlineDiff: inlineDiff.value,
    multilineBlockquote: multilineBlockquote.value,
    disableHtml: !isHtmlEnabled.value,
    softNewlineAsSpace: softNewlineAsSpace.value,
    hideQuickInsertHint: hideQuickInsertHint.value,
    hideLinkPopup: hideLinkPopup.value,
    autoCheck: autoCheck.value,
    sequenceTheme: toSequenceTheme(sequenceTheme.value),
    plantumlServer: preferencesStore.plantumlServer,
    spellcheckEnabled: spellcheckerEnabled.value,
    spellcheckHideMarks: spellcheckerNoUnderline.value,
    // Resolve the OS clipboard to a local file path on paste (image-from-file).
    clipboardFilePath: guessClipboardFilePath,
    // Read the OS clipboard's plain text for "Paste as Plain Text" (execCommand('paste') no longer fires).
    clipboardText: () => window.electron.clipboard.readText(),
    // Image-persist callbacks read by the engine's clipboard + drag-drop handlers
    // from `muya.options.*` (distinct from the ImageEditTool plugin option above).
    // Without these, local-file drag-drop, screenshot/binary clipboard paste, and
    // copy-to-assets on a pasted image file silently no-op or insert raw paths.
    imageAction: muyaImageAction,
    getPathForFile: (file: File) => window.electron.webUtils.getPathForFile(file)
  }

  if (/dark/i.test(theme.value)) {
    Object.assign(options, {
      mermaidTheme: 'dark',
      vegaTheme: 'dark'
    })
  } else {
    Object.assign(options, {
      mermaidTheme: 'default',
      vegaTheme: 'latimes'
    })
  }

  // `markRaw` keeps Vue from wrapping the Muya instance in a reactive Proxy.
  // The engine stores live DOM nodes and block-tree references and patches the
  // DOM via snabbdom; proxying them silently breaks identity checks so the
  // document tree never renders.
  const muya = markRaw(new Muya(ele, options))
  // The new engine requires an explicit init() after construction (it builds
  // the document tree and instantiates the registered UI plugins).
  if (props.corePlainTextView !== undefined) {
    installCoreMarkupPresentation(muya, props.corePlainTextView)
  }
  // A sidebar open can ask to keep focus in the file tree.
  const takeOpenFocus = editorStore.TAKE_OPEN_INTENT(currentFile.value?.pathname) !== false
  muya.init({ focus: takeOpenFocus })
  // A fresh Core mount has no editing authority until its lease and mappings
  // are installed below. Outgoing mounted views keep their captured lease.
  muya.setEditablePaths([])
  // Until a lease mounts this view's successor, nothing here is a document:
  // native clipboard and drops must not fall through to Muya's own parser.
  if (props.coreLease === undefined && editorSurfaceRef.value !== null) {
    uninstallUnboundDocumentGuard = installUnboundDocumentGuard(editorSurfaceRef.value)
  }
  editor.value = muya
  if (props.corePlainTextView !== undefined) {
    const view = props.corePlainTextView
    muya.setContent(asMuyaStates(structuredClone([...view.state])))
  }
  const container = getScrollContainer()!

  // Listen for language changes and update the engine locale.
  bus.on('language-changed', handleLanguageChanged)

  // Create spell check wrapper and enable spell checking if preferred.
  spellchecker = new SpellChecker(spellcheckerEnabled.value, spellcheckerLanguage.value)

  // Register command palette entry for switching spellchecker language.
  switchLanguageCommand = new SpellcheckerLanguageCommand(spellchecker)
  setTimeout(() => bus.emit('cmd::register-command', switchLanguageCommand), 100)

  if (typewriter.value) {
    scrollToCursor()
  }

  // listen for bus events.
  bus.on('invalidate-image-cache', handleInvalidateImageCache)
  bus.on('undo', handleUndo)
  bus.on('redo', handleRedo)
  bus.on('selectAll', handleSelectAll)
  bus.on('export', handleExport)
  bus.on('print-service-clearup', handlePrintServiceClearup)
  bus.on('paragraph', handleEditParagraph)
  bus.on('format', handleInlineFormat)
  bus.on('review-command', handleCoreReviewCommand)
  bus.on('review-context-request', handleCoreContextRequest)
  bus.on('review-context-action', handleCoreContextAction)
  bus.on('review-context-closed', handleCoreContextClosed)
  bus.on('searchValue', handleSearch)
  bus.on('replaceValue', handReplace)
  bus.on('find-action', handleFindAction)
  bus.on('insert-image', insertImage)
  bus.on('image-uploaded', handleUploadedImage)
  bus.on('flush-active-editor', flushActiveEditor)
  bus.on('editor-blur', blurEditor)
  bus.on('editor-focus', focusEditor)
  bus.on('copyAsRich', handleCopyPaste)
  bus.on('copyAsHtml', handleCopyPaste)
  bus.on('pasteAsPlainText', handleCopyPaste)
  bus.on('duplicate', handleParagraph)
  bus.on('createParagraph', handleParagraph)
  bus.on('deleteParagraph', handleParagraph)
  bus.on('insertParagraph', handleInsertParagraph)
  bus.on('scroll-to-header', scrollToHeader)
  bus.on('scroll-to-anchor-element', scrollToAnchorElement)
  bus.on('screenshot-captured', handleScreenShot)
  bus.on('show-command-palette', handleModalOpening)
  bus.on('switch-spellchecker-language', switchSpellcheckLanguage)
  bus.on('open-command-spellchecker-switch-language', openSpellcheckerLanguageCommand)
  bus.on('replace-misspelling', replaceMisspelling)

  if (props.coreLease !== undefined && props.corePlainTextView !== undefined) {
    const activeCoreLease = props.coreLease
    coreBoundLease = activeCoreLease
    coreAuthorityPerformanceTrace =
      props.corePerformanceTrace ??
      (window.electron.process.env.PERF_TESTING === 'true'
        ? createCoreAuthorityPerformanceTrace()
        : undefined)
    if (props.corePlainTextView.bindings.length > 0) {
      coreAuthorityPerformanceTrace?.record('first-editable-viewport', props.coreLease.documentId, {
        surface: 'wysiwyg'
      })
    }
    corePlainTextAdapter = createMuyaPlainTextCoreAdapter(
      props.corePlainTextView,
      props.coreLease.binding,
      coreAuthorityPerformanceTrace === undefined
        ? undefined
        : {
            documentId: props.coreLease.documentId,
            record: (event) => coreAuthorityPerformanceTrace?.capture(event)
          },
      props.coreLease.identity.revision,
      true
    )
    coreRecoveryDraftCapture = createMuyaRecoveryDraftCapture({
      muya,
      lease: activeCoreLease,
      pathname: currentFile.value?.pathname,
      nativeIntent: () => corePlainTextAdapter?.recoveryDraft(),
      acknowledgedView: () => coreAcknowledgedMarkupView ?? props.corePlainTextView
    })
    activeCoreLease.setRecoveryDraftCapture(captureRecoveryDraft)
    coreTrackChangesMode =
      props.trackChangesModeFor?.(props.coreLease.documentId) ?? createCoreTrackChangesMode()
    coreTrackChangesEnabled.value = coreTrackChangesMode.enabled()
    const detachDocumentEditing = muya.editor.bindDocumentEditing({
      emojiContext: (point) =>
        coreAcknowledgedMarkupView === undefined
          ? undefined
          : muyaEmojiContext(muya, coreAcknowledgedMarkupView, point),
      codeLanguage: (point) =>
        coreAcknowledgedMarkupView === undefined
          ? undefined
          : muyaCodeLanguage(muya, coreAcknowledgedMarkupView, point),
      activeFormats: (selection) =>
        coreAcknowledgedMarkupView === undefined
          ? []
          : muyaActiveFormats(muya, coreAcknowledgedMarkupView, selection),
      caretStep: (point, direction) =>
        coreAcknowledgedMarkupView === undefined
          ? undefined
          : muyaCaretStep(muya, coreAcknowledgedMarkupView, point, direction),
      lineEndStep: (point) =>
        coreAcknowledgedMarkupView === undefined
          ? undefined
          : muyaLineEndStep(muya, coreAcknowledgedMarkupView, point),
      backspaceRemovesGrapheme: (point) =>
        coreAcknowledgedMarkupView !== undefined &&
        muyaBackspaceRemovesGrapheme(muya, coreAcknowledgedMarkupView, point),
      prepareImage: async (operation, payload, prepare): Promise<boolean> => {
        const adapter = corePlainTextAdapter
        const lease = props.coreLease
        if (adapter === undefined || coreAcknowledgedMarkupView === undefined || coreDraftFrozen) {
          throw new Error('Image preparation has no active document owner')
        }
        const action = muyaFormatToModel(
          muya,
          coreAcknowledgedMarkupView,
          operation,
          coreTrackChangesMode?.enabled() ?? false
        )
        if (action.format !== 'image-properties') {
          throw new Error('Image preparation requires image properties')
        }
        const preparation = adapter.prepareImage(
          action,
          payload,
          reconcileWhileLeased(lease, 'Image'),
          operation.historyGroup
        )
        const presentImage = presentPendingClipboardImage(
          muya,
          preparation,
          () => (props.coreLease === lease ? coreAcknowledgedMarkupView : undefined),
          payload
        )
        try {
          const properties = await prepare((payload) => {
            preparation.capturePayload(payload)
            presentImage(payload)
          })
          if (properties === undefined) {
            preparation.cancel()
            return false
          }
          if (props.coreLease !== lease || coreAcknowledgedMarkupView === undefined) {
            throw new Error('Image owner changed during preparation')
          }
          const currentSelection = () => {
            if (props.coreLease !== lease || coreAcknowledgedMarkupView === undefined) {
              throw new Error('Prepared image selection owner changed')
            }
            const selection = muyaClipboardInputSelection(muya, coreAcknowledgedMarkupView)
            if (selection === undefined) throw new Error('Prepared image has no current selection')
            return selection
          }
          const result = await preparation.complete(properties, currentSelection)
          observeCoreInput(adapter, result.accepted ? 'accepted' : 'unsupported', action.tracked, {
            ...action,
            properties
          })
          return result.changed
        } catch (error) {
          preparation.fail(error instanceof Error ? error : new Error(String(error)))
          emit('core-fault', error)
          throw error
        }
      },
      prepareClipboard: async (
        selection,
        payload,
        prepare,
        blockPlacement,
        historyGroup
      ): Promise<boolean> => {
        const adapter = corePlainTextAdapter
        const lease = props.coreLease
        if (adapter === undefined || coreAcknowledgedMarkupView === undefined || coreDraftFrozen) {
          throw new Error('Clipboard preparation has no active document owner')
        }
        const action = muyaClipboardToModel(
          muya,
          coreAcknowledgedMarkupView,
          'kind' in selection
            ? { kind: 'table', operation: 'paste', selection, markdown: '' }
            : { kind: 'paste', selection, markdown: '' },
          coreTrackChangesMode?.enabled() ?? false
        )
        if (action.kind !== 'paste' && !(action.kind === 'table' && action.operation === 'paste')) {
          throw new Error('Clipboard preparation requires a paste')
        }
        const preparation = adapter.prepareClipboard(
          {
            ...action,
            ...(blockPlacement === undefined
              ? {}
              : {
                  blockPlacement,
                  currentSelection: muyaClipboardCurrentSelection(muya, coreAcknowledgedMarkupView)
                })
          },
          payload,
          reconcileWhileLeased(lease, 'Clipboard'),
          historyGroup
        )
        const presentImage = presentPendingClipboardImage(
          muya,
          preparation,
          () => (props.coreLease === lease ? coreAcknowledgedMarkupView : undefined),
          payload
        )
        try {
          const imported = await prepare((payload) => {
            preparation.capturePayload(payload)
            presentImage(payload)
          })
          const { markdown } = imported
          if (props.coreLease !== lease || coreAcknowledgedMarkupView === undefined) {
            throw new Error('Clipboard selection owner changed during preparation')
          }
          const currentSelection = () => {
            if (props.coreLease !== lease || coreAcknowledgedMarkupView === undefined) {
              throw new Error('Prepared clipboard selection owner changed')
            }
            const selection = muyaClipboardCurrentSelection(muya, coreAcknowledgedMarkupView)
            if (selection === undefined) {
              if (blockPlacement !== undefined) return undefined
              throw new Error('Prepared clipboard has no current selection')
            }
            return selection
          }
          const result = await preparation.complete(markdown, { ...imported, currentSelection })
          observeCoreInput(adapter, result.accepted ? 'accepted' : 'unsupported', action.tracked, {
            ...action,
            markdown
          })
          return result.changed
        } catch (error) {
          preparation.fail(error instanceof Error ? error : new Error(String(error)))
          emit('core-fault', error)
          throw error
        }
      },
      clipboard: (operation, present): boolean => {
        const adapter = corePlainTextAdapter
        if (adapter === undefined || coreDraftFrozen) return false
        invalidateCoreInputConsumers()
        const tracked = coreTrackChangesMode?.enabled() ?? false
        let result: ReturnType<MuyaPlainTextCoreAdapter['clipboard']> | undefined
        let presented = false
        const presentDraft = (): void => {
          if (presented) return
          presented = true
          present()
        }
        try {
          if (coreAcknowledgedMarkupView === undefined) {
            throw new Error('Core clipboard has no current model view')
          }
          const action = muyaClipboardToModel(muya, coreAcknowledgedMarkupView, operation, tracked)
          result = adapter.clipboard(action, reconcileCoreHistoryView, operation.historyGroup)
          if (!result.accepted) presentDraft()
          observeCoreInput(adapter, result.accepted ? 'accepted' : 'unsupported', tracked, action)
          return result.changed
        } catch (error) {
          if (!result?.accepted) presentDraft()
          emit('core-fault', error)
          return result?.changed ?? false
        }
      },
      compositionStart: (operation) => {
        try {
          if (corePlainTextAdapter === undefined || coreAcknowledgedMarkupView === undefined) {
            throw new Error('Core composition has no current model view')
          }
          invalidateCoreInputConsumers()
          corePlainTextAdapter.compositionStart(
            muyaInputToModel(muya, coreAcknowledgedMarkupView, operation)
          )
        } catch (error) {
          emit('core-fault', error)
        }
      },
      compositionUpdate: (data) => {
        try {
          corePlainTextAdapter?.compositionUpdate(data)
        } catch (error) {
          emit('core-fault', error)
        }
      },
      compositionEnd: (outcome, present) => {
        const adapter = corePlainTextAdapter
        const tracked = coreTrackChangesMode?.enabled() ?? false
        let result: ReturnType<MuyaPlainTextCoreAdapter['compositionEnd']> | undefined
        try {
          if (adapter === undefined) throw new Error('Core composition owner is unavailable')
          result = adapter.compositionEnd(outcome, reconcileCoreHistoryView, tracked)
          if (!result.accepted) present()
          observeCoreInput(adapter, result.accepted ? 'accepted' : 'unsupported', tracked, outcome)
          return result.changed
        } catch (error) {
          if (!result?.accepted) present()
          emit('core-fault', error)
          return result?.changed ?? false
        }
      },
      format: (operation): boolean => {
        const adapter = corePlainTextAdapter
        if (adapter === undefined || coreDraftFrozen) return false
        invalidateCoreInputConsumers()
        const tracked = coreTrackChangesMode?.enabled() ?? false
        try {
          if (coreAcknowledgedMarkupView === undefined) {
            throw new Error('Core native formatting has no current model view')
          }
          const action = muyaFormatToModel(muya, coreAcknowledgedMarkupView, operation, tracked)
          const result = adapter.format(action, reconcileCoreHistoryView, operation.historyGroup)
          observeCoreInput(adapter, result.accepted ? 'accepted' : 'unsupported', tracked, action)
          return result.changed
        } catch (error) {
          emit('core-fault', error)
          return false
        }
      },
      input: (operation: DocumentInput, present: () => void): boolean => {
        const adapter = corePlainTextAdapter
        if (adapter === undefined || coreDraftFrozen) return false
        invalidateCoreInputConsumers()
        const tracked = coreTrackChangesMode?.enabled() ?? false
        let result: ReturnType<MuyaPlainTextCoreAdapter['input']> | undefined
        let presented = false
        const presentDraft = (): void => {
          if (presented) return
          presented = true
          present()
        }
        try {
          if (coreAcknowledgedMarkupView === undefined) {
            throw new Error('Core native input has no current model view')
          }
          const input = muyaInputToModel(muya, coreAcknowledgedMarkupView, operation)
          result = adapter.input(input, reconcileCoreHistoryView, tracked)
          if (!result.accepted) presentDraft()
          observeCoreInput(adapter, !result.accepted ? 'unsupported' : 'accepted', tracked, input)
          return result.changed
        } catch (error) {
          // Only unaccepted input needs a raw draft. Accepted input already
          // belongs to the model even when presentation or fault handling fails.
          if (!result?.accepted) presentDraft()
          emit('core-fault', error)
          return result?.changed ?? false
        }
      }
    })
    activeCoreLease.onHandoff(detachDocumentEditing)
    applyCorePlainTextEditability(props.corePlainTextView)
    refreshCoreReviewItem('next', 0).catch((error) => {
      emit('core-fault', error)
    })
    coreCompositionRoot = editor.value.domNode as HTMLElement
    uninstallCoreInputDelivery = installMuyaInputDelivery(coreCompositionRoot, () => muya.flush())
    coreSearchPresentation = createProjectedSearchPresentation({
      bindings: () =>
        coreAcknowledgedMarkupView?.bindings ?? props.corePlainTextView?.bindings ?? [],
      blockAtPath: (path) => {
        const block = editor.value?.editor?.scrollPage?.queryBlock([...path])
        return block?.isContent() ? (block as ProjectedSearchPresentationBlock) : undefined
      }
    })
    coreSelectionClipboardAuthority = createProjectedSelectionClipboardAuthority({
      settle: () => corePlainTextAdapter?.settled() ?? Promise.resolve(),
      currentSelection: () => {
        if (coreAcknowledgedMarkupView === undefined) return undefined
        const range = muyaClipboardSelection(muya, coreAcknowledgedMarkupView)
        return range === undefined ||
          (!('kind' in range) && range.start === range.end) ||
          ('kind' in range && range.kind === 'model-text' && isEqual(range.anchor, range.focus))
          ? undefined
          : { range, revision: activeCoreLease.identity.revision }
      },
      selectionProjectionAtBarrier: (range) => activeCoreLease.selectionProjectionAtBarrier(range)
    })
    uninstallCoreSelectionClipboardGuard = installProjectedSelectionClipboardGuard(
      coreCompositionRoot,
      () => coreSelectionClipboardAuthority?.payload(),
      () => {
        editor.value?.editor.clipboard.cutHandler()
      },
      retryCoreSelectionClipboard
    )
    const stopObserving = props.coreLease.binding.observe((event) => {
      if (event.outcome.type !== 'applied') return
      coreConsumerInputEpoch += 1
      coreSearchProjectionEpoch = -1
      coreSearchSnapshot = undefined
      const documentId = activeCoreLease.documentId
      const identity = Object.freeze({
        generation: event.identity.generation,
        revision: event.outcome.revision
      })
      editorStore.LISTEN_FOR_CORE_CONTENT_CHANGE(documentId, identity)
      coreSearchPresentation?.clear()
      editorStore.UPDATE_CORE_CONSUMER_SEARCH(documentId, identity, {
        index: -1,
        matches: [],
        value: ''
      })
      coreReviewRefresh.invalidate()
      refreshCorePassiveConsumers()
      if (coreDisplayMode.value !== 'markup') {
        showCoreProjection(coreDisplayMode.value).catch((error) => emit('core-fault', error))
      }
    })
    props.coreLease.reconcileExternal(async (outcome) => {
      if (corePlainTextAdapter === undefined) throw new Error('Editor has no document owner')
      await corePlainTextAdapter.reconcileApplied(outcome, reconcileCoreHistoryView)
    })
    props.coreLease.settleView(
      async () => {
        // A barrier can run before native input delivery. Publish the batch while
        // this view still owns the document before reading acknowledged source.
        muya.flush()
        await corePlainTextAdapter?.settled()
      },
      () => {
        // Native commands awaiting Muya's change publication still belong to this
        // lease. Deliver them before the owner compares the final close identity.
        muya.flush()
        return corePlainTextAdapter?.isSettled() === true
      }
    )
    refreshCoreConsumerCount()
    props.coreLease.onHandoff(() => {
      releaseTableDialogTarget()
      uninstallCoreInputDelivery?.()
      uninstallCoreInputDelivery = undefined
      refreshCorePassiveConsumers.cancel()
      coreConsumerInputEpoch += 1
      coreReviewRefresh.dispose()
      uninstallCoreSelectionClipboardGuard?.()
      uninstallCoreSelectionClipboardGuard = undefined
      coreSelectionClipboardAuthority?.reset()
      coreSelectionClipboardAuthority = undefined
      coreSearchPresentation?.clear()
      coreSearchPresentation = undefined
      coreSearchProjectionEpoch = -1
      coreSearchSnapshot = undefined
      coreCompositionRoot = undefined
      stopObserving()
      corePlainTextAdapter?.dispose()
      corePlainTextAdapter = undefined
      coreRecoveryDraftCapture = undefined
      coreBoundLease = undefined
      coreAuthorityPerformanceTrace = undefined
      coreTrackChangesMode = undefined
      coreAuthorSelection.value = undefined
      coreAuthorInvocationSelection.value = undefined
      coreTrackChangesEnabled.value = false
      coreEditableBindingCount.value = 0
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
        ...(props.coreTestCrashCoreOwner === undefined
          ? {}
          : { crashCoreOwner: props.coreTestCrashCoreOwner }),
        ...(props.coreTestStaleNextTransaction === undefined
          ? {}
          : { staleNextTransaction: props.coreTestStaleNextTransaction }),
        async settled (): Promise<void> {
          await corePlainTextAdapter?.settled()
        },
        latest: () => latestCorePlainTextChange,
        ...corePerformanceTestBridge,
        performanceEvents: () => coreAuthorityPerformanceTrace?.events() ?? [],
        performanceSurface: () =>
          coreEditableBindingCount.value > 0 ? ('wysiwyg' as const) : ('source-required' as const),
        performanceStatus: () =>
          coreAuthorityPerformanceTrace?.status() ?? {
            accepting: false,
            eventCount: 0
          },
        selectPlainText (blockIndex: number, start: number, end: number): void {
          const block = editor.value?.editor?.scrollPage?.queryBlock([blockIndex, 'text'])
          if (block === undefined || block === null || !block.isContent?.()) {
            throw new Error('Core Muya paragraph content block is unavailable')
          }
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            end <= start ||
            end > block.text.length
          ) {
            throw new RangeError('Core Muya test selection is invalid')
          }
          block.setCursor(start, end)
          coreAuthorSelection.value = Object.freeze({
            anchor: Object.freeze({
              path: Object.freeze([blockIndex, 'text'] as const),
              offset: start
            }),
            focus: Object.freeze({
              path: Object.freeze([blockIndex, 'text'] as const),
              offset: end
            })
          })
          latestCorePlainTextChange = Object.freeze({
            result: 'selection',
            selection: coreAuthorSelection.value
          })
        },
        async authorPlainText (
          form: 'comment' | 'substitution',
          blockIndex: number,
          start: number,
          end: number,
          text: string
        ): Promise<void> {
          const adapter = corePlainTextAdapter
          if (adapter === undefined) throw new Error('Core Muya adapter is unavailable')
          const selection = Object.freeze({
            anchor: Object.freeze({
              path: Object.freeze([blockIndex, 'text'] as const),
              offset: start
            }),
            focus: Object.freeze({
              path: Object.freeze([blockIndex, 'text'] as const),
              offset: end
            })
          })
          const outcome = await adapter.author(form, selection, text, reconcileCoreHistoryView)
          latestCorePlainTextChange = Object.freeze({
            result: 'author',
            form,
            outcome,
            state: adapter.state()
          })
          if (outcome !== undefined) await refreshCoreReviewItem('next', 0)
        },
        inputPlainText (blockIndex: number, text: string, cursor: number): void {
          const block = muya.editor.scrollPage?.queryBlock([blockIndex, 'text'])
          if (block === undefined || block === null || !block.isContent?.()) {
            throw new Error('Core Muya paragraph content block is unavailable')
          }
          if (block.domNode == null) {
            throw new Error('Core Muya paragraph is not mounted')
          }
          muya.editor.activeContentBlock = block
          block.setCursor(0, block.text.length, true)
          block.domNode.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              data: text,
              inputType: 'insertReplacementText'
            })
          )
          const updated = muya.editor.scrollPage?.queryBlock([blockIndex, 'text'])
          if (updated?.isContent()) updated.setCursor(cursor, cursor, true)
          muya.flush()
        },
        composePlainText (blockIndex: number, candidates: readonly string[]): void {
          const block = muya.editor.scrollPage?.queryBlock([blockIndex, 'text'])
          if (
            block === undefined ||
            block === null ||
            !block.isContent?.() ||
            block.domNode == null ||
            candidates.length === 0 ||
            candidates.some((candidate) => candidate.length === 0)
          ) {
            throw new Error('Core Muya composition block is unavailable')
          }
          const initialText = block.text
          muya.editor.activeContentBlock = block
          block.setCursor(initialText.length, initialText.length)
          block.domNode.dispatchEvent(
            new CompositionEvent('compositionstart', {
              bubbles: true,
              data: ''
            })
          )
          for (const candidate of candidates) {
            const text = initialText + candidate
            block.domNode.textContent = text
            block.setCursor(text.length, text.length)
            block.domNode.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                data: candidate,
                inputType: 'insertCompositionText',
                isComposing: true
              })
            )
          }
          block.domNode.dispatchEvent(
            new CompositionEvent('compositionend', {
              bubbles: true,
              data: candidates[candidates.length - 1]
            })
          )
        },
        inputMathBlock (blockIndex: number, formula: string): void {
          const muyaEditor = muya.editor
          const paragraph = muyaEditor?.scrollPage?.queryBlock([blockIndex, 'text'])
          if (
            muyaEditor === undefined ||
            paragraph === undefined ||
            paragraph === null ||
            !paragraph.isContent?.() ||
            paragraph.domNode == null ||
            formula.length === 0
          ) {
            throw new Error('Core Muya math paragraph is unavailable')
          }
          muyaEditor.activeContentBlock = paragraph
          paragraph.setCursor(0, paragraph.text.length, true)
          paragraph.domNode.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              data: '$$',
              inputType: 'insertReplacementText'
            })
          )
          muyaEditor.selection.getSelection()?.anchor.block.domNode?.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertParagraph'
            })
          )
          muya.flush()
          const math = muyaEditor.scrollPage?.queryBlock([blockIndex, 'text'])
          if (math === undefined || math === null || !math.isContent?.() || math.domNode == null) {
            throw new Error('Core Muya math content is unavailable')
          }
          muyaEditor.activeContentBlock = math
          math.setCursor(0, math.text.length, true)
          math.domNode.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              data: formula,
              inputType: 'insertReplacementText'
            })
          )
          muya.flush()
        },
        async pasteMarkdownTable (blockIndex: number, markdown: string): Promise<void> {
          const muyaEditor = muya.editor
          const block = muyaEditor?.scrollPage?.queryBlock([blockIndex, 'text'])
          if (
            muyaEditor === undefined ||
            block === undefined ||
            block === null ||
            !block.isContent?.() ||
            markdown.length === 0
          ) {
            throw new Error('Core Muya table-paste paragraph is unavailable')
          }
          block.setCursor(0, block.text.length, true)
          const event = {
            preventDefault () {},
            stopPropagation () {},
            clipboardData: {
              getData: (type: string) => (type === 'text/plain' ? markdown : ''),
              files: [],
              items: []
            }
          } as unknown as ClipboardEvent
          await muyaEditor.clipboard.pasteHandler(event, markdown, '')
          muya.flush()
        },
        replacePlainTextAcrossBlocks (
          startBlockIndex: number,
          startOffset: number,
          endBlockIndex: number,
          endOffset: number,
          text: string
        ): void {
          const muyaEditor = muya.editor
          const startBlock = muyaEditor?.scrollPage?.queryBlock([startBlockIndex, 'text'])
          const endBlock = muyaEditor?.scrollPage?.queryBlock([endBlockIndex, 'text'])
          if (
            muyaEditor === undefined ||
            startBlock === undefined ||
            startBlock === null ||
            !startBlock.isContent?.() ||
            endBlock === undefined ||
            endBlock === null ||
            !endBlock.isContent?.() ||
            !Number.isSafeInteger(startOffset) ||
            startOffset < 0 ||
            startOffset > startBlock.text.length ||
            !Number.isSafeInteger(endOffset) ||
            endOffset < 0 ||
            endOffset > endBlock.text.length ||
            startBlockIndex >= endBlockIndex
          ) {
            throw new Error('Core Muya cross-block selection is unavailable')
          }
          muyaEditor.selection.setSelection(
            { block: startBlock, path: startBlock.path, offset: startOffset },
            { block: endBlock, path: endBlock.path, offset: endOffset }
          )
          startBlock.domNode?.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertReplacementText',
              data: text
            })
          )
          muya.flush()
        }
      })
    }
  }

  editor.value.on('json-change', (change: unknown) => {
    const adapter = corePlainTextAdapter
    if (coreDraftFrozen || adapter === undefined) return
    // Applying a document operation patches its view through the native API.
    // The originating model operation already owns submission and observation.
    if (
      change !== null &&
      typeof change === 'object' &&
      (change as { source?: unknown }).source === 'api'
    ) {
      return
    }
    invalidateCoreInputConsumers()
    // User edits must enter the common model before touching presentation.
    // An unexpected native mutation is a recoverable fault, never another
    // opportunity to infer the user's action from a resulting JSON diff.
    captureRecoveryDraft(new Error('Native document mutation bypassed the document model'))
    observeCoreInput(adapter, 'unsupported', coreTrackChangesMode?.enabled() ?? false, change)
  })
  // The engine does not emit `scroll`; listen on the scroll container directly
  // so the desktop can persist each tab's scroll position.
  scrollHandler = () => {
    if (currentFile.value && ownsCurrentDocument()) {
      editorStore.updateScrollPosition(currentFile.value.id, container.scrollTop)
    }
  }
  container.addEventListener('scroll', scrollHandler, { passive: true })

  // Core owns the anchor spelling; native paths identify the clicked heading.
  editor.value.on(
    'heading-copy-link',
    ({ path }: { path: readonly (number | string)[] }) => {
      const lease = props.coreLease
      if (lease === undefined) return
      const epoch = coreConsumerInputEpoch
      refreshCoreConsumerCount().then((refreshed) => {
        if (!refreshed || props.coreLease !== lease || epoch !== coreConsumerInputEpoch) return
        const item = editorStore.listToc.find(
          (entry) => JSON.stringify(entry.nativePath) === JSON.stringify(path)
        )
        if (item?.slug !== undefined) editorStore.copyGithubSlug(item.slug)
      })
    }
  )

  editor.value.on(
    'format-click',
    ({ event, formatType, data }: { event: MouseEvent; formatType: string; data: unknown }) => {
      const ctrlOrMeta = (isMac && event.metaKey) || (!isMac && event.ctrlKey)
      if (formatType === 'link' && ctrlOrMeta) {
        const link = data as { href: string; [key: string]: unknown }
        const follow = () =>
          editorStore.FORMAT_LINK_CLICK({
            data: link,
            dirname: window.DIRNAME
          })
        const lease = props.coreLease
        if (lease !== undefined && link.href.startsWith('#')) {
          // Explicit navigation cannot rely on the passive outline having
          // refreshed after opening or editing the document.
          corePlainTextAdapter
            ?.settled()
            .then(() => refreshCoreConsumerCount())
            .then((refreshed) => {
              if (refreshed && props.coreLease === lease) follow()
            })
            .catch((error) => {
              if (props.coreLease === lease) emit('core-fault', error)
            })
        } else follow()
      } else if (formatType === 'image' && ctrlOrMeta) {
        mediaViewer.value?.openImage(data as string)
      }
    }
  )

  editor.value.on('preview-image', ({ data }: { data: string }) => {
    mediaViewer.value?.openImage(data)
  })

  // A preference toggle can change the result set under an open find bar; its
  // count/index come from a snapshot the search handlers own.
  editor.value.on('search-refreshed', (result: unknown) => {
    editorStore.SEARCH(toSearchMatches(result))
    scrollToHighlight()
  })

  editor.value.on('preview-diagram', (payload: IPreviewDiagramPayload) => {
    const options = editor.value?.options
    mediaViewer.value?.openDiagram(
      {
        type: payload.type,
        code: payload.code,
        preview: payload.preview,
        mermaidTheme: options?.mermaidTheme ?? 'default',
        vegaTheme: options?.vegaTheme ?? 'latimes',
        plantumlServer: options?.plantumlServer ?? '',
        sequenceTheme: toSequenceTheme(sequenceTheme.value)
      },
      payload.label
    )
  })

  editor.value.on('selection-change', (changes: MuyaChange) => {
    const y = (changes.cursorCoords?.y ?? null) as number | null
    if (y != null) {
      // Before the scrolling below: a 0-duration `animatedScrollTo` assigns
      // `scrollTop` at once, moving the headings out from under `y`.
      updateActiveHeading(y)

      if (typewriter.value) {
        const startPosition = container.scrollTop
        const toPosition = startPosition + y - STANDAR_Y

        // Prevent micro shakes and unnecessary scrolling.
        if (Math.abs(startPosition - toPosition) > 2) {
          animatedScrollTo(container, toPosition, 100)
        }
      } else {
        const target = caretScrollTarget(
          {
            top: container.getBoundingClientRect().top,
            height: container.clientHeight,
            scrollTop: container.scrollTop
          },
          y
        )
        if (Math.abs(target - container.scrollTop) > 2) animatedScrollTo(container, target, 0)
      }
    }

    const caretOf = (change: unknown) => {
      const { anchorPath, anchor, focusPath, focus } = (change ?? {}) as MuyaChange
      return [anchorPath, anchor?.offset, focusPath, focus?.offset]
    }
    // A re-render, as a language change causes, reports the same selection
    // again; only a moved selection leaves the review target.
    const selectionMoved = !isEqual(caretOf(selectionChange.value), caretOf(changes))
    selectionChange.value = changes
    if (!sourceCode.value && editor.value) updateSelectionWordCount(editor.value)
    // The current rendered annotation and acknowledged leaf own its position.
    // Sidebar clicks do not change the document caret, so explicit parent
    // navigation remains selected until the user moves the document selection.
    if (coreDisplayMode.value === 'markup' && Array.isArray(changes.anchorPath)) {
      const node = window.getSelection()?.anchorNode
      const element = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(
        '[data-critic-start]'
      )
      const path = JSON.stringify(changes.anchorPath)
      const binding = coreMarkupBindingAt(path)
      const offset = changes.anchor?.offset
      // A suggestion just made, with the caret at its edge, is the current item
      // even before the review list publishes it.
      const start = element && binding
        ? binding.sourceRange.start + Number(element.dataset.criticStart)
        : selectionMoved && typeof offset === 'number' ? coreItemAtCaret(path, offset) : undefined
      if (start !== undefined) {
        selectCoreAnnotationAt(start, false)
      } else if (selectionMoved) {
        clearCoreReviewTarget()
      }
      if (selectionMoved && typeof offset === 'number') pendingCoreCaret = { path, offset }
    }
    if (corePlainTextAdapter !== undefined) {
      coreSelectionClipboardAuthority?.reset()
    }
    if (
      corePlainTextAdapter !== undefined &&
      Array.isArray(changes.anchorPath) &&
      Array.isArray(changes.focusPath) &&
      typeof changes.anchor?.offset === 'number' &&
      typeof changes.focus?.offset === 'number' &&
      (changes.anchor.offset !== changes.focus.offset ||
        changes.anchorPath.join('/') !== changes.focusPath.join('/'))
    ) {
      coreAuthorSelection.value = Object.freeze({
        anchor: Object.freeze({
          path: Object.freeze([...changes.anchorPath]),
          offset: changes.anchor.offset
        }),
        focus: Object.freeze({
          path: Object.freeze([...changes.focusPath]),
          offset: changes.focus.offset
        })
      })
      prepareCoreSelectionClipboard('rich').catch((error) => {
        emit('core-fault', error)
      })
    } else if (
      corePlainTextAdapter !== undefined &&
      coreAuthorInvocationSelection.value === undefined
    ) {
      coreAuthorSelection.value = undefined
    }
    // Persist the caret with the tab's buffered state. Cheap: serialized caret only.
    if (currentFile.value?.id && editor.value && ownsCurrentDocument()) {
      editorStore.PERSIST_CURSOR(currentFile.value.id, serializeCursor(editor.value.getSelection()))
    }
    pushSelectionMenuState(changes)
  })

  const freshDocument =
    props.coreLease !== undefined && props.claimFreshDocument?.(props.coreLease.documentId) === true
  // Restore the incoming Core caret only after selection observers are live;
  // its native event also restores block-specific menu and toolbar state.
  if (props.coreLease !== undefined && props.initialDocumentSelection !== undefined) {
    if (coreAcknowledgedMarkupView === undefined) {
      throw new Error('Core caret has no current model view')
    }
    restoreMuyaDocumentSelection(muya, coreAcknowledgedMarkupView, props.initialDocumentSelection, {
      projectSource: true
    })
  } else if (freshDocument) {
    // A newly opened document is ready to type into at the start of its visible
    // text, after a first heading's hidden `#`s. This view is never hidden, so it
    // takes that focus now, through the native boundary its model selection is
    // read from.
    const first = muya.editor.scrollPage?.firstContentInDescendant()
    const start =
      first === undefined || first === null
        ? null
        : muya.editor.selection.getDOMPoint({
          path: [...first.path],
          offset: first.hiddenLeadingSyntaxEnd()
        })
    muya.domNode.focus({ preventScroll: true })
    if (start !== null) muya.editor.selection.setDOMSelection(start, start)
  }

  // Core replaces the mounted view on handoff. Restore the tab's scroll position
  // after caret placement without letting a retired view move the incoming
  // document's viewport.
  if (coreViewDocumentId !== undefined) {
    requestAnimationFrame(() => {
      if (ownsCurrentDocument() && container.isConnected) {
        container.scrollTop = initialCoreScrollTop
      }
    })
  }

  document.addEventListener('keyup', keyup)

  setEditorWidth(editorLineWidth.value)
})

onBeforeUnmount(() => {
  releaseTableDialogTarget()
  uninstallCoreInputDelivery?.()
  uninstallCoreInputDelivery = undefined
  refreshCorePassiveConsumers.cancel()
  coreConsumerInputEpoch += 1
  coreReviewRefresh.dispose()
  if (props.coreLease !== undefined) delete window.__marktextDocumentCore
  uninstallCoreSelectionClipboardGuard?.()
  uninstallCoreSelectionClipboardGuard = undefined
  uninstallUnboundDocumentGuard?.()
  uninstallUnboundDocumentGuard = undefined
  coreSelectionClipboardAuthority?.reset()
  coreSelectionClipboardAuthority = undefined
  coreSearchPresentation?.clear()
  coreSearchPresentation = undefined
  coreSearchProjectionEpoch = -1
  coreSearchSnapshot = undefined

  bus.off('invalidate-image-cache', handleInvalidateImageCache)
  bus.off('undo', handleUndo)
  bus.off('redo', handleRedo)
  bus.off('selectAll', handleSelectAll)
  bus.off('export', handleExport)
  bus.off('print-service-clearup', handlePrintServiceClearup)
  bus.off('paragraph', handleEditParagraph)
  bus.off('format', handleInlineFormat)
  bus.off('review-command', handleCoreReviewCommand)
  bus.off('review-context-request', handleCoreContextRequest)
  bus.off('review-context-action', handleCoreContextAction)
  bus.off('review-context-closed', handleCoreContextClosed)
  coreContextSession.clear()
  bus.off('searchValue', handleSearch)
  bus.off('replaceValue', handReplace)
  bus.off('find-action', handleFindAction)
  bus.off('insert-image', insertImage)
  bus.off('image-uploaded', handleUploadedImage)
  bus.off('flush-active-editor', flushActiveEditor)
  bus.off('editor-blur', blurEditor)
  bus.off('editor-focus', focusEditor)
  bus.off('copyAsRich', handleCopyPaste)
  bus.off('copyAsHtml', handleCopyPaste)
  bus.off('pasteAsPlainText', handleCopyPaste)
  bus.off('duplicate', handleParagraph)
  bus.off('createParagraph', handleParagraph)
  bus.off('deleteParagraph', handleParagraph)
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
  editorStore.SET_SELECTION_WORD_COUNT(null)

  // Remove the manual scroll listener; engine `on(...)` listeners are torn down
  // by `destroy()` → `eventCenter.unsubscribeAll()`.
  if (scrollHandler && editor.value) {
    const container = getScrollContainer()
    container?.removeEventListener('scroll', scrollHandler)
  }
  scrollHandler = null

  coreReviewLocatedNode?.classList.remove('core-review-current-block')

  if (editor.value) {
    editor.value.destroy()
    editor.value = null
  }
})
</script>

<style>
.editor-wrapper [data-critic-kind='addition'],
.editor-wrapper [data-critic-kind='substitution'][data-critic-arm='new'] {
  color: var(--editor-color, inherit);
  background: color-mix(in srgb, #3b9959 18%, transparent);
  text-decoration: underline;
  text-decoration-color: #3b9959;
}

.editor-wrapper [data-critic-kind='deletion'],
.editor-wrapper [data-critic-kind='substitution'][data-critic-arm='old'] {
  color: var(--editor-color, inherit);
  background: color-mix(in srgb, #ce5555 14%, transparent);
  text-decoration: line-through;
  text-decoration-color: #ce5555;
}

.editor-wrapper [data-critic-kind='highlight'] {
  background: color-mix(in srgb, #d4ac33 26%, transparent);
}

/* ... existing style ... */
.editor-wrapper {
  height: 100%;
  position: relative;
  /* Contain the editor's z-indexed children (e.g. the math/diagram preview
     popups at z-index 10000) in their own stacking context so they cannot
     paint above modal dialogs rendered outside the editor. */
  isolation: isolate;
  flex: 1;
  color: var(--editorColor);
}

.ag-insert-table-dialog {
  & .el-form--inline {
    display: flex;
    flex-wrap: nowrap;
    justify-content: space-between;
    align-items: center;
  }
  & .el-form--inline .el-form-item {
    margin-right: 0;
  }
  & .el-input-number {
    width: 100px;
    min-width: 0;
  }
  & .el-button {
    font-size: 13px;
    width: 70px;
  }
}

.editor-wrapper.source {
  position: absolute;
  z-index: -1;
  top: 0;
  left: 0;
  overflow: hidden;
  /* `z-index: -1` only hides the editor visually; `document.elementsFromPoint`
     ignores stacking, so muya's mousemove-driven float tools (front button/menu,
     table drag/column toolbars, preview toolbar) still re-trigger over the source
     editor. Drop the subtree from hit-testing too so they cannot (#4731). */
  pointer-events: none;
}

/* `document.elementsFromPoint` ignores stacking, so muya's mousemove-driven
   float tools would keep re-triggering under the open viewer (#4731 again). */
.editor-wrapper.viewer-open .editor-component {
  pointer-events: none;
}

.editor-component {
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  cursor: default;
  overflow-anchor: none !important;
}

.editor-component .mu-container {
  padding-top: 20px;
  padding-bottom: 100vh;
}

.core-review-panel-content {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--sideBarColor);
  font-size: 13px;
}
.core-review-controls {
  flex: none;
  padding: 0 12px;
}
.core-review-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 12px 16px;
}
.core-review-hint {
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.7;
  margin: 12px 0;
}
.core-review-views {
  display: flex;
  border: 1px solid var(--floatBorderColor);
  border-radius: 5px;
}
.core-review-panel-content .core-review-views button {
  flex: 1 1 0;
  min-width: 0;
  padding: 6px 2px;
  font-size: 11px;
  border: 0;
}
.core-reader-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--editorColor);
  background: var(--itemBgColor);
  border-bottom: 1px solid var(--floatBorderColor);
}
.core-review-bulk {
  grid-column: 1 / -1;
  display: flex;
  gap: 6px;
  border-top: 1px solid var(--floatBorderColor);
  padding-top: 12px;
  margin-top: 6px;
}
.core-review-bulk button {
  flex: 1;
}
.core-track-toggle {
  width: 100%;
  margin-top: 8px;
}
.core-review-position {
  width: 100%;
  font-size: 12px;
  opacity: 0.7;
}
.core-review-panel-content button {
  font: inherit;
  font-size: 12px;
  min-width: 0;
  box-sizing: border-box;
  white-space: normal;
  overflow-wrap: anywhere;
}
.core-review-panel-content button:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: -2px;
}
.core-review-panel-content button[aria-pressed='true'] {
  color: var(--themeColor);
  background: var(--itemBgColor);
  border-color: var(--themeColor);
}
.core-review-enabled {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  box-sizing: border-box;
}
.editor-surface {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.core-review-enabled > .editor-surface,
.core-review-enabled > .core-document-projection {
  grid-row: 1;
  grid-column: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
}
.core-review-enabled > .core-document-projection {
  font-size: v-bind("fontSize + 'px'");
  line-height: v-bind(lineHeight);
  font-family: v-bind('resolveEditorFont(editorFontFamily)');
}
.core-review-enabled > .search-bar {
  z-index: 3;
}
.editor-surface .core-review-current-block {
  outline: 2px solid var(--themeColor);
  outline-offset: 5px;
  border-radius: 2px;
}

.typewriter .editor-component {
  padding-top: calc(50vh - 136px);
  padding-bottom: calc(50vh - 54px);
}

</style>

<style>
.editor-surface .mu-critic-comment-marker {
  display: inline-block;
  width: 14px;
  height: 12px;
  margin: 0 4px;
  border: 1.5px solid var(--themeColor);
  border-radius: 3px;
  vertical-align: middle;
  cursor: pointer;
  position: relative;
  user-select: none;
}
.editor-surface .mu-critic-comment-marker::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 2px;
  width: 4px;
  height: 4px;
  border-left: 1.5px solid var(--themeColor);
  transform: skewY(-40deg);
}
.editor-surface .mu-critic-comment-marker:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: 3px;
}
.core-review-navigation {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
}
.core-review-navigation .core-review-position {
  order: -1;
  flex-basis: 100%;
}
.core-review-navigation button {
  flex: 1;
}
.core-review-item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 4px;
}
.core-review-item-actions button {
  flex: 1 1 auto;
  min-width: min-content;
  overflow-wrap: normal;
}
</style>

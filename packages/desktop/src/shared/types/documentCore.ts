import type {
  ClipboardConsumer,
  ClipboardView,
  ConsumerView,
  CriticMarkupProjection,
  DocumentCoreMarkdownOptionPatch,
  DocumentFacts,
  EditorIntent,
  InitialModelSelection,
  MarkupCoordinateMapV1,
  MarkupModelSelection,
  MarkupRenderBlock,
  ModelRange,
  NodeId,
  ParseConfiguration,
  ResourceDiagnostic,
  ReviewIndex,
  RevisionSemanticHashV1,
  SourceModelSelection,
  SourceHashV1,
  WireEnvelopeV1,
  WireMemberNameV1
} from '@marktext/document-core'
import { validateAndFreezeParseConfiguration } from '@marktext/document-core'

interface DocumentCoreClipboardWriteRequestBase {
  readonly documentId: string
  readonly revisionId: string
}

export type DocumentCoreClipboardWriteRequest =
  | Readonly<DocumentCoreClipboardWriteRequestBase & {
    readonly view: ClipboardView
    readonly consumer: Exclude<ClipboardConsumer, 'copy-heading-link'>
    readonly selection: Readonly<{ start: number; end: number }>
  }>
  | Readonly<DocumentCoreClipboardWriteRequestBase & {
    readonly view: ConsumerView
    readonly consumer: 'copy-heading-link'
    readonly targetNodeId: NodeId
  }>

export type DocumentCoreClipboardWriteReceipt =
  | Readonly<{
    readonly kind: 'written'
    readonly consumer: Exclude<
      DocumentCoreClipboardWriteRequest['consumer'],
      'cut' | 'cut-table'
    >
  }>
  | Readonly<{
    readonly kind: 'cut-committed'
    readonly consumer: Extract<ClipboardConsumer, 'cut' | 'cut-table'>
    readonly publication: DocumentCorePublication
  }>
  | Readonly<{
    readonly kind: 'unavailable'
    readonly reason: 'source-only-revision'
  }>
  | Readonly<{
    readonly kind: 'disabled'
    readonly consumer: Extract<ClipboardConsumer, 'cut' | 'cut-table'>
    readonly reason: 'read-only-view'
  }>

/**
 * Closed navigation request. The renderer names only the document/revision and
 * parser-issued semantic node it displayed; URL and native-path authority stay
 * in the worker/main process.
 */
export interface DocumentCoreOpenLinkRequest {
  readonly documentId: string
  readonly revisionId: string
  readonly targetNodeId: NodeId
}

export type DocumentCoreOpenLinkReceipt =
  | Readonly<{
    readonly kind: 'anchor'
    readonly fragment: string
  }>
  | Readonly<{
    readonly kind: 'opened'
    readonly target: 'external' | 'markdown' | 'path'
  }>
  | Readonly<{ readonly kind: 'cancelled' }>
  | Readonly<{
    readonly kind: 'unavailable'
    readonly reason:
      | 'empty-destination'
      | 'unsupported-scheme'
      | 'document-path-unavailable'
      | 'invalid-destination'
  }>

export interface DocumentCoreStartOpenRequest {
  readonly documentId: string
  readonly durabilityKey: string
  readonly sourceLength: number
  readonly parseConfiguration: ParseConfiguration
}

export interface DocumentCoreOpenTicketReceipt {
  readonly schema: 'document-core-open-ticket-1'
  readonly documentId: string
  readonly ticketId: string
  readonly chunkUnits: number
  readonly executionThreadId: number
  readonly requiresSource: boolean
}

export interface DocumentCoreAppendOpenChunkReceipt {
  readonly schema: 'document-core-open-chunk-receipt-1'
  readonly ordinal: number
  readonly mainStageMs: number
}

export type DocumentCoreCancelOpenResult =
  | Readonly<{
    readonly kind: 'cancelled'
    readonly ticketId: string
    readonly checkpointObserved: boolean
  }>
  | Readonly<{
    readonly kind: 'already-terminal'
    readonly ticketId: string
  }>

export interface DocumentCoreMainDispatchRequest {
  readonly documentId: string
  readonly baseSnapshotId: string
  readonly intent: EditorIntent
}

export interface DocumentCoreReconfigureMarkdownOptionsRequest {
  readonly documentId: string
  readonly baseSnapshotId: string
  readonly patch: DocumentCoreMarkdownOptionPatch
}

export interface DocumentCoreDispatchTicketReceipt {
  readonly schema: 'document-core-dispatch-ticket-1'
  readonly documentId: string
  readonly baseSnapshotId: string
  readonly ticketId: string
  readonly clientSequence: number
}

export interface DocumentCoreCompleteDispatchRequest {
  readonly documentId: string
  readonly ticketId: string
}

export interface DocumentCoreCancelDispatchRequest {
  readonly documentId: string
  readonly ticketId: string
}

export interface DocumentCoreAwaitSettledRequest {
  readonly documentId: string
}

export interface DocumentCoreSettledReceipt {
  readonly kind: 'settled'
}

export interface DocumentCoreMainSelectRequest {
  readonly documentId: string
  readonly baseSnapshotId: string
  readonly view: 'markup' | 'source'
  readonly selection: InitialModelSelection
}

/**
 * Main-owned undo/redo and persistence state for one immutable document head.
 *
 * Identities name history entries, not source text, and remain stable while
 * undo/redo revisits an entry. `dirty` is independent of them: it compares the
 * head's source bytes against the bytes last persisted, so a document edited
 * back to its saved content is clean even though its head has moved on. The
 * two therefore disagree legitimately and must not be cross-checked.
 */
export interface DocumentCoreHistoryState {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly dirty: boolean
  readonly headIdentity: string
  readonly savedIdentity: string
}

export interface DocumentCoreSourceEditDelta {
  readonly start: number
  readonly end: number
  readonly insert: string
}

export type DocumentCoreSessionSourceDelta =
  | Readonly<{
    readonly kind: 'full'
    readonly text: string
  }>
  | Readonly<{
    readonly kind: 'retain'
    readonly baseRevisionId: string
    readonly baseSourceHash: SourceHashV1
    readonly baseSemanticHash: RevisionSemanticHashV1
    readonly baseSourceLength: number
  }>
  | Readonly<{
    readonly kind: 'edit'
    readonly baseRevisionId: string
    readonly baseSourceHash: SourceHashV1
    readonly baseSemanticHash: RevisionSemanticHashV1
    readonly baseSourceLength: number
    readonly edits: readonly DocumentCoreSourceEditDelta[]
  }>

export function freezeDocumentCoreHistoryState(
  value: unknown
): DocumentCoreHistoryState {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('canUndo' in value) ||
    typeof value.canUndo !== 'boolean' ||
    !('canRedo' in value) ||
    typeof value.canRedo !== 'boolean' ||
    !('dirty' in value) ||
    typeof value.dirty !== 'boolean' ||
    !('headIdentity' in value) ||
    typeof value.headIdentity !== 'string' ||
    value.headIdentity.length === 0 ||
    !('savedIdentity' in value) ||
    typeof value.savedIdentity !== 'string' ||
    value.savedIdentity.length === 0
    // `dirty` is content-addressed, not identity-derived: a document edited
    // back to the bytes it was saved with is clean even though its head is a
    // later revision than the one persisted. Cross-checking the flag against
    // identity equality rejects that legitimate state, so the flag is carried
    // as main reported it.
  ) {
    throw new TypeError('Invalid document-core history state')
  }
  return Object.freeze({
    canUndo: value.canUndo,
    canRedo: value.canRedo,
    dirty: value.dirty,
    headIdentity: value.headIdentity,
    savedIdentity: value.savedIdentity
  })
}

export function freezeDocumentCoreParseConfiguration(
  value: unknown
): ParseConfiguration {
  return validateAndFreezeParseConfiguration(value as ParseConfiguration)
}

interface PortableSnapshotBase {
  readonly schema: 'document-core-portable-snapshot-1'
  readonly snapshotId: string
  readonly revisionId: string
  readonly source: string
  readonly sourceHash: SourceHashV1
  readonly semanticHash: RevisionSemanticHashV1
  readonly parseConfiguration: ParseConfiguration
  readonly historyState: DocumentCoreHistoryState
  readonly facts: DocumentFacts
  readonly sourceSelection: SourceModelSelection
}

export interface PortableCompleteSnapshot extends PortableSnapshotBase {
  readonly kind: 'complete'
  readonly projection: CriticMarkupProjection
  readonly selection: MarkupModelSelection
  readonly trackChanges: boolean
  readonly reviewIndex: ReviewIndex
  readonly markupModelLength: number
  readonly modelText: string
  /** Retained editable-Markup map; modelText may be a clean projection. */
  readonly markupCoordinateMap: MarkupCoordinateMapV1
  readonly blocks: readonly MarkupRenderBlock[]
  readonly outline: readonly {
    readonly nodeId: NodeId
    readonly level: number
    readonly content: string
    readonly slug: string
    readonly sourceOffset: number
  }[]
  readonly listItems: readonly ModelRange[]
}

export interface PortableSourceOnlySnapshot extends PortableSnapshotBase {
  readonly kind: 'source-only'
  readonly selection: SourceModelSelection
  readonly modelText: string
  readonly blocks: readonly []
  readonly fatalDiagnostic: ResourceDiagnostic
}

export type DocumentCorePortableSnapshot =
  | PortableCompleteSnapshot
  | PortableSourceOnlySnapshot

export type DocumentCoreExecutionOperationKind =
  | 'open'
  | 'recovery'
  | 'attach'
  | 'reload'
  | 'dispatch'
  | 'reconfigure'
  | 'select'

export interface DocumentCoreExecutionReport {
  readonly schema: 'document-core-execution-report-1'
  readonly executionThreadId: number
  readonly checkpointCount: number
  readonly sourceCheckpointCount: number
  readonly logicalNodeCheckpointCount: number
  readonly sourceCheckpointInterval: number
  readonly logicalNodeCheckpointInterval: number
  readonly sourceUnits: number
  readonly logicalNodes: number
  readonly maximumSourceDelta: number
  readonly maximumLogicalNodeDelta: number
  readonly cancellationObserved: boolean
  readonly workerHeapUsedBytes: number
  readonly workerHeapTotalBytes: number
  readonly workerExternalBytes: number
  readonly workerArrayBuffersBytes: number
  /** Worker threads share this process-wide RSS with Electron main. */
  readonly workerProcessRssBytes: number
  readonly serializedPayloadBytes: number
  readonly serializedMemberBytes: Readonly<
    Partial<Record<WireMemberNameV1, number>>
  >
  /** The publication-producing operation measured independently of lifetime totals. */
  readonly operationKind: DocumentCoreExecutionOperationKind
  readonly operationCheckpointCount: number
  readonly operationSourceCheckpointCount: number
  readonly operationLogicalNodeCheckpointCount: number
  readonly operationSourceUnits: number
  readonly operationLogicalNodes: number
  readonly operationMaximumSourceDelta: number
  readonly operationMaximumLogicalNodeDelta: number
  /** Worker wall time from operation admission through encoded publication. */
  readonly operationElapsedMs: number
  /** Largest wall interval between production parser checkpoints. */
  readonly operationMaximumCheckpointGapMs: number
  /** Largest event-loop heartbeat gap on the worker that owns the operation. */
  readonly operationOwningThreadStallMs: number
  /** Exact physical parser work attributed to this operation. */
  readonly operationIntrinsicSourceTraversals: number
  readonly operationIntrinsicSourceUnits: number
  readonly operationForkAstRegionEmissions: number
  readonly operationForkAstRegionUnits: number
  readonly operationForkAstRegionReuses: number
  /** Regions carried verbatim by splice provenance instead of re-emission. */
  readonly operationForkAstRegionProvenanceReuses: number
}

/**
 * Terminal receipt for a newly admitted source.
 *
 * Admission establishes the main-owned session and durable head without
 * building a renderer publication that would be discarded before attachment.
 */
export interface DocumentCoreOpenCompletion {
  readonly schema: 'document-core-open-completion-1'
  readonly snapshotId: string
  readonly execution: DocumentCoreExecutionReport
}

export interface DocumentCoreReloadCompletion {
  readonly schema: 'document-core-reload-completion-1'
  readonly kind: 'reloaded' | 'unchanged' | 'conflict'
  readonly snapshotId: string
  readonly revisionId: string
  readonly historyState: DocumentCoreHistoryState
  readonly execution: DocumentCoreExecutionReport
}

export interface DocumentCorePublication {
  /** Main-owned binding for the exact document whose head this can mount. */
  readonly documentId: string
  readonly baseSnapshotId: string
  readonly envelope: WireEnvelopeV1
  readonly execution: DocumentCoreExecutionReport
}

export interface DocumentCorePersistenceLeaseResult {
  readonly leaseId: string
  readonly revisionId: string
  readonly sourceHash: SourceHashV1
  readonly source: string
  readonly facts: DocumentFacts
  readonly historyState: DocumentCoreHistoryState
}

/**
 * Renderer lifecycle input is semantic and deliberately cannot enumerate the
 * documents that are dirty, saved, or owned by the window. Main derives every
 * target from its authenticated FileHost owner set and live session history.
 */
export type DocumentCoreLifecycleIntent =
  | Readonly<{ readonly kind: 'save-all' }>
  | Readonly<{
    readonly kind: 'close-document'
    readonly documentId: string
  }>
  | Readonly<{
    readonly kind: 'close-others'
    readonly keepDocumentId: string
  }>
  | Readonly<{ readonly kind: 'close-saved' }>
  | Readonly<{ readonly kind: 'close-all' }>
  | Readonly<{ readonly kind: 'close-window' }>

export interface DocumentCoreLifecycleReceipt {
  readonly schema: 'document-core-lifecycle-receipt-1'
  readonly kind: 'completed' | 'cancelled'
  readonly savedDocumentIds: readonly string[]
  readonly closedDocumentIds: readonly string[]
}

export interface DocumentCoreAttachRequest {
  readonly documentId: string
}

export interface DocumentCoreSaveRequest {
  readonly documentId: string
  readonly mode: 'save' | 'save-as' | 'autosave'
}

export type DocumentCoreRelocateIntent =
  | Readonly<{
    readonly kind: 'rename'
    readonly filename: string
  }>
  | Readonly<{
    readonly kind: 'move-to'
  }>

export interface DocumentCoreRelocateRequest {
  readonly documentId: string
  readonly intent: DocumentCoreRelocateIntent
}

export interface DocumentCorePathReceipt {
  readonly schema: 'document-core-path-receipt-1'
  readonly documentId: string
  readonly previousPathname: string
  readonly pathname: string
  readonly filename: string
}

export interface DocumentCoreResolveExternalChangeRequest {
  readonly documentId: string
  readonly resolution: 'reload' | 'keep'
}

export type DocumentCoreExternalChangeResult =
  | Readonly<{
    readonly schema: 'document-core-file-reload-1'
    readonly kind: 'reloaded' | 'unchanged' | 'conflict'
    readonly documentId: string
    readonly revisionId: string
    readonly historyState: DocumentCoreHistoryState
  }>
  | Readonly<{
    readonly schema: 'document-core-file-reload-1'
    readonly kind: 'removed' | 'kept'
    readonly documentId: string
  }>

export type DocumentCoreSaveReceipt =
  | Readonly<{
    readonly schema: 'document-core-save-receipt-1'
    readonly kind: 'written'
    readonly documentId: string
    readonly pathname: string
    readonly revisionId: string
    readonly historyState: DocumentCoreHistoryState
  }>
  | Readonly<{
    readonly schema: 'document-core-save-receipt-1'
    readonly kind: 'cancelled'
    readonly documentId: string
  }>
  | Readonly<{
    readonly schema: 'document-core-save-receipt-1'
    readonly kind: 'unavailable'
    readonly documentId: string
    readonly reason: 'autosave-needs-path'
  }>

export interface DocumentCoreTabDescriptor {
  readonly schema: 'document-core-tab-1'
  readonly documentId: string
  readonly filename: string
  readonly pathname: string | null
  readonly selected: boolean
}

export type DocumentCoreExportPageSize =
  | Readonly<{
    readonly kind: 'named'
    readonly name:
      | 'A0'
      | 'A1'
      | 'A2'
      | 'A3'
      | 'A4'
      | 'A5'
      | 'A6'
      | 'Legal'
      | 'Letter'
      | 'Tabloid'
      | 'Ledger'
  }>
  | Readonly<{
    readonly kind: 'custom'
    readonly widthMm: number
    readonly heightMm: number
  }>

export type DocumentCoreExportTheme =
  | Readonly<{
    readonly kind: 'built-in'
    readonly name: 'default' | 'academic' | 'liber'
  }>
  | Readonly<{
    readonly kind: 'custom'
    readonly name: string
  }>

export interface DocumentCoreExportHeaderFooter {
  readonly layout: 'single' | 'three-columns'
  readonly left: string
  readonly center: string
  readonly right: string
}

export interface DocumentCoreExportOptions {
  readonly title: string
  readonly page: Readonly<{
    readonly size: DocumentCoreExportPageSize
    readonly landscape: boolean
    readonly marginsMm: Readonly<{
      readonly top: number
      readonly right: number
      readonly bottom: number
      readonly left: number
    }>
  }>
  readonly theme: DocumentCoreExportTheme
  readonly typography: Readonly<{
    readonly fontFamily: string | null
    readonly fontSizePx: number
    readonly lineHeight: number
  }> | null
  readonly autoNumberHeadings: boolean
  readonly showFrontMatter: boolean
  readonly toc: Readonly<{
    readonly title: string
    readonly includeTopHeading: boolean
  }>
  readonly header: DocumentCoreExportHeaderFooter | null
  readonly footer: DocumentCoreExportHeaderFooter | null
  readonly headerFooterAppearance: Readonly<{
    readonly drawRules: boolean
    readonly fontSizePx: number
  }> | null
}

export interface DocumentCoreExportThemeDescriptor {
  readonly name: string
  readonly label: string
}

type ExportClosedRecord = Readonly<Record<string, unknown>>

function exportClosedRecord(
  value: unknown,
  label: string,
  keys: readonly string[]
): ExportClosedRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid export ${label}: must be a closed record`)
  }
  const actual = Reflect.ownKeys(value)
  if (
    actual.some(key => typeof key !== 'string') ||
    actual.length !== keys.length ||
    actual.some(key => !keys.includes(key as string))
  ) {
    throw new TypeError(`Invalid export ${label}: fields are not closed`)
  }
  return value as ExportClosedRecord
}

function exportText(
  value: unknown,
  label: string,
  maximumUnits: number
): string {
  if (
    typeof value !== 'string' ||
    value.length > maximumUnits ||
    [...value].some(character => {
      const point = character.codePointAt(0) ?? 0
      return point === 0 || (point >= 0x7f && point <= 0x9f)
    })
  ) {
    throw new TypeError(
      `Invalid export ${label}: must be bounded plain text`
    )
  }
  return value
}

function exportBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`Invalid export ${label}: must be a boolean`)
  }
  return value
}

function exportNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `Invalid export ${label}: must be a finite number from ` +
      `${String(minimum)} through ${String(maximum)}`
    )
  }
  return value
}

function freezeExportPageSize(value: unknown): DocumentCoreExportPageSize {
  const base = exportClosedRecord(
    value,
    'page size',
    value !== null &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === 'custom'
      ? ['kind', 'widthMm', 'heightMm']
      : ['kind', 'name']
  )
  if (base.kind === 'named') {
    const names = [
      'A0',
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'A6',
      'Legal',
      'Letter',
      'Tabloid',
      'Ledger'
    ] as const
    if (!names.includes(base.name as typeof names[number])) {
      throw new TypeError('Invalid export page size name')
    }
    return Object.freeze({
      kind: 'named',
      name: base.name as typeof names[number]
    })
  }
  if (base.kind !== 'custom') {
    throw new TypeError('Invalid export page size kind')
  }
  return Object.freeze({
    kind: 'custom',
    widthMm: exportNumber(
      base.widthMm,
      'page size widthMm',
      1,
      2_000
    ),
    heightMm: exportNumber(
      base.heightMm,
      'page size heightMm',
      1,
      2_000
    )
  })
}

function freezeExportTheme(value: unknown): DocumentCoreExportTheme {
  const base = exportClosedRecord(value, 'theme', ['kind', 'name'])
  if (base.kind === 'built-in') {
    if (
      base.name !== 'default' &&
      base.name !== 'academic' &&
      base.name !== 'liber'
    ) {
      throw new TypeError('Invalid export built-in theme name')
    }
    return Object.freeze({
      kind: 'built-in',
      name: base.name
    })
  }
  if (base.kind !== 'custom') {
    throw new TypeError('Invalid export theme kind')
  }
  const name = exportText(base.name, 'custom theme filename', 255)
  if (
    !/^[\p{L}\p{N}_. -]+\.css$/u.test(name) ||
    name === '.css' ||
    name.includes('..')
  ) {
    throw new TypeError(
      'Invalid export custom theme name: must be a safe CSS filename'
    )
  }
  return Object.freeze({ kind: 'custom', name })
}

function freezeExportHeaderFooter(
  value: unknown,
  label: 'header' | 'footer'
): DocumentCoreExportHeaderFooter | null {
  if (value === null) return null
  const record = exportClosedRecord(value, label, [
    'layout',
    'left',
    'center',
    'right'
  ])
  if (
    record.layout !== 'single' &&
    record.layout !== 'three-columns'
  ) {
    throw new TypeError(`Invalid export ${label} layout`)
  }
  return Object.freeze({
    layout: record.layout,
    left: exportText(record.left, `${label} left`, 4_096),
    center: exportText(record.center, `${label} center`, 4_096),
    right: exportText(record.right, `${label} right`, 4_096)
  })
}

/**
 * Validate the sole semantic export-options contract at both renderer-local
 * and Electron-main ingress. It carries no HTML, CSS, or physical path.
 */
export function freezeDocumentCoreExportOptions(
  value: unknown
): DocumentCoreExportOptions {
  const record = exportClosedRecord(value, 'options', [
    'title',
    'page',
    'theme',
    'typography',
    'autoNumberHeadings',
    'showFrontMatter',
    'toc',
    'header',
    'footer',
    'headerFooterAppearance'
  ])
  const page = exportClosedRecord(record.page, 'page', [
    'size',
    'landscape',
    'marginsMm'
  ])
  const margins = exportClosedRecord(
    page.marginsMm,
    'page margins',
    ['top', 'right', 'bottom', 'left']
  )
  const typography = record.typography === null
    ? null
    : (() => {
      const font = exportClosedRecord(
        record.typography,
        'typography',
        ['fontFamily', 'fontSizePx', 'lineHeight']
      )
      return Object.freeze({
        fontFamily: font.fontFamily === null
          ? null
          : exportText(
            font.fontFamily,
            'typography fontFamily',
            255
          ),
        fontSizePx: exportNumber(
          font.fontSizePx,
          'typography fontSizePx',
          1,
          512
        ),
        lineHeight: exportNumber(
          font.lineHeight,
          'typography lineHeight',
          0.1,
          20
        )
      })
    })()
  const toc = exportClosedRecord(record.toc, 'toc', [
    'title',
    'includeTopHeading'
  ])
  const appearance = record.headerFooterAppearance === null
    ? null
    : (() => {
      const raw = exportClosedRecord(
        record.headerFooterAppearance,
        'header/footer appearance',
        ['drawRules', 'fontSizePx']
      )
      return Object.freeze({
        drawRules: exportBoolean(
          raw.drawRules,
          'header/footer appearance drawRules'
        ),
        fontSizePx: exportNumber(
          raw.fontSizePx,
          'header/footer appearance fontSizePx',
          1,
          512
        )
      })
    })()
  return Object.freeze({
    title: exportText(record.title, 'title', 4_096),
    page: Object.freeze({
      size: freezeExportPageSize(page.size),
      landscape: exportBoolean(page.landscape, 'page landscape'),
      marginsMm: Object.freeze({
        top: exportNumber(margins.top, 'page margin top', 0, 1_000),
        right: exportNumber(margins.right, 'page margin right', 0, 1_000),
        bottom: exportNumber(margins.bottom, 'page margin bottom', 0, 1_000),
        left: exportNumber(margins.left, 'page margin left', 0, 1_000)
      })
    }),
    theme: freezeExportTheme(record.theme),
    typography,
    autoNumberHeadings: exportBoolean(
      record.autoNumberHeadings,
      'autoNumberHeadings'
    ),
    showFrontMatter: exportBoolean(
      record.showFrontMatter,
      'showFrontMatter'
    ),
    toc: Object.freeze({
      title: exportText(toc.title, 'toc title', 4_096),
      includeTopHeading: exportBoolean(
        toc.includeTopHeading,
        'toc includeTopHeading'
      )
    }),
    header: freezeExportHeaderFooter(record.header, 'header'),
    footer: freezeExportHeaderFooter(record.footer, 'footer'),
    headerFooterAppearance: appearance
  })
}

interface DocumentCoreStaticSinkRequestBase {
  readonly documentId: string
  readonly revisionId: string
  readonly view: ConsumerView
  readonly options: DocumentCoreExportOptions
}

export interface DocumentCoreStyledHtmlSinkRequest
  extends DocumentCoreStaticSinkRequestBase {
  readonly consumer: 'styled-html'
  /** A semantic filename hint; Electron main owns the native save dialog. */
  readonly suggestedName: string
}

export interface DocumentCorePdfSinkRequest
  extends DocumentCoreStaticSinkRequestBase {
  readonly consumer: 'pdf'
  /** A semantic filename hint; Electron main owns the native save dialog. */
  readonly suggestedName: string
}

export interface DocumentCorePrintSinkRequest
  extends DocumentCoreStaticSinkRequestBase {
  readonly consumer: 'print'
}

export type DocumentCoreStaticSinkRequest =
  | DocumentCoreStyledHtmlSinkRequest
  | DocumentCorePdfSinkRequest
  | DocumentCorePrintSinkRequest

interface DocumentCoreStaticSinkReceiptBase {
  readonly schema: 'document-core-static-sink-receipt-1'
  readonly consumer: DocumentCoreStaticSinkRequest['consumer']
  readonly view: ConsumerView
  readonly revisionId: string
  readonly sourceHash: SourceHashV1
}

export interface DocumentCoreStaticSinkWrittenReceipt
  extends DocumentCoreStaticSinkReceiptBase {
  readonly kind: 'written' | 'proof-written'
  readonly consumer: 'styled-html' | 'pdf' | 'print'
  readonly targetPath: string
  readonly bytes: number
}

export interface DocumentCoreStaticSinkSubmittedReceipt
  extends DocumentCoreStaticSinkReceiptBase {
  readonly kind: 'submitted'
  readonly consumer: 'print'
}

export interface DocumentCoreStaticSinkUnavailableReceipt {
  readonly schema: 'document-core-static-sink-receipt-1'
  readonly kind: 'unavailable'
  readonly consumer: DocumentCoreStaticSinkRequest['consumer']
  readonly view: ConsumerView
  readonly reason: 'source-only-revision'
  readonly revisionId: string
}

export interface DocumentCoreStaticSinkCancelledReceipt {
  readonly schema: 'document-core-static-sink-receipt-1'
  readonly kind: 'cancelled'
  readonly consumer: 'styled-html' | 'pdf'
  readonly view: ConsumerView
  readonly revisionId: string
}

export type DocumentCoreStaticSinkReceipt =
  | DocumentCoreStaticSinkWrittenReceipt
  | DocumentCoreStaticSinkSubmittedReceipt
  | DocumentCoreStaticSinkUnavailableReceipt
  | DocumentCoreStaticSinkCancelledReceipt

const REVIEW_KINDS = new Set([
  'addition',
  'deletion',
  'substitution',
  'highlight',
  'comment'
])

function portableRange(
  value: unknown,
  maximum: number,
  label: string
): Readonly<{ start: number; end: number }> {
  const range = reviewRecord(value, label, ['start', 'end'])
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    Number(range.start) < 0 ||
    Number(range.end) < Number(range.start) ||
    Number(range.end) > maximum
  ) throw new TypeError(`Invalid document-core Review ${label}`)
  return Object.freeze({
    start: Number(range.start),
    end: Number(range.end)
  })
}

function reviewRecord(
  value: unknown,
  label: string,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid document-core Review ${label}`)
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  const keys = Reflect.ownKeys(value)
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key))
  ) {
    throw new TypeError(`Invalid document-core Review ${label}`)
  }
  const entries: Array<readonly [string, unknown]> = []
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new TypeError(`Invalid document-core Review ${label}.${field}`)
    }
    entries.push([field, descriptor.value])
  }
  return Object.freeze(Object.fromEntries(entries))
}

/**
 * Validate and detach the checksummed Review member before mounting it.
 *
 * The wire checksum proves bytes arrived intact; this function proves those
 * bytes are the bounded serializable Review shape the renderer understands.
 */
export function freezeDocumentCoreReviewIndex(
  value: unknown,
  sourceLength: number,
  modelLength: number
): ReviewIndex {
  if (
    !Number.isSafeInteger(sourceLength) ||
    sourceLength < 0 ||
    !Number.isSafeInteger(modelLength) ||
    modelLength < 0
  ) {
    throw new TypeError('Invalid document-core Review coordinate limits')
  }
  const index = reviewRecord(value, 'index', [
    'authoring',
    'items',
    'commentedSpans'
  ])
  const authoringRecord = reviewRecord(index.authoring, 'authoring', [
    'canCreateAddition',
    'canCreateDeletion',
    'canCreateSubstitution',
    'canCreateHighlight',
    'canCreateComment'
  ])
  if (
    Object.values(authoringRecord).some(item => typeof item !== 'boolean') ||
    !Array.isArray(index.items) ||
    !Array.isArray(index.commentedSpans)
  ) {
    throw new TypeError('Invalid document-core Review index')
  }
  const rawItems = index.items
  const rawCommentedSpans = index.commentedSpans
  const items = rawItems.map((raw: unknown) => {
    const item = reviewRecord(raw, 'item', [
      'nodeId',
      'kind',
      'sourceRange',
      'modelRange',
      'focusOffset',
      'depth',
      'parent',
      'withinCommentPayload',
      'payloadRange',
      'commentRevisedText',
      'oldContent',
      'newContent'
    ])
    if (
      typeof item.nodeId !== 'string' ||
      item.nodeId.length === 0 ||
      item.nodeId.length > 1_024 ||
      typeof item.kind !== 'string' ||
      !REVIEW_KINDS.has(item.kind) ||
      !Number.isSafeInteger(item.depth) ||
      Number(item.depth) < 0 ||
      Number(item.depth) > rawItems.length ||
      (
        item.parent !== null &&
        (
          typeof item.parent !== 'string' ||
          item.parent.length === 0 ||
          item.parent.length > 1_024
        )
      ) ||
      typeof item.withinCommentPayload !== 'boolean' ||
      (
        item.commentRevisedText !== null &&
        typeof item.commentRevisedText !== 'string'
      ) ||
      (
        item.oldContent !== null &&
        typeof item.oldContent !== 'string'
      ) ||
      (
        item.newContent !== null &&
        typeof item.newContent !== 'string'
      ) ||
      (
        item.kind === 'substitution' &&
        (
          typeof item.oldContent !== 'string' ||
          typeof item.newContent !== 'string'
        )
      ) ||
      (
        item.kind !== 'substitution' &&
        (item.oldContent !== null || item.newContent !== null)
      ) ||
      (
        item.kind === 'comment'
          ? typeof item.commentRevisedText !== 'string'
          : item.commentRevisedText !== null
      )
    ) {
      throw new TypeError('Invalid document-core Review item')
    }
    if (
      !Number.isSafeInteger(item.focusOffset) ||
      Number(item.focusOffset) < 0 ||
      Number(item.focusOffset) > modelLength
    ) {
      throw new TypeError(
        'Invalid document-core Review focus coordinate'
      )
    }
    const sourceRange = portableRange(
      item.sourceRange,
      sourceLength,
      'source range'
    )
    const modelRange = item.modelRange === null
      ? null
      : portableRange(item.modelRange, modelLength, 'model range')
    const payloadRange = portableRange(
      item.payloadRange,
      sourceLength,
      'payload range'
    )
    return Object.freeze({
      nodeId: item.nodeId,
      kind: item.kind,
      sourceRange,
      modelRange,
      focusOffset: Number(item.focusOffset),
      depth: Number(item.depth),
      parent: item.parent,
      withinCommentPayload: item.withinCommentPayload,
      payloadRange,
      commentRevisedText: item.commentRevisedText,
      oldContent: item.oldContent,
      newContent: item.newContent
    })
  })
  const byId = new Map<string, (typeof items)[number]>()
  for (const item of items) {
    if (byId.has(item.nodeId)) {
      throw new TypeError('Invalid document-core Review duplicate node identity')
    }
    if (item.parent === null) {
      if (item.depth !== 0) {
        throw new TypeError('Invalid document-core Review parent topology')
      }
    } else {
      const parent = byId.get(item.parent)
      if (
        parent === undefined ||
        item.depth !== parent.depth + 1 ||
        item.sourceRange.start < parent.sourceRange.start ||
        item.sourceRange.end > parent.sourceRange.end
      ) {
        throw new TypeError('Invalid document-core Review parent topology')
      }
    }
    byId.set(item.nodeId, item)
  }
  const spanIdentities = new Set<string>()
  const commentedSpans = rawCommentedSpans.map((raw: unknown) => {
    const span = reviewRecord(raw, 'commented span', [
      'highlight',
      'comment',
      'sourceRange',
      'modelRange'
    ])
    if (
      typeof span.highlight !== 'string' ||
      typeof span.comment !== 'string'
    ) {
      throw new TypeError('Invalid document-core commented span')
    }
    const highlight = byId.get(span.highlight)
    const comment = byId.get(span.comment)
    const sourceRange = portableRange(
      span.sourceRange,
      sourceLength,
      'commented-span source range'
    )
    const modelRange = portableRange(
      span.modelRange,
      modelLength,
      'commented-span model range'
    )
    const identity = `${span.highlight}\0${span.comment}`
    if (
      highlight?.kind !== 'highlight' ||
      comment?.kind !== 'comment' ||
      highlight.parent !== comment.parent ||
      highlight.sourceRange.end !== comment.sourceRange.start ||
      sourceRange.start !== highlight.sourceRange.start ||
      sourceRange.end !== comment.sourceRange.end ||
      highlight.modelRange === null ||
      modelRange.start !== highlight.modelRange.start ||
      modelRange.end !== highlight.modelRange.end ||
      spanIdentities.has(identity)
    ) {
      throw new TypeError(
        'Invalid document-core commented span Highlight/Comment references'
      )
    }
    spanIdentities.add(identity)
    return Object.freeze({
      highlight: span.highlight,
      comment: span.comment,
      sourceRange,
      modelRange
    })
  })
  const authoring = Object.freeze({
    canCreateAddition: authoringRecord.canCreateAddition as boolean,
    canCreateDeletion: authoringRecord.canCreateDeletion as boolean,
    canCreateSubstitution: authoringRecord.canCreateSubstitution as boolean,
    canCreateHighlight: authoringRecord.canCreateHighlight as boolean,
    canCreateComment: authoringRecord.canCreateComment as boolean
  })
  return Object.freeze({
    authoring,
    items: Object.freeze(items),
    commentedSpans: Object.freeze(commentedSpans)
  }) as ReviewIndex
}

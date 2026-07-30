export {
  createLanguageEngine,
  type LanguageEngine,
  type LanguageEngineSourceEdit
} from './languageEngine.js'
export { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'
export {
  zeroPhysicalTraversalCountsV1,
  type Profile1PhysicalTraversalCountsV1
} from './internal/profile1/physicalTraversalAccounting.js'
export {
  createDocumentSession,
  recoverDocumentSession,
  type AdmissionResult,
  type AuthorCriticMarkupIntent,
  type CanonicalSourceChunk,
  type CanonicalSourceLease,
  type CancelledSessionTicketOutcome,
  type BlockConversion,
  type DiagramFenceLanguage,
  type DispatchResult,
  type DispatchTicket,
  type Disposable,
  type CommittedSessionTicketOutcome,
  type DocumentSessionDurability,
  type DocumentSessionJournalCommit,
  type DocumentSessionJournalContent,
  type DocumentSessionJournalMutation,
  type DocumentSessionJournalStorage,
  type DocumentSessionJournalValue,
  type DocumentSession,
  type DocumentHistoryState,
  type DocumentCoreMarkdownOptionPatch,
  type DocumentSessionOpenOptions,
  type DocumentSessionRecoveryOptions,
  type DeleteBlockIntent,
  type DuplicateBlockIntent,
  type EffectAcknowledgementResult,
  type DraftId,
  type CommitCompositionIntent,
  type ReloadSourceFromFileIntent,
  type EditSourceIntent,
  type CompleteEditorSnapshot,
  type CompleteRevisionDescriptor,
  type ConvertBlockIntent,
  type CriticMarkupProjection,
  type CreateTableIntent,
  type DocumentLiveRenderPlan,
  type EditorIntent,
  type EditorSnapshot,
  type EditorSnapshotId,
  type FlushReason,
  type FlushResult,
  type FormatTextIntent,
  type InitialModelSelection,
  type InlineFormat,
  type QuickInsertBlock,
  type QuickInsertConversion,
  type QuickInsertBlockIntent,
  type InsertTextIntent,
  type InsertParagraphIntent,
  type InsertParagraphBreakIntent,
  type InsertLineBreakIntent,
  type SetListIndentationIntent,
  type SetCodeLanguageIntent,
  type InsertLinkIntent,
  type InsertImageIntent,
  type InsertFootnoteIntent,
  type InsertTableRowIntent,
  type InsertTableColumnIntent,
  type RemoveTableColumnIntent,
  type AlignTableColumnIntent,
  type TableColumnAlignment,
  type MoveTableRowIntent,
  type MoveTableColumnIntent,
  type DeleteTableCellContentsIntent,
  type RemoveTableRowIntent,
  type IntentId,
  type LeaseReleaseReason,
  type LeaseReleaseResult,
  type LiveRenderPlanId,
  type LiveRenderRun,
  type MarkupLiveRenderPlan,
  type MarkupModelSelection,
  type ModelPosition,
  type ModelRange,
  type ModelSelection,
  type NoopSessionTicketOutcome,
  type PendingInputDraft,
  type PendingSessionState,
  type PersistenceReason,
  type PasteTextIntent,
  type RejectionCode,
  type RejectedSessionTicketOutcome,
  type RedoIntent,
  type ReadOnlyLiveRenderPlan,
  type ReplaceCurrentMatchesIntent,
  type ReplaceStructureIntent,
  type ReviewCommentedSpan,
  type ReviewIndex,
  type ReviewIndexItem,
  type RevisionChangedTransition,
  type RevisionSourceEdit,
  type RevisionDescriptor,
  type RevisionId,
  type RevisionTransitionDescriptor,
  type SessionConfiguration,
  type SessionOpenConfiguration,
  type SessionCancelResult,
  type SessionClipboardMaterializationResult,
  type SessionCloseResult,
  type SessionEffect,
  type SessionEffectId,
  type SessionId,
  type SessionLifecycleStatus,
  type SessionMarkdownReconfigurationResult,
  type SessionOperation,
  type SessionOperationId,
  type SessionStaticMaterializationResult,
  type SessionStateChangedTransition,
  type SessionTransition,
  type SessionTransitionId,
  type SessionTransitionListener,
  type SetTrackChangesIntent,
  type SetProjectionIntent,
  type StateChangedSessionTicketOutcome,
  type StaticMaterializationRevision,
  type SessionTicketOutcome,
  type SourceModelSelection,
  type SourceOnlyEditorSnapshot,
  type SourceOnlyRevisionDescriptor,
  type SourceLeaseId,
  type UndoIntent
} from './documentSession.js'
export {
  createDocumentSearchQuery,
  decodeDocumentSearchQuery,
  DOCUMENT_SEARCH_RESOURCE_POLICY_V1,
  findMarkupSearchMatches,
  findSearchMatches,
  type DocumentSearchQuery,
  type DocumentSearchQueryOptions,
  DocumentSearchQueryError,
  type DocumentSearchSyntax,
  type SearchMatchRange
} from './search.js'
export {
  createMemoryDocumentSessionJournalStorage
} from './sessionJournalStorage.js'
export {
  decodeMarkupCoordinateMapV1,
  modelPositionAtMarkupCoordinateMap,
  sourcePositionAtMarkupCoordinateMap,
  visibleModelPositionAtMarkupCoordinateMap,
  type MarkupCoordinateMapV1,
  type MarkupCoordinateSpanV1
} from './markupCoordinateMap.js'
export {
  criticMarkupAuthoringCapabilities,
  createTransformationKernel,
  type ChangeResolutionDecision,
  type CommittedTransformation,
  type CriticMarkupAuthoringCapabilities,
  type CriticMarkupAuthoringInput,
  type RejectedTransformation,
  type TransformationIntent,
  type TransformationKernel,
  type TransformationRejectionReason,
  type TransformationResult,
  type TransformationSourceEdit
} from './transformationKernel.js'
export { createSourceSnapshot, type SourceSnapshot } from './sourceSnapshot.js'
export {
  validateAndFreezeParseConfiguration
} from './configuration.js'
export {
  materializeDocumentFacts,
  type DocumentFacts,
  type DocumentStatistics
} from './materialize/documentFacts.js'
export {
  chooseAuthoringEolV1,
  type AuthoringEolDecisionV1,
  type AuthoringEolToken,
  type AuthoringSourceOwner
} from './authoringEol.js'
export {
  decodeFileSnapshot,
  encodeFileSnapshot,
  type FileEncodingV1,
  type FileSnapshotV1
} from './fileSnapshot.js'
export {
  fileHashV1,
  revisionSemanticHashV1,
  sourceHashV1,
  type FileHashV1,
  type RevisionSemanticHashV1,
  type SourceHashV1
} from './hashCodec.js'
export {
  openVerifiedSourceReplicaV1,
  retainVerifiedSourceReplicaV1,
  reviseVerifiedSourceReplicaV1,
  type VerifiedSourceReplicaV1
} from './verifiedSourceReplica.js'
export {
  WIRE_MEMBER_ORDER_V1,
  WireEnvelopeCodecV1,
  type WireChunkV1,
  type WireDecodedMembersV1,
  type WireEnvelopeInputV1,
  type WireEnvelopeV1,
  type WireHashV1,
  type WireMemberNameV1,
  type WireMemberV1,
  type WirePublicationFailureReasonV1,
  type WirePublicationResultV1
} from './wireEnvelopeCodec.js'
export type {
  CompleteDocumentRevision,
  CriticMarkupArm,
  CriticMarkupForest,
  CriticMarkupNode,
  CriticMarkupProfileId,
  DiagnosticIndex,
  DocumentRevision,
  ExecutionBudgetId,
  LiveHtmlSafetyProfileId,
  MarkupMark,
  MarkupProjection,
  MarkupProjectionRun,
  MarkdownDocument,
  MarkdownFootnoteDefinitionFact,
  MarkdownFootnoteReferenceFact,
  MarkdownHeadingFact,
  MarkdownHeadingIndex,
  MarkdownLinkFact,
  MarkdownLiteralProvider,
  MarkdownLineIndex,
  MarkdownNode,
  MarkdownPhysicalLine,
  MarkdownNodeKind,
  MarkdownOptionsV1,
  MarkdownProfileId,
  MarkdownReferenceDefinitionFact,
  MarkdownReferenceIndex,
  NodeId,
  ParseConfiguration,
  Profile1SyntaxEdge,
  Profile1SyntaxEdgeKind,
  Profile1SyntaxGraph,
  Profile1SyntaxNode,
  Profile1SyntaxNodeKind,
  ProjectedCodeUnitOrigin,
  ProjectedMarkdown,
  ProjectionProvenance,
  ResourceDiagnostic,
  ResourceDiagnosticCode,
  SourceOffset,
  SourceOwner,
  SourceOwnershipIndex,
  SourceOwnershipRun,
  SourceOnlyDocumentRevision,
  SourceRange,
  SubstitutionNode,
  SyntaxDiagnostic,
  SyntaxDiagnosticCode,
  UnaryCriticNode,
  ViewRange
} from './revision.js'
export {
  markupRenderElement,
  renderMarkupPlan,
  type MarkupRenderElement,
  type MarkupRenderNode,
  type MarkupRenderRun,
  type MarkupRenderText
} from './view/markupRender.js'
export {
  groupRenderLines,
  type MarkupRenderLine
} from './view/markupRender.js'
export { canonicalMarkupDocument } from './view/markupRender.js'
export {
  renderMarkdownHtml,
  renderMarkdownReviewHtml,
  type MarkdownHtmlRenderOptions,
  type MarkdownReviewAnnotation,
  type MarkdownReviewElement,
  type MarkdownReviewRenderPlan,
  type MarkdownReviewRun
} from './materialize/htmlRender.js'
export {
  consumeTrustedHtml,
  materializeCleanHtml,
  materializeReviewHtml,
  type CleanHtmlRequest,
  type HtmlSink,
  type MaterializedHtmlSink,
  type ReviewHtmlRequest,
  type StaticHtmlStructure,
  type TrustedHtml
} from './materialize/trustedHtml.js'
export {
  materializeCount,
  materializeProjectedText,
  materializeSearchText,
  type CountResult,
  type MaterializerView,
  type ProjectedText,
  type SearchText
} from './materialize/textMaterializers.js'
export {
  githubHeadingSlug
} from './materialize/headingSlug.js'
export {
  markdownHeadingAnchors,
  parserHeadingAnchors,
  type ParserHeadingAnchor
} from './materialize/headingOutline.js'
export {
  resolveMarkdownDocumentLinkTarget,
  resolveDocumentLinkTarget,
  type DocumentLinkTarget
} from './materialize/documentLink.js'
export {
  acknowledgeClipboardWrite,
  authorizeCut,
  classifyPasteConsumer,
  materializeClipboardConsumer,
  materializePersistenceConsumer,
  materializeStaticConsumer,
  planReplaceConsumer,
  routeLiveConsumer,
  viewLength,
  PROFILE1_KIND_SINK_EXACTNESS,
  type ConsumerSink,
  type KindExactnessRow,
  type KindSinkExactness,
  type SinkExactnessClaim,
  type ClipboardBundle,
  type ClipboardConsumer,
  type ClipboardConsumerRequest,
  type ClipboardConsumerResult,
  type ClipboardText,
  type ClipboardWriteReceipt,
  type ConsumerView,
  type ClipboardView,
  type CutPreparation,
  type DisabledConsumer,
  type LiveConsumerRoute,
  type PasteConsumerRequest,
  type PasteConsumerResult,
  type PastePayload,
  type PersistenceConsumerResult,
  type PersistenceView,
  type PrivateSourceFlavor,
  type ReplaceConsumerRequest,
  type ReplaceConsumerResult,
  type ReplaceHit,
  type SemanticCutAuthorization,
  type StaticConsumer,
  type StaticConsumerRequest,
  type StaticConsumerResult
} from './materialize/consumerPolicy.js'
export {
  groupRenderBlocks,
  type MarkupRenderBlock
} from './view/markupRender.js'
export { modelOffsetAt, viewPositionAt, type MarkupViewPosition } from './view/markupRender.js'
export { safePointsOf } from './safePoints.js'
export {
  createParseExecutionAccumulator,
  DocumentExecutionCancelledError,
  PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL,
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  type ParseExecutionAccumulator,
  type ParseExecutionControl,
  type ParseExecutionProgress
} from './parseExecutionControl.js'

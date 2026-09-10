export {
  createDocumentCore,
  DocumentCoreError,
  DocumentSourceEditError,
  type CommentProjection,
  type CommentCoordinateSegment,
  type CommentProjectionRequest,
  type CommentProjectionSpan,
  type CommentRegionReplacement,
  type CommentRegionProjectionChange,
  type CommentDocumentProjectionChange,
  type CriticMarkupAnnotation,
  type CriticMarkupAnnotationSnapshot,
  type CriticMarkupAnnotationSnapshotArm,
  type CriticMarkupAnnotationSnapshotNode,
  type CriticMarkupArm,
  type CriticMarkupKind,
  type DocumentCore,
  type DocumentChange,
  type DocumentCommit,
  type DocumentApplyOptions,
  type DocumentCoreErrorCode,
  type DocumentDiagnostic,
  type DocumentDiagnosticCode,
  type DocumentProjection,
  type DocumentProjectionName,
  type DocumentProjectionRequest,
  type DocumentSourceResynchronization,
  type DocumentResolutionDecision,
  type DocumentRevision,
  type DocumentSourceEdit,
  type MarkdownAst,
  type MarkdownAstNode,
  type MarkdownAttribute,
  type MarkdownNodeKind,
  type MarkdownOptions,
  type MarkdownProjection,
  type MarkdownProjectionName,
  type MarkupEvent,
  type MarkupCoordinateSegment,
  type MarkupMark,
  type MarkupProjection,
  type MarkupRegionProjectionChange,
  type MarkupRegionReplacement,
  type MarkupSyntax,
  type OrdinalRange,
  type DocumentProjectionChange,
  type DocumentProjectionFallbackReason,
  type MarkupDocumentProjectionChange,
  type ProjectionAffinity,
  type ProjectionCoordinateMap,
  type ProjectionOrigin,
  type SourceRange
} from './documentCore.js'
export { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'

export { documentInputContext, type DocumentInputSelection, type DocumentInputTarget, type DocumentInputAction, type DocumentBrowserInputAction, type DocumentCommandInputAction, type DocumentInputPlan, type DocumentInputResult, type DocumentInputSyntaxContext } from './inputPlanning.js'

export type { DocumentFormatAction, DocumentFormatPlan } from './formatPlanning.js'

export { copyClipboardAction } from './clipboardPlanning.js'
export type { DocumentClipboardSelection, DocumentClipboardContent, DocumentClipboardPasteAction, DocumentClipboardAction, DocumentTextClipboardAction, DocumentTableClipboardAction, DocumentClipboardPlan } from './clipboardPlanning.js'

export { documentActiveFormats, type DocumentActiveFormat } from './documentFormatContext.js'

export type { DocumentSourceSyntaxSpan } from './sourceSyntax.js'

export { copyDocumentSelection } from './sourceInputPlanning.js'
export type { DocumentSelection, DocumentTextSelection, DocumentTableSelection, DocumentTableCellAddress, DocumentTableCellSelection, DocumentSourceInputAction } from './sourceInputPlanning.js'

export type { DocumentAuthorAction, DocumentAuthorForm, DocumentAuthorPlan } from './authorPlanning.js'

export { imageAltText } from './imagePropertyPlanning.js'

export { projectTableSelection, type DocumentTableSelectionProjection } from './tableSelectionProjection.js'

export { resolveTableCell } from './tableSelection.js'

export { projectSourceSelection } from './sourceSelectionProjection.js'

export { rebaseDocumentInputSelection, type DocumentSelectionMutation, type DocumentSelectionRebaseResult } from './selectionRebasing.js'

export { paragraphPrefixPosition, paragraphImageRange } from './paragraphBoundary.js'

export type { DocumentModelTextPoint, DocumentModelTextSelection } from './sourceInputPlanning.js'
export { projectModelTextSelection } from './modelTextSelectionProjection.js'

export {
    analyzeMarkdownComments,
    stripAnalyzedCommentSyntaxFromMarkdown,
    validateCommentGraph,
} from './analyze';
export type {
    ICommentAnalysis,
    ICommentDiagnosticSourceMap,
    ICommentRangeSourceMap,
    TCommentAnalysisOptions,
} from './analyze';
export {
    appendCommentReplyMetadata,
    canWrapCommentRange,
    createCommentMetadata,
    mergeCommentMetadataPatch,
    nextCommentId,
    updateCommentMetadataDefinition,
    updateCommentMetadataInMarkdown,
    wrapCommentRange,
} from './edit';
export type {
    IAddCommentInput,
    TUpdateCommentThreadPatch,
} from './edit';
export {
    commentMarkerKindsInText,
    commentMarkerKindsInTexts,
    createCommentSearchText,
    forEachRealCommentMarker,
    orphansCounterpart,
    realCommentMarkersInText,
    removalOrphansCommentMarker,
    stripCommentSyntaxForClipboard,
    stripRealCommentMarkersFromText,
} from './markerScan';
export type { ICommentSearchText } from './markerScan';
export {
    decodeCommentHeadPayload,
    decodeCommentMetadata,
    decodeCommentReplyPayload,
    encodeCommentHeadPayload,
    encodeCommentReplyPayload,
    normalizeCommentMetadata,
    serializeCommentThreadLines,
} from './metadata';
export {
    buildTextPathIndexes,
    commentPathKey,
    compareTextPathEndpoints,
    locateCommentSyntax,
    orderTextRange,
    selectionIntersectsCommentRange,
} from './range';
export type { ICommentSyntaxLocation } from './range';
export {
    createCommentSourceLineState,
    prepareCommentSourceLine,
    sourceCommentIgnoredIndexRanges,
    sourceIndexInsideRanges,
    sourceInlineCodeRanges,
    sourceLinePositionInsideInlineCode,
    sourceRangesOverlap,
} from './source';
export type {
    ICommentSourceIndex,
    ICommentSourceIndexOptions,
    ICommentSourceIndexRange,
    ICommentSourceLineState,
    ICommentSourceMarker,
    ICommentSourceMetadataDefinition,
    ICommentSourceRange,
} from './source';
export {
    COMMENT_ID_PATTERN,
    COMMENT_MARKER_PATTERN,
    COMMENT_MARKER_REGEXP,
    COMMENT_MARKER_SEARCH_REGEXP,
    COMMENT_METADATA_DATA_URI_PREFIX,
    COMMENT_METADATA_DEFINITION_REGEXP,
    commentDefinitionLineThreadId,
    commentMarkerRegExpForId,
    isCommentMetadataDefinitionText,
    isCommentMetadataReference,
    isValidCommentId,
    NON_COMMENT_SCANNABLE_LEAF_BLOCKS,
    parseCommentHeadDefinition,
    parseCommentMarker,
    parseCommentMetadataDefinition,
    parseCommentReplyDefinition,
    serializeCommentMarker,
    serializeCommentMetadataDefinition,
    serializeCommentReplyDefinition,
} from './syntax';
export type {
    IParsedCommentHeadDefinition,
    IParsedCommentMarker,
    IParsedCommentMetadataDefinition,
    IParsedCommentReplyDefinition,
    TCommentMarkerKind,
} from './syntax';
export type {
    ICommentDiagnostic,
    ICommentMetadata,
    ICommentRange,
    ICommentReply,
    ICommentReplyInput,
    ICommentThread,
    IParsedMarkdownComments,
    TCommentDiagnosticCode,
    TCommentDisplayMetadata,
    TCommentStatus,
} from './types';

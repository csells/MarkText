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
    forEachRealCommentMarker,
    removalOrphansCommentMarker,
} from './markerScan';
export {
    decodeCommentMetadata,
    encodeCommentMetadata,
    normalizeCommentMetadata,
} from './metadata';
export { parseMarkdownComments, validateCommentGraph } from './parse';
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
    buildCommentSourceIndex,
    collectSourceCommentIds,
    createCommentSourceLineState,
    isUnsafeCommentMarkerTextEdit,
    prepareCommentSourceLine,
    removeCommentSyntaxFromMarkdown,
    sourceCommentIgnoredIndexRanges,
    sourceIndexInsideRanges,
    sourceInlineCodeRanges,
    sourceLinePositionInsideInlineCode,
    sourceRangesOverlap,
    stripCommentSyntaxFromMarkdown,
} from './source';
export type {
    ICommentSourceIndex,
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
    commentMarkerRegExpForId,
    isCommentMetadataReference,
    isValidCommentId,
    NON_COMMENT_SCANNABLE_LEAF_BLOCKS,
    parseCommentMarker,
    parseCommentMetadataDefinition,
    serializeCommentMarker,
    serializeCommentMetadataDefinition,
} from './syntax';
export type {
    IParsedCommentMarker,
    IParsedCommentMetadataDefinition,
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

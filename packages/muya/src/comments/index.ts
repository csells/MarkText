export {
    appendCommentReplyMetadata,
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
    decodeCommentMetadata,
    encodeCommentMetadata,
    normalizeCommentMetadata,
} from './metadata';
export { parseMarkdownComments, validateCommentGraph } from './parse';
export {
    buildTextPathIndexes,
    commentPathKey,
    compareTextPathEndpoints,
    orderTextRange,
    selectionIntersectsCommentRange,
} from './range';
export {
    COMMENT_ID_PATTERN,
    COMMENT_MARKER_PATTERN,
    COMMENT_MARKER_REGEXP,
    COMMENT_MARKER_SEARCH_REGEXP,
    COMMENT_METADATA_DATA_URI_PREFIX,
    COMMENT_METADATA_DEFINITION_REGEXP,
    isCommentMetadataReference,
    isValidCommentId,
    parseCommentMarker,
    parseCommentMetadataDefinition,
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

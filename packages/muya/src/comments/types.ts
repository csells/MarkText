import type { TBlockPath } from '../block/types';

export type TCommentStatus = 'open' | 'resolved';

export type TCommentDisplayMetadata = Record<string, unknown>;

export interface ICommentReply {
    author: string;
    createdAt: string;
    body: string;
    display?: TCommentDisplayMetadata;
}

export interface ICommentReplyInput {
    author: string;
    body: string;
    createdAt?: string;
}

// The in-memory thread model. The wire `version` tag (1 = legacy base64
// data-URI, 2 = line-oriented JSON) is a serialization detail owned by the
// codecs in metadata.ts and never lives on decoded objects. `updatedAt` is
// the head-level value only — writers set it for head-level changes (status,
// authors, display); the thread-level updatedAt on ICommentThread is derived
// at read time from head and reply timestamps.
export interface ICommentMetadata {
    status: TCommentStatus;
    authors?: string[];
    createdAt?: string;
    updatedAt?: string;
    display?: TCommentDisplayMetadata;
    replies: ICommentReply[];
}

export interface ICommentThread extends ICommentMetadata {
    id: string;
}

export interface ICommentRange {
    id: string;
    startPath: TBlockPath;
    endPath: TBlockPath;
    startOffset: number;
    endOffset: number;
    preview: string;
}

export type TCommentDiagnosticCode
    = | 'duplicate-open-marker'
        | 'duplicate-close-marker'
        | 'duplicate-metadata'
        | 'invalid-metadata'
        | 'malformed-marker'
        | 'missing-metadata'
        | 'orphan-close-marker'
        | 'orphan-metadata'
        | 'parse-error'
        | 'unclosed-open-marker'
        | 'orphan-reply'
        | 'invalid-reply';

export interface ICommentDiagnostic {
    code: TCommentDiagnosticCode;
    id: string;
    message: string;
}

export interface IParsedMarkdownComments {
    threads: ICommentThread[];
    ranges: ICommentRange[];
    diagnostics: ICommentDiagnostic[];
}

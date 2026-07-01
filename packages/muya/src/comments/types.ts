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

export interface ICommentMetadata {
    version: 1;
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
        | 'unclosed-open-marker';

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

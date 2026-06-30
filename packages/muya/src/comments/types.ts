import type { TBlockPath } from '../block/types';

export type TCommentStatus = 'open' | 'resolved';

export interface ICommentReply {
    author: string;
    createdAt: string;
    body: string;
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
}

export type TCommentDiagnosticCode
    = | 'duplicate-open-marker'
        | 'duplicate-metadata'
        | 'invalid-metadata'
        | 'missing-metadata'
        | 'orphan-close-marker'
        | 'orphan-metadata'
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

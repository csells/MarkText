import type { TBlockPath } from '../block/types';

export type TMutationRequest
    = | { kind: 'user-edit' }
        | { kind: 'user-command' }
        | { kind: 'history-command' }
        | { kind: 'review-command' }
        | { kind: 'document-reset' }
        | { kind: 'document-replace' };

export type TMutationMode = 'read-only' | 'direct' | 'tracked';

export type TMutationResult = 'untracked' | 'tracked' | 'rejected';

export interface ILocalMutationEdit {
    path: TBlockPath;
    start: number;
    end: number;
    inserted: string;
}

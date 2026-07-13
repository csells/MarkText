import type { Muya } from '../muya';
import type { IMutationAuthority } from './authority';
import type {
    ILocalMutationEdit,
    TMutationMode,
    TMutationRequest,
    TMutationResult,
} from './types';
import { CollectedError } from '../utils/collectedError';
import { PostCommitNotificationError } from './errors';
import { TrackedCriticMarkupPolicy } from './trackedCriticMarkup';

/** Sole policy boundary for Direct, Tracked, and ReadOnly mutation modes. */
export class MutationGateway {
    private readonly _trackedPolicy: TrackedCriticMarkupPolicy;

    constructor(
        private readonly _muya: Muya,
        private readonly _authority: IMutationAuthority,
    ) {
        this._trackedPolicy = new TrackedCriticMarkupPolicy(_muya);
    }

    assertActive(operation: string): void {
        this._authority.assertActive(operation);
    }

    private _mode(request: TMutationRequest): TMutationMode {
        if (
            request.kind === 'review-command'
            || request.kind === 'history-command'
            || request.kind === 'document-reset'
        ) {
            return 'direct';
        }
        if (this._muya.options.criticMarkupProjection !== 'marked')
            return 'read-only';
        if (request.kind === 'document-replace')
            return 'direct';
        return this._muya.options.criticMarkupTrackChanges
            ? 'tracked'
            : 'direct';
    }

    run(
        request: TMutationRequest,
        mutate: () => void,
        localEdit?: ILocalMutationEdit | readonly ILocalMutationEdit[],
    ): TMutationResult {
        if (this._authority.active) {
            mutate();
            return 'untracked';
        }

        const mode = this._mode(request);
        if (mode === 'read-only')
            return 'rejected';
        if (mode === 'direct') {
            if (
                request.kind === 'user-edit'
                || request.kind === 'user-command'
            ) {
                const replay = this._authority.run(() =>
                    this._prepareDirectUserMutation(mutate));
                this._replayPostCommit(replay);
            }
            else if (request.kind === 'document-reset') {
                const prepared = this._muya.eventCenter.buffer(() =>
                    this._authority.run(mutate));
                this._replayPostCommit(prepared.replay);
            }
            else {
                this._authority.run(mutate);
            }
            return 'untracked';
        }
        return this._authority.run(() =>
            this._trackedPolicy.runTrackedMutation(mutate, localEdit));
    }

    private _prepareDirectUserMutation(mutate: () => void): () => void {
        // A new user command owns only the operations it produces. Land any
        // earlier typing boundary before isolating its draft.
        this._muya.flush();
        const { editor, eventCenter } = this._muya;
        const beforeSelection = editor.selection.getSelection();
        const beforeSearch = editor.searchModule.checkpoint();
        let replay: (() => void) | null = null;

        try {
            const prepared = eventCenter.buffer(() => {
                const captured = editor.jsonState.capture(mutate);
                if (captured.operation !== null) {
                    editor.commitPendingContents(captured.operation, 'user');
                }
                else {
                    const liveState = editor.getLiveBlockState();
                    if (
                        JSON.stringify(liveState)
                        !== JSON.stringify(captured.afterState)
                    ) {
                        throw new TypeError(
                            'A direct mutation changed the live tree without emitting an operation.',
                        );
                    }
                }
            });
            replay = prepared.replay;
        }
        catch (error) {
            const rollbackErrors: unknown[] = [];
            try {
                eventCenter.suppress(() => {
                    editor.renderCurrentProjection(beforeSelection);
                    editor.searchModule.restore(beforeSearch);
                });
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            if (rollbackErrors.length) {
                throw new CollectedError(
                    [error, ...rollbackErrors],
                    'Direct mutation and its rollback both failed.',
                );
            }
            throw error;
        }
        return replay ?? (() => {});
    }

    /** Publish only after the authority scope has closed. */
    private _replayPostCommit(replay: () => void): void {
        // Listener failures must not roll back a durable state/history boundary,
        // and EventCenter still delivers every buffered event before surfacing
        // an aggregate error.
        try {
            replay();
        }
        catch (error) {
            throw new PostCommitNotificationError([error]);
        }
    }
}

import type { CriticMarkupDocument } from '../criticMarkup/document';
import type {
    ICriticMarkupCommitAnalysis,
} from '../criticMarkup/documentService';
import type { ICriticMarkupSourceEdit } from '../criticMarkup/trackChanges';
import type { Muya } from '../muya';
import type { IHistorySelection } from '../selection/types';
import type { TTrackedMarkdown } from '../state/markdownSourceMap';
import type {
    ICapturedStateMutation,
} from '../state/mutationCapture';
import type { TState } from '../state/types';
import type { ILocalMutationEdit, TMutationResult } from './types';
import {
    trackCriticMarkupEdits,
} from '../criticMarkup/trackChanges';
import { localOffset, sourceOffset, sourceRange } from '../mappedText';
import {
    SelectionCaretType,
    SelectionDirection,
} from '../selection/types';
import { markdownStatePath } from '../state/markdownSourceMap';
import {
    PostCommitNotificationError,
    PreparedSelectionError,
} from './errors';
import { deriveOperationSourceEdits } from './operationSourceEdits';

/**
 * Closed fail-closed taxonomy for tracked-commit rejections. Every gateway
 * rejection publishes exactly one of these reasons so presentation layers can
 * localize an actionable explanation instead of a silent no-op.
 */
export const CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS = Object.freeze([
    'unmappable-source-edit',
    'parser-conflict',
    'unmappable-tracked-selection',
    'missing-tracked-selection-block',
] as const);

export type TCriticMarkupTrackChangeRejectionReason
    = (typeof CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS)[number];

export interface ICriticMarkupTrackChangeRejection {
    readonly beforeMarkdown: string;
    readonly proposedMarkdown: string;
    readonly reason: TCriticMarkupTrackChangeRejectionReason;
}

function trackChangeRejection(
    beforeMarkdown: string,
    proposedMarkdown: string,
    reason: TCriticMarkupTrackChangeRejectionReason,
): ICriticMarkupTrackChangeRejection {
    return Object.freeze({ beforeMarkdown, proposedMarkdown, reason });
}

function cloneSelection(
    selection: IHistorySelection | null,
): IHistorySelection | null {
    if (!selection)
        return null;

    return {
        ...selection,
        anchor: {
            ...selection.anchor,
            path: [...selection.anchor.path],
        },
        focus: {
            ...selection.focus,
            path: [...selection.focus.path],
        },
    };
}

function exactSourceEdits(
    capture: ICapturedStateMutation<unknown>,
    beforeDocument: CriticMarkupDocument,
    proposedMapped: TTrackedMarkdown,
    localEdits: readonly ILocalMutationEdit[] = [],
): ICriticMarkupSourceEdit[] | null {
    if (localEdits.length) {
        const mapped: Array<ICriticMarkupSourceEdit | null> = localEdits.map((edit) => {
            const start = beforeDocument.sourceOffsetAt(
                markdownStatePath(edit.path),
                localOffset(edit.start),
            );
            const end = beforeDocument.sourceOffsetAt(
                markdownStatePath(edit.path),
                localOffset(edit.end),
            );
            return start === null || end === null
                ? null
                : {
                        oldRange: sourceRange(start, end),
                        inserted: edit.inserted,
                    };
        });
        if (mapped.includes(null))
            return null;
        return mapped.filter(
            (edit): edit is ICriticMarkupSourceEdit => edit !== null,
        );
    }

    return deriveOperationSourceEdits(
        capture,
        beforeDocument.mappedText,
        proposedMapped,
    );
}

function textAtPath(
    state: TState[],
    path: readonly (string | number)[],
): string | null {
    let value: unknown = state;
    for (const part of path) {
        if (
            value === null
            || typeof value !== 'object'
            || !(part in value)
        ) {
            return null;
        }
        value = (value as Record<string | number, unknown>)[part];
    }
    return typeof value === 'string' ? value : null;
}

function preparedSelection(
    state: TState[],
    document: CriticMarkupDocument,
    start: number,
    end: number,
    template: IHistorySelection | null,
): IHistorySelection | null {
    // Track Changes places its collapsed caret immediately after the last
    // authored replacement. At an atomic inline boundary (notably the end of
    // an image), that source offset has two possible local owners. Select the
    // content on the previous side so the caret remains after the authored
    // construct instead of becoming unmappable at its closing syntax.
    const anchor = document.localPositionAt(
        sourceOffset(start),
        start === end ? 'previous' : 'next',
    );
    const focus = document.localPositionAt(sourceOffset(end), 'previous');
    if (!anchor || !focus)
        return null;

    const anchorText = textAtPath(state, anchor.path);
    const focusText = textAtPath(state, focus.path);
    if (
        anchorText === null
        || focusText === null
        || anchor.offset < 0
        || focus.offset < 0
        || anchor.offset > anchorText.length
        || focus.offset > focusText.length
    ) {
        return null;
    }

    return {
        ...(template ?? {
            isCollapsed: start === end,
            isSelectionInSameBlock: false,
            direction: SelectionDirection.NONE,
            type: SelectionCaretType.CARET,
        }),
        anchor: { path: [...anchor.path], offset: anchor.offset },
        focus: { path: [...focus.path], offset: focus.offset },
        isCollapsed: start === end,
        isSelectionInSameBlock:
            JSON.stringify(anchor.path) === JSON.stringify(focus.path),
    };
}

/**
 * Owns synchronous structural edits while Track Changes is enabled. Muya's
 * existing block handlers first mutate the live tree and queue JSON ops for
 * the next animation frame. This service observes that proposed live state,
 * converts the captured operation-defined source edits into native
 * CriticMarkup, drops the isolated raw proposal, and publishes one
 * rebuild/history boundary.
 */
export class TrackedCriticMarkupPolicy {
    private _running = false;

    constructor(private readonly _muya: Muya) {}

    runTrackedMutation(
        mutate: () => void,
        localEdit?: ILocalMutationEdit
            | readonly ILocalMutationEdit[],
    ): TMutationResult {
        if (this._running) {
            mutate();
            return 'untracked';
        }

        // The transaction owns only ops produced by `mutate`; land any earlier
        // keystroke before taking the canonical before snapshot.
        this._muya.flush();
        const { editor } = this._muya;
        const { jsonState } = editor;
        const documentSession = editor.criticMarkupDocument.beginSession();
        const beforeState = jsonState.getState();
        const beforeDocument = documentSession.getContext();
        const beforeMarkdown = beforeDocument.markdown;
        const beforeSelection = cloneSelection(
            editor.selection.getSelection(),
        );

        this._running = true;
        let committed = false;
        let committedDocument: CriticMarkupDocument | null = null;
        let proposedMarkdown = beforeMarkdown;
        try {
            const captured = this._muya.eventCenter.suppress(() =>
                jsonState.capture(mutate));
            const proposedState = captured.afterState;
            const proposedMapped = documentSession.mapState(proposedState);
            proposedMarkdown = proposedMapped.text;
            if (proposedMarkdown === beforeMarkdown) {
                this._restoreBefore(beforeState, beforeSelection);
                return 'untracked';
            }

            const edits = exactSourceEdits(
                captured,
                beforeDocument,
                proposedMapped,
                localEdit
                    ? Array.isArray(localEdit) ? localEdit : [localEdit]
                    : [],
            );
            if (!edits) {
                this._restoreBefore(beforeState, beforeSelection);
                this._muya.eventCenter.emit(
                    'critic-markup-track-change-rejected',
                    trackChangeRejection(
                        beforeMarkdown,
                        proposedMarkdown,
                        'unmappable-source-edit',
                    ),
                );
                return 'rejected';
            }

            const proposedDocument
                = documentSession.createForMapped(proposedMapped);
            // The tracked revision is parsed exactly once: that artifact's
            // semantic-only view serves trackChanges' projection proof and
            // its state document becomes the committed tree below. Sources
            // the native parse cannot describe byte-exactly keep the
            // parser-context path.
            const commitAnalyses = new Map<
                string,
                ICriticMarkupCommitAnalysis
            >();
            const tracked = trackCriticMarkupEdits(
                beforeMarkdown,
                proposedMarkdown,
                edits,
                {
                    beforeDocument,
                    proposedDocument,
                    createDocument: (source) => {
                        const cached = commitAnalyses.get(source);
                        if (cached)
                            return cached.proofDocument;
                        const analyzed
                            = documentSession.analyzeForCommit(source);
                        if (!analyzed)
                            return documentSession.createForSource(source);
                        commitAnalyses.set(source, analyzed);
                        return analyzed.proofDocument;
                    },
                },
            );
            if (!tracked) {
                this._restoreBefore(beforeState, beforeSelection);
                this._muya.eventCenter.emit(
                    'critic-markup-track-change-rejected',
                    trackChangeRejection(
                        beforeMarkdown,
                        proposedMarkdown,
                        'parser-conflict',
                    ),
                );
                return 'rejected';
            }

            const commit = commitAnalyses.get(tracked.text);
            if (!commit || commit.document.analysis !== tracked.analysis) {
                throw new TypeError(
                    'Tracked CriticMarkup commit is detached from its single-parse analysis.',
                );
            }
            const trackedState = commit.states;
            const trackedDocument = commit.document;
            committedDocument = trackedDocument;
            const nextSelection = preparedSelection(
                trackedState,
                trackedDocument,
                tracked.selectionStart,
                tracked.selectionEnd,
                beforeSelection,
            );
            if (!nextSelection) {
                this._restoreBefore(beforeState, beforeSelection);
                this._muya.eventCenter.emit(
                    'critic-markup-track-change-rejected',
                    trackChangeRejection(
                        beforeMarkdown,
                        proposedMarkdown,
                        'unmappable-tracked-selection',
                    ),
                );
                return 'rejected';
            }

            documentSession.stagePrepared(trackedDocument);
            if (!this._muya.replaceContentWithSelection(
                trackedState,
                beforeSelection,
                nextSelection,
            )) {
                throw new TypeError(
                    'Tracked structural edit produced no canonical document change.',
                );
            }
            committed = true;
            documentSession.adoptCommitted(trackedDocument);

            return 'tracked';
        }
        catch (error) {
            // A post-commit notification failure happens AFTER the tracked
            // replacement committed durably; listener failures must not roll
            // back a durable state/history boundary (gateway contract), and
            // restoring here would mask the original error behind a bogus
            // invariant violation.
            if (error instanceof PostCommitNotificationError) {
                committed = true;
                if (committedDocument)
                    documentSession.adoptCommitted(committedDocument);
                throw error;
            }
            if (!committed)
                this._restoreBefore(beforeState, beforeSelection);
            if (error instanceof PreparedSelectionError) {
                this._muya.eventCenter.emit(
                    'critic-markup-track-change-rejected',
                    trackChangeRejection(
                        beforeMarkdown,
                        proposedMarkdown,
                        'missing-tracked-selection-block',
                    ),
                );
                return 'rejected';
            }
            throw error;
        }
        finally {
            documentSession.clearPrepared();
            this._running = false;
        }
    }

    private _restoreBefore(
        state: TState[],
        selection: IHistorySelection | null,
    ): void {
        const current = this._muya.editor.jsonState.getState();
        if (JSON.stringify(current) !== JSON.stringify(state)) {
            throw new TypeError(
                'Isolated mutation proposal changed canonical JSON state.',
            );
        }
        this._muya.eventCenter.suppress(() =>
            this._muya.editor.renderCurrentProjection(selection));
    }
}

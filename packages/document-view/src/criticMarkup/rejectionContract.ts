import type { RejectionCode } from '@marktext/document-core';

/** Closed presentation contract for actual session-owned tracked-edit rejections. */
export const CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS = Object.freeze([
    'stale-selection',
    'selection-not-collapsed',
    'selection-collapsed',
    'nothing-to-undo',
    'nothing-to-redo',
    'no-source-change',
    'invalid-command-argument',
    'read-only-change-arm',
    'read-only-projection',
    'source-only-revision',
    'precommit-failed',
    'target-not-found',
    'wrong-target-kind',
    'invalid-source-range',
    'empty-comment',
    'invalid-comment-payload',
    'selection-crosses-syntax-boundary',
    'selection-includes-hidden-comment',
    'selection-partially-intersects-critic-markup',
    'selection-inside-markdown-literal',
    'selection-partially-intersects-markdown-literal',
    'markdown-literal-source-only',
    'selection-has-no-revised-contribution',
    'selection-has-no-original-contribution',
    'hidden-comment-loss',
    'comment-payload-target',
    'candidate-source-only',
    'semantic-postcondition-failed',
] as const satisfies readonly RejectionCode[]);

export type TCriticMarkupTrackChangeRejectionReason
    = (typeof CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS)[number];

export interface ICriticMarkupTrackChangeRejection {
    readonly beforeMarkdown: string;
    readonly reason: TCriticMarkupTrackChangeRejectionReason;
}

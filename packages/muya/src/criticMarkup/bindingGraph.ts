import type { Tokens } from 'marked';
import type { TMappedTextPath } from '../mappedText';

/**
 * Neutral parser-binding contracts shared by every CriticMarkup path domain.
 *
 * A binding graph is the sole topology authority for one exact parse
 * revision: the Muya state builder emits a graph in the markdown-state path
 * domain, and the located Marked analysis emits one in the marked parser
 * path domain. Fragment-bearing CriticMarkup documents are constructible
 * only from a complete graph — generic mapped-span inference does not exist.
 */
export interface ICriticMarkupBindingRange {
    readonly start: number;
    readonly end: number;
}

interface ICriticMarkupBlockBindingBase<Path extends TMappedTextPath> {
    /** Produced node path in this graph's immutable parse revision. */
    readonly path: Path;
    readonly itemId: string;
    readonly criticType: Tokens.CriticMarkupType;
    readonly arm: Tokens.CriticMarkupArm['name'];
    readonly role: Tokens.CriticMarkupBoundaryAttachment['role'];
    /** Canonical source envelope owned by the native fragment. */
    readonly sourceRange: ICriticMarkupBindingRange;
    /** Semantic content range relative to `sourceRange.start`. */
    readonly localRange: ICriticMarkupBindingRange;
}

export interface ICriticMarkupBlockContentBinding<
    Path extends TMappedTextPath = TMappedTextPath,
> extends ICriticMarkupBlockBindingBase<Path> {
    readonly kind: 'content';
}

export interface ICriticMarkupBlockBoundaryBinding<
    Path extends TMappedTextPath = TMappedTextPath,
> extends ICriticMarkupBlockBindingBase<Path> {
    readonly kind: 'boundary';
    readonly edge: Tokens.CriticMarkupBoundaryAttachment['edge'];
}

export type TCriticMarkupBlockBinding<
    Path extends TMappedTextPath = TMappedTextPath,
> = | ICriticMarkupBlockContentBinding<Path>
    | ICriticMarkupBlockBoundaryBinding<Path>;

export interface ICriticMarkupInlineMarkerBindingSegment {
    readonly kind: 'marker';
    readonly marker: Tokens.CriticMarkupMarker['name'];
    readonly localRange: ICriticMarkupBindingRange;
    readonly sourceRange: ICriticMarkupBindingRange;
}

export interface ICriticMarkupInlineContentBindingSegment {
    readonly kind: 'content';
    readonly arm: Tokens.CriticMarkupArm['name'];
    readonly localRange: ICriticMarkupBindingRange;
    readonly sourceRange: ICriticMarkupBindingRange;
}

export type TCriticMarkupInlineBindingSegment
    = | ICriticMarkupInlineMarkerBindingSegment
        | ICriticMarkupInlineContentBindingSegment;

export interface ICriticMarkupInlineBinding<
    Path extends TMappedTextPath = TMappedTextPath,
> {
    /** Produced formattable leaf path in this parse revision. */
    readonly path: Path;
    readonly itemId: string;
    readonly criticType: Tokens.CriticMarkupType;
    readonly arm: Tokens.CriticMarkupArm['name'];
    readonly role: Tokens.CriticMarkupFragment['role'];
    /** Actual UTF-16 envelope in the produced leaf's local text. */
    readonly localRange: ICriticMarkupBindingRange;
    /** Canonical source envelope owned by the native inline fragment. */
    readonly sourceRange: ICriticMarkupBindingRange;
    readonly segments: readonly TCriticMarkupInlineBindingSegment[];
}

/** Parser-owned CriticMarkup topology for one generated revision. */
export interface ICriticMarkupBindingGraph<
    Path extends TMappedTextPath = TMappedTextPath,
> {
    readonly block: readonly TCriticMarkupBlockBinding<Path>[];
    readonly inline: readonly ICriticMarkupInlineBinding<Path>[];
}

export function emptyCriticMarkupBindingGraph<
    Path extends TMappedTextPath,
>(): ICriticMarkupBindingGraph<Path> {
    return Object.freeze({
        block: Object.freeze([]),
        inline: Object.freeze([]),
    });
}

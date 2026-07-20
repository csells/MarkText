import type { TCriticMarkupProjection } from './project';

interface IRenderedCriticMarkupBlockState {
    textRevision: number;
    renderedTextRevision: number;
    renderedProjection: TCriticMarkupProjection | null;
    hasInlineHiddenComment: boolean;
    hasStructuralHiddenComment: boolean;
}

const BLOCK_STATES = new WeakMap<object, IRenderedCriticMarkupBlockState>();

function blockState(block: object): IRenderedCriticMarkupBlockState {
    let state = BLOCK_STATES.get(block);
    if (!state) {
        state = {
            textRevision: 0,
            renderedTextRevision: -1,
            renderedProjection: null,
            hasInlineHiddenComment: false,
            hasStructuralHiddenComment: false,
        };
        BLOCK_STATES.set(block, state);
    }
    return state;
}

/** Invalidate an inline-render proof before a native block's source changes. */
export function noteCriticMarkupBlockTextMutation(block: object): void {
    blockState(block).textRevision++;
}

/** Record parser-owned structural visibility for the currently bound block. */
export function bindCriticMarkupStructuralVisibility(
    block: object,
    hasHiddenComment: boolean,
): void {
    blockState(block).hasStructuralHiddenComment = hasHiddenComment;
}

/** Publish one completed inline render; failed or interrupted renders never arm it. */
export function markCriticMarkupBlockRendered(
    block: object,
    projection: TCriticMarkupProjection,
    hasHiddenComment: boolean,
): void {
    const state = blockState(block);
    state.renderedTextRevision = state.textRevision;
    state.renderedProjection = projection;
    state.hasInlineHiddenComment = hasHiddenComment;
}

/**
 * O(1) negative proof for ordinary caret placement. Missing/stale render state
 * refuses, leaving positive relocation to the canonical parser document.
 */
export function renderedBlockProvesNoHiddenCriticComment(
    block: object,
    projection: TCriticMarkupProjection,
): boolean {
    const state = BLOCK_STATES.get(block);
    return Boolean(
        state
        && state.renderedTextRevision === state.textRevision
        && state.renderedProjection === projection
        && !state.hasInlineHiddenComment
        && !state.hasStructuralHiddenComment,
    );
}

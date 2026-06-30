import type { TBlockPath } from '../block/types';
import type { TState } from '../state/types';
import type { ICommentRange } from './types';

export function commentPathKey(path: TBlockPath): string {
    return JSON.stringify(path);
}

export function buildTextPathIndexes(states: TState[]): Map<string, number> {
    const indexes = new Map<string, number>();
    let index = 0;

    const visit = (nodes: TState[], path: TBlockPath = []) => {
        nodes.forEach((state, stateIndex) => {
            const statePath = [...path, stateIndex];
            if ('text' in state && typeof state.text === 'string')
                indexes.set(commentPathKey([...statePath, 'text']), index++);

            if ('children' in state && Array.isArray(state.children))
                visit(state.children, [...statePath, 'children']);
        });
    };

    visit(states);
    return indexes;
}

export function compareTextPathEndpoints(
    indexes: Map<string, number>,
    aPath: TBlockPath,
    aOffset: number,
    bPath: TBlockPath,
    bOffset: number,
): number | null {
    const aIndex = indexes.get(commentPathKey(aPath));
    const bIndex = indexes.get(commentPathKey(bPath));
    if (aIndex == null || bIndex == null)
        return null;

    return aIndex - bIndex || aOffset - bOffset;
}

export function orderTextRange(
    indexes: Map<string, number>,
    anchorPath: TBlockPath,
    anchorOffset: number,
    focusPath: TBlockPath,
    focusOffset: number,
) {
    const order = compareTextPathEndpoints(indexes, anchorPath, anchorOffset, focusPath, focusOffset);
    if (order == null)
        return null;

    if (order <= 0) {
        return {
            startPath: anchorPath,
            startOffset: anchorOffset,
            endPath: focusPath,
            endOffset: focusOffset,
        };
    }

    return {
        startPath: focusPath,
        startOffset: focusOffset,
        endPath: anchorPath,
        endOffset: anchorOffset,
    };
}

export function selectionIntersectsCommentRange(
    range: ICommentRange,
    anchorPath: TBlockPath,
    anchorOffset: number,
    focusPath: TBlockPath,
    focusOffset: number,
    indexes: Map<string, number>,
): boolean {
    const selection = orderTextRange(indexes, anchorPath, anchorOffset, focusPath, focusOffset);
    if (!selection)
        return false;

    const selectionEndsBeforeRange = compareTextPathEndpoints(
        indexes,
        selection.endPath,
        selection.endOffset,
        range.startPath,
        range.startOffset,
    );
    if (selectionEndsBeforeRange == null || selectionEndsBeforeRange < 0)
        return false;

    const selectionStartsAfterRange = compareTextPathEndpoints(
        indexes,
        selection.startPath,
        selection.startOffset,
        range.endPath,
        range.endOffset,
    );

    return selectionStartsAfterRange != null && selectionStartsAfterRange <= 0;
}

import type { TBlockPath } from '../block/types';
import type { TState } from '../state/types';
import type { ICommentRange } from './types';
import { commentMarkerRegExpForId, parseCommentMetadataDefinition } from './syntax';

export function commentPathKey(path: TBlockPath): string {
    return JSON.stringify(path);
}

export interface ICommentSyntaxLocation {
    startPath: TBlockPath;
    startOffset: number;
    endPath: TBlockPath;
    endOffset: number;
}

// Locate the first marker or metadata-definition occurrence for a comment id.
// Diagnostics for orphan/malformed comments have no derived range, so this gives
// navigation a raw-syntax target instead of a dead no-op.
export function locateCommentSyntax(states: TState[], id: string): ICommentSyntaxLocation | null {
    const markerRegExp = commentMarkerRegExpForId(id);
    let found: ICommentSyntaxLocation | null = null;

    const visit = (nodes: TState[], path: TBlockPath): void => {
        for (let stateIndex = 0; stateIndex < nodes.length && !found; stateIndex += 1) {
            const state = nodes[stateIndex];
            const statePath = [...path, stateIndex];

            if ('text' in state && typeof state.text === 'string') {
                markerRegExp.lastIndex = 0;
                const markerMatch = markerRegExp.exec(state.text);
                if (markerMatch) {
                    found = {
                        startPath: statePath,
                        startOffset: markerMatch.index,
                        endPath: statePath,
                        endOffset: markerMatch.index + markerMatch[0].length,
                    };
                    return;
                }

                let lineStart = 0;
                for (const line of state.text.split('\n')) {
                    const definition = parseCommentMetadataDefinition(line);
                    if (definition && definition.id === id) {
                        found = {
                            startPath: statePath,
                            startOffset: lineStart,
                            endPath: statePath,
                            endOffset: lineStart + line.length,
                        };
                        return;
                    }
                    lineStart += line.length + 1;
                }
            }

            if ('children' in state && Array.isArray(state.children))
                visit(state.children, [...statePath, 'children']);
        }
    };

    visit(states, []);
    return found;
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

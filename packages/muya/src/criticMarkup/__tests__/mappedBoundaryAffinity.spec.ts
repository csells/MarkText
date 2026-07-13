import type { TBlockPath } from '../../block/types';
import type { TTrackedMarkdown } from '../../state/markdownSourceMap';
import type { IMarkdownSourceMap } from '../../state/stateToMarkdown';
import type { TState } from '../../state/types';
import type { CriticMarkupDocument } from '../document';
import { describe, expect, it } from 'vitest';
import { fromMarkdownSourceMap } from '../../state/markdownSourceMap';
import StateToMarkdown from '../../state/stateToMarkdown';
import { CriticMarkupAnalysis } from '../analysis';
import { createCriticMarkupDocument as createDocumentFromAnalysis } from '../document';

function createCriticMarkupDocument(source: TTrackedMarkdown) {
    return createDocumentFromAnalysis(
        CriticMarkupAnalysis.analyzeGrammar(source.text),
        source,
    );
}

type TBoundaryAffinity = 'previous' | 'next';

interface ILocalPosition {
    path: TBlockPath;
    offset: number;
}

function documentForSourceMap(
    sourceMap: IMarkdownSourceMap,
): CriticMarkupDocument {
    return createCriticMarkupDocument(fromMarkdownSourceMap(sourceMap));
}

function documentForState(states: TState[]): {
    document: CriticMarkupDocument;
    sourceMap: IMarkdownSourceMap;
} {
    const sourceMap = new StateToMarkdown().generateWithSourceMap(states);

    return {
        document: documentForSourceMap(sourceMap),
        sourceMap,
    };
}

/**
 * Exercise the target affinity contract without making this red test fail to
 * compile before the production API grows its explicit affinity parameter.
 */
function sourceOffsetAt(
    document: CriticMarkupDocument,
    path: TBlockPath,
    offset: number,
    affinity: TBoundaryAffinity,
): number | null {
    const lookup = document.sourceOffsetAt as unknown as (
        path: TBlockPath,
        offset: number,
        affinity: TBoundaryAffinity,
    ) => number | null;

    return lookup.call(document, path, offset, affinity);
}

function localPositionAt(
    document: CriticMarkupDocument,
    offset: number,
    affinity: TBoundaryAffinity,
): ILocalPosition | null {
    const lookup = document.localPositionAt as unknown as (
        offset: number,
        affinity: TBoundaryAffinity,
    ) => ILocalPosition | null;

    return lookup.call(document, offset, affinity);
}

describe('criticMarkupDocument mapped boundary affinity', () => {
    it('selects the requested side of one local boundary around generated source', () => {
        const path: TBlockPath = [0, 'text'];
        const document = documentForSourceMap({
            markdown: 'a<>b',
            leaves: [{
                path,
                pieces: [
                    {
                        localStart: 0,
                        localEnd: 1,
                        sourceStart: 0,
                        sourceEnd: 1,
                    },
                    {
                        localStart: 1,
                        localEnd: 2,
                        sourceStart: 3,
                        sourceEnd: 4,
                    },
                ],
            }],
        });

        expect(sourceOffsetAt(document, path, 1, 'previous')).toBe(1);
        expect(sourceOffsetAt(document, path, 1, 'next')).toBe(3);
    });

    it('selects the requested local endpoint from inside a structural source gap', () => {
        const leftPath: TBlockPath = [0, 'text'];
        const rightPath: TBlockPath = [1, 'text'];
        const document = documentForSourceMap({
            markdown: 'a<>b',
            leaves: [
                {
                    path: leftPath,
                    pieces: [{
                        localStart: 0,
                        localEnd: 1,
                        sourceStart: 0,
                        sourceEnd: 1,
                    }],
                },
                {
                    path: rightPath,
                    pieces: [{
                        localStart: 0,
                        localEnd: 1,
                        sourceStart: 3,
                        sourceEnd: 4,
                    }],
                },
            ],
        });

        expect(localPositionAt(document, 2, 'previous')).toEqual({
            path: leftPath,
            offset: 1,
        });
        expect(localPositionAt(document, 2, 'next')).toEqual({
            path: rightPath,
            offset: 0,
        });
    });

    it.each([
        {
            name: 'blockquote prefix',
            states: [{
                name: 'block-quote',
                children: [{ name: 'paragraph', text: 'quoted' }],
            }] as TState[],
            path: [0, 'children', 0, 'text'] as TBlockPath,
            prefixOffset: 0,
            text: 'quoted',
        },
        {
            name: 'list marker',
            states: [{
                name: 'bullet-list',
                meta: { marker: '-', loose: false },
                children: [{
                    name: 'list-item',
                    children: [{ name: 'paragraph', text: 'item' }],
                }],
            }] as TState[],
            path: [0, 'children', 0, 'children', 0, 'text'] as TBlockPath,
            prefixOffset: 0,
            text: 'item',
        },
    ])('uses next affinity for every byte in a generated $name', ({
        states,
        path,
        prefixOffset,
        text,
    }) => {
        const { document, sourceMap } = documentForState(states);
        const textStart = sourceMap.markdown.indexOf(text);

        expect(textStart).toBeGreaterThan(prefixOffset);
        for (let offset = prefixOffset; offset < textStart; offset++) {
            expect(localPositionAt(document, offset, 'next')).toEqual({
                path,
                offset: 0,
            });
        }
        expect(sourceOffsetAt(document, path, 0, 'next')).toBe(textStart);
    });

    it('names both sides of the generated escape before a table pipe', () => {
        const path: TBlockPath = [0, 'children', 1, 'children', 0, 'text'];
        const { document, sourceMap } = documentForState([{
            name: 'table',
            children: [
                {
                    name: 'table.row',
                    children: [{
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: 'head',
                    }],
                },
                {
                    name: 'table.row',
                    children: [{
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: 'a|b',
                    }],
                },
            ],
        }]);
        const escapeOffset = sourceMap.markdown.indexOf('\\|');

        expect(escapeOffset).toBeGreaterThanOrEqual(0);
        expect(sourceOffsetAt(document, path, 1, 'previous'))
            .toBe(escapeOffset);
        expect(sourceOffsetAt(document, path, 1, 'next'))
            .toBe(escapeOffset + 1);
        expect(localPositionAt(document, escapeOffset, 'next')).toEqual({
            path,
            offset: 1,
        });
        expect(localPositionAt(document, escapeOffset + 1, 'previous')).toEqual({
            path,
            offset: 1,
        });
    });

    it('keeps CRLF, astral text, and marker edges in UTF-16 source coordinates', () => {
        const path: TBlockPath = [0, 'text'];
        const markdown = 'A\r\n😀{++x++}';
        const document = documentForSourceMap({
            markdown,
            leaves: [{
                path,
                pieces: [{
                    localStart: 0,
                    localEnd: markdown.length,
                    sourceStart: 0,
                    sourceEnd: markdown.length,
                }],
            }],
        });
        const item = document.items[0];

        expect(markdown.indexOf('{++')).toBe(5);
        expect(item.syntax.range).toEqual({ start: 5, end: 12 });
        for (const offset of [0, 1, 2, 3, 4, 5, 8, 9, 12]) {
            expect(sourceOffsetAt(document, path, offset, 'next')).toBe(offset);
            expect(localPositionAt(document, offset, 'next')).toEqual({
                path,
                offset,
            });
        }
    });
});

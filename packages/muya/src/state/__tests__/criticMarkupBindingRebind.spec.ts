import type { ICriticMarkupStateBindingGraph } from '../criticMarkupStateBindings';
import type { TMarkdownStatePath } from '../markdownSourceMap';
import { describe, expect, it } from 'vitest';
import { localOffset, MappedText, sourceOffset } from '../../mappedText';
import { rebindCriticMarkupStateBindings } from '../rebindCriticMarkupStateBindings';
import { markdownStatePath } from '../markdownSourceMap';

const SOURCE = '0123456789';

function mappedWithNodes(
    nodes: readonly Readonly<{
        path: readonly (string | number)[];
        start: number;
        end: number;
    }>[],
    text = SOURCE,
): MappedText<TMarkdownStatePath> {
    return new MappedText(
        text,
        [],
        nodes.map(node => ({
            path: markdownStatePath(node.path),
            sourceStart: sourceOffset(node.start),
            sourceEnd: sourceOffset(node.end),
        })),
    );
}

function mappedWithSpans(
    spans: readonly Readonly<{
        path: readonly (string | number)[];
        localStart: number;
        localEnd: number;
        sourceStart: number;
        sourceEnd: number;
    }>[],
): MappedText<TMarkdownStatePath> {
    return new MappedText(SOURCE, spans.map(span => ({
        path: markdownStatePath(span.path),
        localStart: localOffset(span.localStart),
        localEnd: localOffset(span.localEnd),
        sourceStart: sourceOffset(span.sourceStart),
        sourceEnd: sourceOffset(span.sourceEnd),
    })));
}

function emptyGraph(): ICriticMarkupStateBindingGraph {
    return Object.freeze({
        block: Object.freeze([]),
        inline: Object.freeze([]),
    });
}

function boundaryGraph(path: TMarkdownStatePath): ICriticMarkupStateBindingGraph {
    return Object.freeze({
        block: Object.freeze([Object.freeze({
            kind: 'boundary',
            path,
            itemId: 'critic-boundary',
            criticType: 'addition',
            arm: 'content',
            role: 'only',
            edge: 'before',
            sourceRange: Object.freeze({ start: 2, end: 5 }),
            localRange: Object.freeze({ start: 3, end: 3 }),
        })]),
        inline: Object.freeze([]),
    });
}

describe('CriticMarkup state-binding rebinding', () => {
    it('requires byte-identical source authority before rebinding', () => {
        expect(() => rebindCriticMarkupStateBindings(
            emptyGraph(),
            new MappedText(SOURCE),
            new MappedText('012345678X'),
        )).toThrow(
            'CriticMarkup state bindings require one exact source revision.',
        );
    });

    it('rejects an inline segment detached from its source map', () => {
        const source = mappedWithSpans([{
            path: [0, 'text'],
            localStart: 0,
            localEnd: 2,
            sourceStart: 2,
            sourceEnd: 4,
        }]);
        const target = mappedWithSpans([{
            path: [9, 'text'],
            localStart: 0,
            localEnd: 3,
            sourceStart: 2,
            sourceEnd: 5,
        }]);
        const graph: ICriticMarkupStateBindingGraph = Object.freeze({
            block: Object.freeze([]),
            inline: Object.freeze([Object.freeze({
                path: markdownStatePath([0, 'text']),
                itemId: 'critic-inline',
                criticType: 'addition',
                arm: 'content',
                role: 'only',
                localRange: Object.freeze({ start: 0, end: 3 }),
                sourceRange: Object.freeze({ start: 2, end: 5 }),
                segments: Object.freeze([Object.freeze({
                    kind: 'content',
                    arm: 'content',
                    localRange: Object.freeze({ start: 0, end: 3 }),
                    sourceRange: Object.freeze({ start: 2, end: 5 }),
                })]),
            })]),
        });

        expect(() => rebindCriticMarkupStateBindings(
            graph,
            source,
            target,
        )).toThrow(
            'Native inline CriticMarkup binding critic-inline is detached from its parser state revision.',
        );
    });

    it('rejects a block path absent from its source revision', () => {
        expect(() => rebindCriticMarkupStateBindings(
            boundaryGraph(markdownStatePath([99])),
            mappedWithNodes([{ path: [0], start: 0, end: 10 }]),
            mappedWithNodes([{ path: [1], start: 0, end: 10 }]),
        )).toThrow(
            'Native block CriticMarkup binding critic-boundary is detached from its parser state revision.',
        );
    });

    it('fails when the target lacks the equivalent nesting rank', () => {
        const graph: ICriticMarkupStateBindingGraph = Object.freeze({
            block: Object.freeze([Object.freeze({
                kind: 'content',
                path: markdownStatePath([0]),
                itemId: 'critic-content',
                criticType: 'addition',
                arm: 'content',
                role: 'only',
                sourceRange: Object.freeze({ start: 2, end: 8 }),
                localRange: Object.freeze({ start: 0, end: 6 }),
            })]),
            inline: Object.freeze([]),
        });

        expect(() => rebindCriticMarkupStateBindings(
            graph,
            mappedWithNodes([
                { path: [0], start: 0, end: 10 },
                { path: [0, 'children', 0], start: 2, end: 8 },
            ]),
            mappedWithNodes([{ path: [7], start: 0, end: 10 }]),
        )).toThrow(
            'Native block CriticMarkup binding critic-content cannot bind to the live state revision.',
        );
    });

    it('rejects a nonzero local range on a boundary binding', () => {
        const graph = boundaryGraph(markdownStatePath([0]));
        const invalid: ICriticMarkupStateBindingGraph = Object.freeze({
            ...graph,
            block: Object.freeze([Object.freeze({
                ...graph.block[0],
                localRange: Object.freeze({ start: 1, end: 2 }),
            })]),
        });

        expect(() => rebindCriticMarkupStateBindings(
            invalid,
            mappedWithNodes([{ path: [0], start: 0, end: 10 }]),
            mappedWithNodes([{ path: [1], start: 0, end: 10 }]),
        )).toThrow(
            'Native block CriticMarkup binding critic-boundary has no parser-owned carrier.',
        );
    });

    it('rebinds a marker-only boundary at the start of the document', () => {
        const graph = boundaryGraph(markdownStatePath([0]));
        const bof: ICriticMarkupStateBindingGraph = Object.freeze({
            ...graph,
            block: Object.freeze([Object.freeze({
                ...graph.block[0],
                itemId: 'critic-bof',
                sourceRange: Object.freeze({ start: 0, end: 3 }),
                localRange: Object.freeze({ start: 0, end: 0 }),
            })]),
        });

        const rebound = rebindCriticMarkupStateBindings(
            bof,
            mappedWithNodes([{ path: [0], start: 0, end: 10 }]),
            mappedWithNodes([{ path: [1], start: 0, end: 10 }]),
        );

        expect(rebound.block[0]).toEqual({
            ...bof.block[0],
            path: markdownStatePath([1]),
        });
    });

    it('fails closed instead of skipping an ambiguous source carrier', () => {
        const source = mappedWithNodes([
            { path: [0], start: 0, end: 6 },
            { path: [1], start: 1, end: 7 },
            { path: [2], start: 8, end: 9 },
        ]);
        const target = mappedWithNodes([
            { path: [3], start: 0, end: 6 },
            { path: [4], start: 1, end: 7 },
            { path: [5], start: 8, end: 9 },
        ]);

        expect(() => rebindCriticMarkupStateBindings(
            boundaryGraph(markdownStatePath([2])),
            source,
            target,
        )).toThrow('has no parser-owned carrier');
    });

    it('fails closed instead of skipping an ambiguous target carrier', () => {
        const source = mappedWithNodes([
            { path: [0], start: 0, end: 6 },
        ]);
        const target = mappedWithNodes([
            { path: [3], start: 0, end: 6 },
            { path: [4], start: 1, end: 7 },
        ]);

        expect(() => rebindCriticMarkupStateBindings(
            boundaryGraph(markdownStatePath([0])),
            source,
            target,
        )).toThrow(
            'Native block CriticMarkup binding critic-boundary cannot bind to the live state revision.',
        );
    });
});

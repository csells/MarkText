import type { TTrackedMarkdown } from '../../state/markdownSourceMap';
import type { IMarkdownSourceMap } from '../../state/stateToMarkdown';
import { describe, expect, it } from 'vitest';
import {
    localOffset,
    localRange,
    sourceOffset,
    sourceRange,
} from '../../mappedText';
import {
    fromMarkdownSourceMap,
    markdownStatePath,
} from '../../state/markdownSourceMap';
import { CriticMarkupAnalysis } from '../analysis';
import { createCriticMarkupDocument as createDocumentFromAnalysis } from '../document';
import { ExcludedRanges } from '../excludedRanges';
import { buildCriticMarkupRenderPlan } from '../renderPlan';

function createCriticMarkupDocument(
    source: TTrackedMarkdown,
    excludedRanges = ExcludedRanges.empty(source.text.length),
) {
    return createDocumentFromAnalysis(
        CriticMarkupAnalysis.analyzeGrammar(source.text, excludedRanges),
        source,
        undefined,
        undefined,
        'grammar',
    );
}

function sourceMapForLeaves(
    markdown: string,
    leaves: Array<{ path: (string | number)[]; text: string }>,
): IMarkdownSourceMap {
    let sourceStart = 0;

    return {
        markdown,
        leaves: leaves.map(({ path, text }) => {
            const found = markdown.indexOf(text, sourceStart);
            if (found === -1)
                throw new TypeError(`Test leaf ${JSON.stringify(text)} is absent.`);
            sourceStart = found + text.length;

            return {
                path,
                pieces: [{
                    localStart: 0,
                    localEnd: text.length,
                    sourceStart: found,
                    sourceEnd: found + text.length,
                }],
            };
        }),
    };
}

const path = (...parts: Array<string | number>) => markdownStatePath(parts);

describe('criticMarkup document model', () => {
    it('freezes every public document authority and projects from immutable analysis', () => {
        const markdown = '{++x++}';
        const document = createCriticMarkupDocument(fromMarkdownSourceMap(
            sourceMapForLeaves(markdown, [{
                path: [0, 'text'],
                text: markdown,
            }]),
        ));
        const publicProperties = [
            'analysis',
            'items',
            'roots',
            'mappedText',
            'markdown',
            'excludedRanges',
        ] as const;

        expect(Object.isFrozen(document)).toBe(true);
        for (const property of publicProperties) {
            const original = document[property];
            const replacement = property === 'markdown'
                ? 'corrupt'
                : Object.freeze({ corrupt: property });
            const accepted = Reflect.set(document, property, replacement);
            if (accepted)
                Reflect.set(document, property, original);

            expect(accepted, `${property} accepted cache poisoning`).toBe(false);
            expect(document[property]).toBe(original);
        }

        expect(document.project('original')).toBe('');
        expect(document.project('revised')).toBe('x');
    });

    it('deeply freezes the indexed semantic graph for its revision lifetime', () => {
        const markdown = '{++outer {~~old~>new~~} tail++}';
        const document = createCriticMarkupDocument(fromMarkdownSourceMap(
            sourceMapForLeaves(markdown, [{
                path: [0, 'text'],
                text: markdown,
            }]),
        ));
        const [outer, inner] = document.items;
        const inputs = document.fragmentsForPath(path(0, 'text'));
        const plan = buildCriticMarkupRenderPlan(inputs);

        const mutations: Array<() => void> = [
            () => (document.items as unknown[]).pop(),
            () => (document.roots as unknown[]).pop(),
            () => ((outer as { id: string }).id = 'corrupt'),
            () => ((outer.syntax.range as { start: number }).start = 99),
            () => ((outer.syntax.markers.open.range as { end: number }).end = 99),
            () => (outer.syntax.nested as unknown[]).pop(),
            () => (outer.fragments as unknown[]).pop(),
            () => (outer.fragments[0].path as unknown as unknown[]).pop(),
            () => ((outer.fragments[0].localRange as { start: number }).start = 99),
            () => ((outer.fragments[0].sourceRange as { end: number }).end = 99),
            () => (outer.fragments[0].segments as unknown[]).pop(),
            () => ((outer.fragments[0].segments[0].localRange as {
                start: number;
            }).start = 99),
            () => ((outer.fragments[0].segments[0].sourceRange as {
                end: number;
            }).end = 99),
            () => (document.pathsWithFragments()[0] as unknown as unknown[]).pop(),
            () => (inputs as unknown[]).pop(),
        ];

        mutations.forEach(mutate => expect(mutate).toThrow(TypeError));
        expect(document.itemById(outer.id)).toBe(outer);
        expect(document.childrenOf(outer.id)).toEqual([inner]);
        expect(document.itemAt(path(0, 'text'), inner.fragments[0].localRange.start))
            .toBe(inner);
        expect(document.fragmentsForPath(path(0, 'text'))).toBe(inputs);
        expect(buildCriticMarkupRenderPlan(inputs)).toBe(plan);
        expect(document.project('revised')).toBe('outer new tail');
    });

    it('keeps one logical addition across Markdown block boundaries', () => {
        const markdown = 'before {++one\n\n# two++} after\n';
        const sourceMap = sourceMapForLeaves(markdown, [
            { path: [0, 'text'], text: 'before {++one' },
            { path: [1, 'text'], text: '# two++} after' },
        ]);

        const document = createCriticMarkupDocument(fromMarkdownSourceMap(sourceMap));

        expect(document.items).toHaveLength(1);
        expect(document.items[0]).toMatchObject({
            id: 'critic-7-23',
            parentId: null,
            depth: 0,
            syntax: {
                type: 'addition',
                raw: '{++one\n\n# two++}',
                range: { start: 7, end: 23 },
            },
            fragments: [
                {
                    path: [0, 'text'],
                    role: 'start',
                    localRange: { start: 7, end: 13 },
                    segments: [
                        {
                            kind: 'marker',
                            marker: 'open',
                            localRange: { start: 7, end: 10 },
                            sourceRange: { start: 7, end: 10 },
                        },
                        {
                            kind: 'content',
                            arm: 'content',
                            localRange: { start: 10, end: 13 },
                            sourceRange: { start: 10, end: 13 },
                        },
                    ],
                },
                {
                    path: [1, 'text'],
                    role: 'end',
                    localRange: { start: 0, end: 8 },
                    segments: [
                        {
                            kind: 'content',
                            arm: 'content',
                            localRange: { start: 0, end: 5 },
                            sourceRange: { start: 15, end: 20 },
                        },
                        {
                            kind: 'marker',
                            marker: 'close',
                            localRange: { start: 5, end: 8 },
                            sourceRange: { start: 20, end: 23 },
                        },
                    ],
                },
            ],
        });
    });

    it('labels both substitution arms and its separator across three blocks', () => {
        const markdown = 'before {~~old\n\n# tail~>new\n\nend~~} after\n';
        const sourceMap = sourceMapForLeaves(markdown, [
            { path: [0, 'text'], text: 'before {~~old' },
            { path: [1, 'text'], text: '# tail~>new' },
            { path: [2, 'text'], text: 'end~~} after' },
        ]);

        const item = createCriticMarkupDocument(fromMarkdownSourceMap(sourceMap)).items[0];

        expect(item.syntax.type).toBe('substitution');
        expect(item.fragments.map(fragment => fragment.role))
            .toEqual(['start', 'middle', 'end']);
        expect(item.fragments.flatMap(fragment => fragment.segments).map(segment =>
            segment.kind === 'marker'
                ? `marker:${segment.marker}`
                : `content:${segment.arm}`,
        )).toEqual([
            'marker:open',
            'content:old',
            'content:old',
            'marker:separator',
            'content:new',
            'content:new',
            'marker:close',
        ]);
    });

    it('selects the deepest nested item from any linked fragment', () => {
        const markdown = '{++outer\n\n{--inner--} tail++}\n';
        const sourceMap = sourceMapForLeaves(markdown, [
            { path: [0, 'text'], text: '{++outer' },
            { path: [1, 'text'], text: '{--inner--} tail++}' },
        ]);
        const document = createCriticMarkupDocument(fromMarkdownSourceMap(sourceMap));

        expect(document.items).toHaveLength(2);
        expect(document.items[1]).toMatchObject({
            parentId: document.items[0].id,
            depth: 1,
            syntax: { type: 'deletion' },
        });
        expect(document.itemAt(path(1, 'text'), localOffset(5))?.syntax.type).toBe('deletion');
        expect(document.itemAt(path(0, 'text'), localOffset(5))?.syntax.type).toBe('addition');

        const [outer, inner] = document.items;
        const innerTextStart = markdown.indexOf('inner');
        expect(document.childrenOf(null)).toEqual([outer]);
        expect(document.childrenOf(outer.id)).toEqual([inner]);
        expect(document.itemsContainingSourceRange(sourceRange(
            innerTextStart,
            innerTextStart + 'inner'.length,
        ))).toEqual([inner, outer]);
        expect(document.itemIntersectingSourceRange(sourceRange(
            inner.syntax.range.start,
            inner.syntax.range.start + 1,
        ))).toBe(inner);
        expect(document.itemStartingAtSourceOffset(sourceOffset(inner.syntax.range.start)))
            .toBe(inner);

        const indexedFragments = document.fragmentsForPath(path(1, 'text'));
        expect(indexedFragments).toBe(document.fragmentsForPath(path(1, 'text')));
        expect(indexedFragments.map(({ item }) => item)).toEqual([
            outer,
            inner,
        ]);
        expect(document.pathsWithFragments()).toEqual([
            [0, 'text'],
            [1, 'text'],
        ]);
        expect(document.pathsWithFragments())
            .toBe(document.pathsWithFragments());
        expect(document.fragmentsForPath(path('missing', 'text'))).toEqual([]);
    });

    it('honors parser-derived literal source ranges', () => {
        const markdown = '[x]({++literal++}) and {++real++}\n';
        const sourceMap = sourceMapForLeaves(markdown, [
            { path: [0, 'text'], text: markdown.trimEnd() },
        ]);
        const literalStart = markdown.indexOf('({++literal++})') + 1;

        const document = createCriticMarkupDocument(
            fromMarkdownSourceMap(sourceMap),
            ExcludedRanges.from(markdown.length, [{
                start: literalStart,
                end: literalStart + '{++literal++}'.length,
            }]),
        );

        expect(document.items).toHaveLength(1);
        expect(document.items[0].syntax.raw).toBe('{++real++}');
    });

    it('projects one mapped image-alternative range from the canonical forest', () => {
        const markdown = '![before {++new++} {--old--} after](image.png)\n';
        const sourceMap = sourceMapForLeaves(markdown, [
            { path: [0, 'text'], text: markdown.trimEnd() },
        ]);
        const document = createCriticMarkupDocument(fromMarkdownSourceMap(sourceMap));
        const start = markdown.indexOf('before');
        const end = markdown.indexOf('](image.png)');

        expect(document.itemsContainedBySourceRange(sourceRange(start, end)))
            .toEqual(document.items);
        expect(document.projectSourceRange(
            sourceRange(start, end),
            'original',
        )).toBe('before  old after');
        expect(document.projectLocalRange(
            path(0, 'text'),
            localRange(start, end),
            'revised',
        )).toBe('before new  after');
    });

    it('resolves one item with the same opaque payload bytes as bulk projection', () => {
        const literalCode = '`++\\}`';
        const markdown = `a{++${literalCode}++}b`;
        const codeStart = markdown.indexOf(literalCode);
        const document = createCriticMarkupDocument(
            fromMarkdownSourceMap(sourceMapForLeaves(markdown, [{
                path: [0, 'text'],
                text: markdown,
            }])),
            ExcludedRanges.from(markdown.length, [{
                start: codeStart,
                end: codeStart + literalCode.length,
            }]),
        );
        const [item] = document.items;

        expect(document.projectItem(item.id, 'revised')).toBe(literalCode);
        expect(document.resolveItem(item.id, 'accept')).toBe(literalCode);
        expect(document.resolveItem(item.id, 'reject')).toBe('');

        const accepted = markdown.slice(0, item.syntax.range.start)
            + document.resolveItem(item.id, 'accept')
            + markdown.slice(item.syntax.range.end);
        const rejected = markdown.slice(0, item.syntax.range.start)
            + document.resolveItem(item.id, 'reject')
            + markdown.slice(item.syntax.range.end);
        expect(accepted).toBe(document.project('revised'));
        expect(rejected).toBe(document.project('original'));
        expect(accepted).toBe(`a${literalCode}b`);
        expect(rejected).toBe('ab');
    });

    it('leaves nested review items marked when resolving only their parent', () => {
        const markdown = '{++outer {--inner--} tail++}';
        const document = createCriticMarkupDocument(fromMarkdownSourceMap(sourceMapForLeaves(
            markdown,
            [{ path: [0, 'text'], text: markdown }],
        )));
        const [outer, inner] = document.items;

        expect(document.resolveItem(outer.id, 'accept'))
            .toBe('outer {--inner--} tail');
        expect(document.resolveItem(outer.id, 'reject')).toBe('');
        expect(document.resolveItem(inner.id, 'accept')).toBe('');
        expect(document.resolveItem(inner.id, 'reject')).toBe('inner');
    });

    it('rejects source-map pieces that cannot preserve exact offsets', () => {
        const markdown = '{++x++}\n';
        const sourceMap: IMarkdownSourceMap = {
            markdown,
            leaves: [{
                path: [0, 'text'],
                pieces: [{
                    localStart: 0,
                    localEnd: 7,
                    sourceStart: 0,
                    sourceEnd: 8,
                }],
            }],
        };

        expect(() => createCriticMarkupDocument(
            fromMarkdownSourceMap(sourceMap),
        )).toThrow(
            'must map equal-length ranges',
        );
    });
});

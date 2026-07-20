import type { TBlockPath } from '../../block/types';
import type { TTrackedMarkdown } from '../../state/markdownSourceMap';
import type { IMarkdownSourceMap } from '../../state/stateToMarkdown';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localOffset, sourceOffset } from '../../mappedText';
import { fromMarkdownSourceMap, plainMarkdown } from '../../state/markdownSourceMap';
import { parseCriticMarkupDocument } from '../../utils/marked/criticMarkupDocument';
import {
    CriticMarkupAnalysis,
    criticMarkupSemanticPayloadView,
} from '../analysis';
import { createCriticMarkupDocument as createDocumentFromAnalysis } from '../document';
import { ExcludedRanges } from '../excludedRanges';
import * as criticMarkupGrammar from '../parser';
import { scanCriticMarkup } from '../parser';

const mocks = vi.hoisted(() => ({
    analyzeMarkdownBlockSource: vi.fn(),
}));

vi.mock('../../utils/marked/lexBlock', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../../utils/marked/lexBlock')
    >();
    return {
        ...actual,
        analyzeMarkdownBlockSource: (
            ...args: Parameters<typeof actual.analyzeMarkdownBlockSource>
        ) => {
            mocks.analyzeMarkdownBlockSource(...args);
            return actual.analyzeMarkdownBlockSource(...args);
        },
    };
});

const PATH: TBlockPath = [0, 'text'];
const DOCUMENT_SOURCE = readFileSync(
    fileURLToPath(new URL('../document.ts', import.meta.url)),
    'utf8',
);

function createCriticMarkupDocument(source: TTrackedMarkdown) {
    return createDocumentFromAnalysis(
        CriticMarkupAnalysis.analyzeGrammar(source.text),
        source,
        undefined,
        undefined,
        'grammar',
    );
}

function sourceMapWithPieces(
    markdown: string,
    pieces: IMarkdownSourceMap['leaves'][number]['pieces'],
): IMarkdownSourceMap {
    return {
        markdown,
        leaves: [{ path: PATH, pieces }],
    };
}

function semanticLiteralRangeReads(depth: number): number {
    const literals = Array.from(
        { length: depth },
        (_, index) => `\`literal-${index}\``,
    );
    const openings = literals.map(literal => `{>>${literal} `).join('');
    const source = `${openings}leaf${'<<}'.repeat(depth)}`;
    let cursor = 0;
    const ranges = literals.map((literal) => {
        const start = source.indexOf(literal, cursor);
        cursor = start + literal.length;
        return { start, end: cursor };
    });
    const excluded = ExcludedRanges.from(source.length, ranges);
    let reads = 0;
    const countedRanges = new Proxy(excluded.ranges, {
        get(target, property, receiver) {
            if (typeof property === 'string' && /^\d+$/.test(property))
                reads++;
            return Reflect.get(target, property, receiver);
        },
    });
    const countedExcluded = {
        ranges: countedRanges,
        assertSourceLength: excluded.assertSourceLength.bind(excluded),
        firstIndexEndingAfter: (offset: number): number => {
            let low = 0;
            let high = countedRanges.length;
            while (low < high) {
                const middle = (low + high) >> 1;
                if (countedRanges[middle].end <= offset)
                    low = middle + 1;
                else
                    high = middle;
            }
            return low;
        },
    } as unknown as ExcludedRanges;
    const pending = [...scanCriticMarkup(source, excluded)];
    while (pending.length) {
        const token = pending.pop()!;
        if (token.type === 'substitution') {
            throw new TypeError('Depth fixture unexpectedly parsed a substitution.');
        }
        criticMarkupSemanticPayloadView(
            source,
            token,
            token.contentRange,
            countedExcluded,
        );
        if (token.nested)
            pending.push(...token.nested);
    }
    return reads;
}

beforeEach(() => {
    mocks.analyzeMarkdownBlockSource.mockClear();
});

describe('criticMarkup grammar-owned no-opener fast path', () => {
    it('owns a sound, conservative opener predicate in the grammar module', () => {
        const hasCriticMarkupOpener = (
            criticMarkupGrammar as typeof criticMarkupGrammar & {
                hasCriticMarkupOpener?: (source: string) => boolean;
            }
        ).hasCriticMarkupOpener;

        expect(
            hasCriticMarkupOpener,
            'The framework-free grammar must own the opener predicate.',
        ).toBeTypeOf('function');
        if (!hasCriticMarkupOpener)
            return;

        expect(hasCriticMarkupOpener(
            'plain { braces } ++ -- == >> ~~ Markdown',
        )).toBe(false);
        for (const opener of ['{++', '{--', '{~~', '{==', '{>>']) {
            expect(
                hasCriticMarkupOpener(`prefix ${opener} suffix`),
                `${opener} must never be a false-negative.`,
            ).toBe(true);
        }
    });

    it('skips Markdown context analysis for a large ordinary document', () => {
        const source = (
            'ordinary { json: true } ++ -- == >> ~~ and [link](url)\n'
        ).repeat(4_096);
        const document = parseCriticMarkupDocument(plainMarkdown(source));

        expect(document.items).toEqual([]);
        expect(document.project('marked')).toBe(source);
        expect(mocks.analyzeMarkdownBlockSource).not.toHaveBeenCalled();
    });
});

describe('criticMarkup final-adapter structural scale', () => {
    it('coalesces adjacent identity pieces before building semantic segments', () => {
        const source = `{++${'x'.repeat(2_048)}++}`;
        const pieces = Array.from({ length: source.length }, (_, offset) => ({
            localStart: offset,
            localEnd: offset + 1,
            sourceStart: offset,
            sourceEnd: offset + 1,
        }));
        const originalMin = Math.min;
        const originalMax = Math.max;
        let widestMin = 0;
        let widestMax = 0;
        const minSpy = vi.spyOn(Math, 'min').mockImplementation((...values) => {
            if (values.length > widestMin)
                widestMin = values.length;
            return originalMin(...values);
        });
        const maxSpy = vi.spyOn(Math, 'max').mockImplementation((...values) => {
            if (values.length > widestMax)
                widestMax = values.length;
            return originalMax(...values);
        });
        let fragmentCount = 0;
        let localRange: { start: number; end: number } | undefined;

        try {
            const document = createCriticMarkupDocument(
                fromMarkdownSourceMap(sourceMapWithPieces(source, pieces)),
            );
            fragmentCount = document.items[0].fragments[0].segments.length;
            localRange = document.items[0].fragments[0].localRange;
        }
        finally {
            minSpy.mockRestore();
            maxSpy.mockRestore();
        }

        expect(fragmentCount).toBe(3);
        expect(localRange).toEqual({ start: 0, end: source.length });
        expect(widestMin).toBeLessThanOrEqual(2);
        expect(widestMax).toBeLessThanOrEqual(2);
    });

    it('indexes mapped spans once instead of rescanning all spans per item', () => {
        const itemCount = 257;
        const raw = '{++x++}';
        const markdown = Array.from({ length: itemCount }).fill(raw).join('\n');
        const pieces = Array.from({ length: itemCount }, (_, index) => {
            const start = index * (raw.length + 1);
            return {
                localStart: start,
                localEnd: start + raw.length,
                sourceStart: start,
                sourceEnd: start + raw.length,
            };
        });
        const parsedItems = parseCriticMarkupDocument(
            fromMarkdownSourceMap(sourceMapWithPieces(markdown, pieces)),
        ).items.length;

        expect(parsedItems).toBe(itemCount);
        expect(mocks.analyzeMarkdownBlockSource.mock.calls.length)
            .toBeLessThanOrEqual(4);
    });

    it('owns fragment topology in parser bindings, never generic span inference', () => {
        // Parser-owned binding authority: every fragment-bearing document is
        // backed by an authenticated parser binding graph. The generic
        // mapped-span intersection fallback and every optional-binding entry
        // point must not exist.
        expect(DOCUMENT_SOURCE).not.toContain('function buildFragmentsByItem');
        expect(DOCUMENT_SOURCE).not.toContain('function finalizedFragments');
        expect(DOCUMENT_SOURCE).not.toContain('function segmentEvents');
        expect(DOCUMENT_SOURCE).not.toMatch(/nativeBindings\?:/);
        expect(DOCUMENT_SOURCE).not.toContain('function fragmentsForToken');
        expect(DOCUMENT_SOURCE).not.toContain('function fragmentForPath');
    });

    it('requires explicit binding provenance at every production entry point', () => {
        // A defaulted binding parameter is optional provenance in disguise:
        // call sites compile without stating where topology comes from. The
        // factory may accept the 'grammar' sentinel, but never silently.
        expect(DOCUMENT_SOURCE).not.toMatch(/nativeBindings\s*:[^=;\n]*=/);

        // The marked parser module exposes no test-only bound-document
        // shortcut; test suites compose one from the public semantic parse
        // plus the sanctioned grammar materializer.
        const markedDocumentSource = readFileSync(
            fileURLToPath(
                new URL('../../utils/marked/criticMarkupDocument.ts', import.meta.url),
            ),
            'utf8',
        );
        expect(markedDocumentSource)
            .not
            .toContain('function parseBoundCriticMarkupDocument');

        // Repo-wide: no production module may declare an optional parameter
        // or property of a binding-graph type (reassignments and required
        // parameters stay legal).
        const srcRoot = fileURLToPath(new URL('../..', import.meta.url));
        const productionSources = readdirSync(srcRoot, { recursive: true })
            .map(String)
            .filter(relative => relative.endsWith('.ts')
                && !relative.includes('__tests__')
                && !relative.endsWith('.spec.ts'));
        expect(productionSources.length).toBeGreaterThan(100);
        for (const relative of productionSources) {
            const source = readFileSync(join(srcRoot, relative), 'utf8');
            expect(
                source,
                `${relative} declares optional binding provenance`,
            ).not.toMatch(
                /\w+\?\s*:\s*(?:ICriticMarkupBindingGraph|TCriticMarkupDocumentBindings)\b/,
            );
        }
    });

    it('builds deep table-style fragmented mappings in one output-sensitive sweep', () => {
        const depth = 800;
        const nested = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`;
        const prefix = '| ';
        const source = `${prefix}${nested} |\n| --- |\n`;
        const pieces = Array.from({ length: nested.length }, (_, offset) => ({
            localStart: offset,
            localEnd: offset + 1,
            sourceStart: prefix.length + offset,
            sourceEnd: prefix.length + offset + 1,
        }));
        const document = createCriticMarkupDocument(
            fromMarkdownSourceMap(sourceMapWithPieces(source, pieces)),
        );

        expect(document.items).toHaveLength(depth);
        expect(document.items.every(item => item.fragments.length === 1))
            .toBe(true);
        expect(document.items.every(item =>
            item.fragments[0].segments.length === 3)).toBe(true);
        expect(document.project('original')).toBe('|  |\n| --- |\n');
        expect(document.project('revised')).toBe(`| ${'x'} |\n| --- |\n`);
        expect(document.sourceOffsetAt(
            document.items.at(-1)!.fragments[0].path,
            localOffset(nested.indexOf('x')),
        )).toBe(sourceOffset(prefix.length + nested.indexOf('x')));
    }, 60_000);

    it('does not linearly rescan the public item array for point lookups', () => {
        expect(DOCUMENT_SOURCE.match(
            /this\.items\.(?:find|filter|some)\s*\(/g,
        ) ?? []).toEqual([]);
    });

    it('bounds Markdown context parsing independently of semantic depth', () => {
        const depth = 1_024;
        const source = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`;

        const document = parseCriticMarkupDocument(fromMarkdownSourceMap(sourceMapWithPieces(
            source,
            [{
                localStart: 0,
                localEnd: source.length,
                sourceStart: 0,
                sourceEnd: source.length,
            }],
        )));

        expect(document.items).toHaveLength(depth);
        expect(mocks.analyzeMarkdownBlockSource.mock.calls.length)
            .toBeLessThanOrEqual(4);
    });

    it('uses a forward exclusion cursor during a sequential grammar scan', () => {
        const prefix = 'ax'.repeat(1_024);
        const source = `${prefix}{++visible++}`;
        const excluded = ExcludedRanges.from(
            source.length,
            Array.from({ length: 1_024 }, (_, index) => ({
                start: index * 2 + 1,
                end: index * 2 + 2,
            })),
        );
        const randomAccessLookup = vi.spyOn(
            ExcludedRanges.prototype,
            'endAt',
        );
        let raw: string[] = [];
        let randomAccessCalls = 0;

        try {
            raw = scanCriticMarkup(source, excluded).map(token => token.raw);
        }
        finally {
            randomAccessCalls = randomAccessLookup.mock.calls.length;
            randomAccessLookup.mockRestore();
        }

        expect(raw).toEqual(['{++visible++}']);
        expect(randomAccessCalls).toBe(0);
    });

    it('does not revisit every descendant literal for each nested semantic payload', () => {
        const depth32 = semanticLiteralRangeReads(32);
        const depth64 = semanticLiteralRangeReads(64);

        expect(
            depth64,
            `rangeReads(64) = ${depth64} exceeds 2.5x rangeReads(32) = ${depth32}`,
        ).toBeLessThanOrEqual(depth32 * 2.5 + 64);
    });

    it('defers and memoizes semantic strings behind frozen public token properties', () => {
        const depth = 96;
        const source
            = `${'{++visible '.repeat(depth)}leaf${'++}'.repeat(depth)}`;
        const expected
            = `visible ${'{++visible '.repeat(depth - 1)}leaf${'++}'.repeat(depth - 1)}`;
        const decode = vi.spyOn(
            criticMarkupGrammar,
            'decodeCriticMarkupPayloadEscapes',
        );

        try {
            const analysis = CriticMarkupAnalysis.analyzeGrammar(source);
            const root = analysis.roots[0];
            const descriptor = Object.getOwnPropertyDescriptor(
                root,
                'semanticContent',
            );

            expect(decode).not.toHaveBeenCalled();
            expect(Object.isFrozen(root)).toBe(true);
            expect(descriptor).toMatchObject({
                configurable: false,
                enumerable: true,
            });
            expect(descriptor?.get).toBeTypeOf('function');
            expect(descriptor?.set).toBeUndefined();
            expect(Reflect.set(root, 'semanticContent', 'forged')).toBe(false);

            expect(root.type).toBe('addition');
            if (root.type === 'substitution')
                throw new TypeError('Depth fixture unexpectedly parsed a substitution.');
            expect(root.semanticContent).toBe(expected);
            const firstReadCalls = decode.mock.calls.length;
            expect(firstReadCalls).toBeGreaterThan(0);

            expect(root.semanticContent).toBe(expected);
            const firstView = criticMarkupSemanticPayloadView(
                source,
                root,
                root.contentRange,
                analysis.excludedRanges,
            );
            expect(firstView.text).toBe(expected);
            expect(criticMarkupSemanticPayloadView(
                source,
                root,
                root.contentRange,
                analysis.excludedRanges,
            )).toBe(firstView);
            expect(decode).toHaveBeenCalledTimes(firstReadCalls);
        }
        finally {
            decode.mockRestore();
        }
    });

    it('rejects alien source and exclusion authority for document tokens', () => {
        const source = 'A {>>note<<}\n';
        const alien = 'B {>>note<<}\n';
        const analysis = CriticMarkupAnalysis.analyzeGrammar(source);
        const [comment] = analysis.roots;

        expect(comment.type).toBe('comment');
        if (comment.type === 'substitution') {
            throw new TypeError(
                'Authority fixture unexpectedly parsed a substitution.',
            );
        }
        expect(() => criticMarkupSemanticPayloadView(
            alien,
            comment,
            comment.contentRange,
            analysis.excludedRanges,
        )).toThrow('different semantic authority');
        expect(() => criticMarkupSemanticPayloadView(
            source,
            comment,
            comment.contentRange,
            ExcludedRanges.empty(source.length),
        )).toThrow('different semantic authority');
    });

    it('does not re-slice every authenticated ancestor arm during analysis', () => {
        const depth = 96;
        const source
            = `${'{++unique-visible '.repeat(depth)}leaf${'++}'.repeat(depth)}`;
        const originalSlice = String.prototype.slice;
        const armSlices = new Map<string, number>();
        const slice = vi.spyOn(String.prototype, 'slice').mockImplementation(
            function(this: string, start?: number, end?: number): string {
                if (
                    String(this) === source
                    && typeof start === 'number'
                    && typeof end === 'number'
                ) {
                    const key = `${start}:${end}`;
                    armSlices.set(key, (armSlices.get(key) ?? 0) + 1);
                }
                return originalSlice.call(this, start, end);
            },
        );

        try {
            const analysis = CriticMarkupAnalysis.analyzeGrammar(source);
            const pending = [...analysis.roots];
            const contentRanges: string[] = [];
            while (pending.length) {
                const token = pending.pop()!;
                if (token.type === 'substitution') {
                    throw new TypeError(
                        'Slice fixture unexpectedly parsed a substitution.',
                    );
                }
                contentRanges.push(
                    `${token.contentRange.start}:${token.contentRange.end}`,
                );
                pending.push(...token.nested ?? []);
            }

            expect(contentRanges).toHaveLength(depth);
            expect(contentRanges.map(range => armSlices.get(range) ?? 0))
                .toEqual(Array.from({ length: depth }, () => 1));
        }
        finally {
            slice.mockRestore();
        }
    });
});

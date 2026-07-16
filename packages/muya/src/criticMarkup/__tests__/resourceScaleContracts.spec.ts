import type { TBlockPath } from '../../block/types';
import type { TTrackedMarkdown } from '../../state/markdownSourceMap';
import type { IMarkdownSourceMap } from '../../state/stateToMarkdown';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localOffset, sourceOffset } from '../../mappedText';
import { fromMarkdownSourceMap, plainMarkdown } from '../../state/markdownSourceMap';
import { parseCriticMarkupDocument } from '../../utils/marked/criticMarkupDocument';
import { CriticMarkupAnalysis } from '../analysis';
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
});

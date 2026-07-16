import { Marked } from 'marked';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localOffset, MappedTextWriter } from '../../mappedText';
import {
    mappedMarkdown,
    markdownStatePath,
    plainMarkdown,
} from '../../state/markdownSourceMap';

import {
    parseCriticMarkupContextDocument,
    parseCriticMarkupDocument,
} from '../../utils/marked/criticMarkupDocument';
import criticMarkupDocumentExtension from '../../utils/marked/extensions/criticMarkupDocument';
import { getClipBoardHtml } from '../../utils/marked/getClipboardHtml';
import { getHighlightHtml } from '../../utils/marked/getHighlightHtml';
import { markedParserPath } from '../../utils/marked/locatedMarkdown';
import { CriticMarkupAnalysis } from '../analysis';
import { createCriticMarkupDocument } from '../document';

const calls = vi.hoisted(() => ({
    analyzeMarkdownBlockSource: vi.fn(),
    lexBlock: vi.fn(),
    prepareCandidateIdentity: vi.fn(),
    scanCriticMarkup: vi.fn(),
}));

vi.mock('../parser', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../parser')>();

    return {
        ...actual,
        prepareCriticMarkupCandidateIdentity: (
            ...args: Parameters<
                typeof actual.prepareCriticMarkupCandidateIdentity
            >
        ) => {
            calls.prepareCandidateIdentity(...args);
            return actual.prepareCriticMarkupCandidateIdentity(...args);
        },
        scanCriticMarkup: (
            ...args: Parameters<typeof actual.scanCriticMarkup>
        ) => {
            calls.scanCriticMarkup(...args);
            return actual.scanCriticMarkup(...args);
        },
        scanCriticMarkupCandidate: (
            ...args: Parameters<typeof actual.scanCriticMarkupCandidate>
        ) => {
            calls.scanCriticMarkup(...args);
            return actual.scanCriticMarkupCandidate(...args);
        },
    };
});

vi.mock('../../utils/marked/lexBlock', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../../utils/marked/lexBlock')
    >();

    return {
        ...actual,
        analyzeMarkdownBlockSource: (
            ...args: Parameters<typeof actual.analyzeMarkdownBlockSource>
        ) => {
            calls.analyzeMarkdownBlockSource(...args);
            return actual.analyzeMarkdownBlockSource(...args);
        },
        lexBlock: (...args: Parameters<typeof actual.lexBlock>) => {
            calls.lexBlock(...args);
            return actual.lexBlock(...args);
        },
    };
});

// Projected-view literal-range parses go through the analyzer core directly
// (utils/marked/markdownBlockAnalysis); count them under the same authority.
vi.mock('../../utils/marked/markdownBlockAnalysis', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../../utils/marked/markdownBlockAnalysis')
    >();

    return {
        ...actual,
        analyzeMarkdownBlockSourceWithExtensions: (
            ...args: Parameters<
                typeof actual.analyzeMarkdownBlockSourceWithExtensions
            >
        ) => {
            calls.analyzeMarkdownBlockSource(args[0]);
            return actual.analyzeMarkdownBlockSourceWithExtensions(...args);
        },
    };
});

beforeEach(() => {
    calls.analyzeMarkdownBlockSource.mockClear();
    calls.lexBlock.mockClear();
    calls.prepareCandidateIdentity.mockClear();
    calls.scanCriticMarkup.mockClear();
});

describe('one CriticMarkup analysis authority per source revision', () => {
    it('scans the Critic grammar exactly once for the canonical document', () => {
        const source = '{++before **after**++}';

        const document = parseCriticMarkupDocument(plainMarkdown(source));

        expect(document.items).toHaveLength(1);
        expect(calls.scanCriticMarkup).toHaveBeenCalledTimes(1);
        expect(calls.prepareCandidateIdentity).toHaveBeenCalledTimes(1);
    });

    it('builds the static document from the already-located Marked tree', () => {
        const source = '{++before **after**++}';
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source));

        const html = marked.parse(source) as string;

        expect(html).toContain('critic-addition');
        expect(calls.scanCriticMarkup).toHaveBeenCalledTimes(1);
        expect(calls.prepareCandidateIdentity).toHaveBeenCalledTimes(1);
        expect(
            calls.lexBlock.mock.calls.filter(([markdown]) => markdown === source),
        ).toEqual([]);
    });

    it('reuses one semantic analysis across distinct exact-source mappings', () => {
        const source = '{++mapped++}';
        const analysis = CriticMarkupAnalysis.analyzeGrammar(source);
        const statePath = markdownStatePath(['state', 'text']);
        const markedPath = markedParserPath(['marked', 0, 'text']);
        const stateMapped = mappedMarkdown(source, statePath, 0);
        const markedMapped = new MappedTextWriter()
            .appendMapped(source, markedPath, localOffset(0))
            .build();

        const stateDocument = createCriticMarkupDocument(
            analysis,
            stateMapped,
            undefined,
            undefined,
            'grammar',
        );
        const markedDocument = createCriticMarkupDocument(
            analysis,
            markedMapped,
            undefined,
            undefined,
            'grammar',
        );

        expect(calls.scanCriticMarkup).toHaveBeenCalledTimes(1);
        expect(stateDocument.analysis).toBe(analysis);
        expect(markedDocument.analysis).toBe(analysis);
        expect(stateDocument.items[0].fragments[0].path).toEqual(statePath);
        expect(markedDocument.items[0].fragments[0].path).toEqual(markedPath);
        expect(Object.isFrozen(analysis)).toBe(true);
        expect(Object.isFrozen(analysis.roots)).toBe(true);
    });

    it('rejects an equal-length mapping from another source revision', () => {
        const analysis = CriticMarkupAnalysis.analyzeGrammar('{++one++}');

        expect(() => createCriticMarkupDocument(
            analysis,
            plainMarkdown('{++two++}'),
            undefined,
            undefined,
            'grammar',
        )).toThrow(/different source revision/);
    });

    it('validates a prepared static analysis before its empty-root fast path', () => {
        const analysis = parseCriticMarkupDocument(
            plainMarkdown('ordinary'),
        ).analysis;

        expect(() => criticMarkupDocumentExtension('{++x++}', { analysis }))
            .toThrow(/different static Markdown/);
    });

    it('does not reuse parser-aware semantics under another option profile', () => {
        const source = '$x {++inside++}$';
        const mapped = plainMarkdown(source);
        const mathDocument = parseCriticMarkupDocument(mapped, { math: true });
        const plainDocument = parseCriticMarkupDocument(mapped, { math: false });

        expect(mathDocument.items).toHaveLength(0);
        expect(plainDocument.items).toHaveLength(1);
        expect(mathDocument.analysis.parserProfile).not.toEqual(
            plainDocument.analysis.parserProfile,
        );
        expect(() => createCriticMarkupDocument(
            mathDocument.analysis,
            mapped,
            plainDocument.analysis.parserProfile,
            undefined,
            'grammar',
        )).toThrow(/different parser profile/);
    });

    it('keeps no-opener display and complete authoring context distinct', () => {
        const source = 'before `literal` after';
        const mapped = plainMarkdown(source);
        const display = parseCriticMarkupDocument(mapped);
        const context = parseCriticMarkupContextDocument(mapped);

        expect(display.analysis.contextCoverage).toBe('none');
        expect(display.excludedRanges.ranges).toEqual([]);
        expect(context.analysis.contextCoverage).toBe('complete');
        expect(context.excludedRanges.ranges).toEqual([{
            start: 7,
            end: 16,
        }]);
        expect(() => display.analysis.assertContextCoverage('complete'))
            .toThrow(/context coverage/);
        expect(() => context.analysis.assertContextCoverage('complete'))
            .not
            .toThrow();
    });

    it('rescans only when projection context changes the final exclusions', () => {
        const source = '{--<{~~`~>~~}{==`--}';

        const document = parseCriticMarkupDocument(plainMarkdown(source));

        expect(calls.scanCriticMarkup).toHaveBeenCalledTimes(2);
        expect(document.roots).toHaveLength(1);
        expect(document.roots[0]).toMatchObject({
            type: 'deletion',
            range: { start: 0, end: source.length },
            nested: [{
                type: 'substitution',
                range: { start: 4, end: 13 },
            }],
        });
    });

    it('lexes identical semantic projections once and maps each view', () => {
        const projected = '[x](u{++v++})';
        const source = `{~~${projected}~>${projected}~~}`;

        const document = parseCriticMarkupDocument(plainMarkdown(source));

        expect(document.project('original')).toBe(projected);
        expect(document.project('revised')).toBe(projected);
        expect(document.excludedRanges.ranges).toEqual([
            { start: 3, end: 4 },
            { start: 5, end: 16 },
            { start: 18, end: 19 },
            { start: 20, end: 31 },
        ]);
        expect(
            calls.analyzeMarkdownBlockSource.mock.calls.filter(([markdown]) =>
                markdown === projected),
        ).toHaveLength(1);
    });

    it('preserves canonical IDs and ranges after static front-matter rendering', () => {
        const source = '---\ntitle: x\n---\n\nBody {++new++}\n';
        const options = {
            criticMarkup: true,
            criticMarkupProjection: 'marked' as const,
            frontMatter: true,
        };
        const canonical = parseCriticMarkupDocument(
            plainMarkdown(source),
            options,
        );
        const item = canonical.items[0];

        expect(item.id).toBe('critic-23-32');
        for (const html of [
            getHighlightHtml(source, options),
            getClipBoardHtml(source, options),
        ]) {
            expect(html).toContain(`data-critic-id="${item.id}"`);
            expect(html).toContain(`data-start="${item.syntax.range.start}"`);
            expect(html).toContain(`data-end="${item.syntax.range.end}"`);
            expect(html).not.toContain('critic-5-14');
        }
    });

    it('projects the full source before extracting front matter', () => {
        const source = [
            '---',
            'title: first',
            '---',
            '',
            '---',
            'body {++visible++}',
            '---',
            '',
        ].join('\n');

        for (const [projection, visible] of [
            ['original', false],
            ['revised', true],
        ] as const) {
            const options = {
                criticMarkup: true,
                criticMarkupProjection: projection,
                frontMatter: true,
            };
            for (const html of [
                getHighlightHtml(source, options),
                getClipBoardHtml(source, options),
            ]) {
                expect(html).not.toContain('{++visible++}');
                if (visible)
                    expect(html).toContain('body visible');
                else
                    expect(html).not.toContain('visible');
            }
        }
    });
});

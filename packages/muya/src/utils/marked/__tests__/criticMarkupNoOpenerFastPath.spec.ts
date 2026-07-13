import { Marked, MarkedSourceDocument, MarkedSourceView } from 'marked';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import criticMarkupDocumentExtension from '../extensions/criticMarkupDocument';
import { lexBlock } from '../lexBlock';

const mocks = vi.hoisted(() => ({
    analyzeContext: vi.fn(() => {
        throw new TypeError('No-opener Markdown must not enter context analysis.');
    }),
    lexBlock: vi.fn(),
    scanCriticMarkup: vi.fn(),
}));

vi.mock('../locatedMarkdown', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../locatedMarkdown')
    >();
    return {
        ...actual,
        analyzeCriticMarkupContext: mocks.analyzeContext,
    };
});

vi.mock('../lexBlock', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lexBlock')>();
    return {
        ...actual,
        lexBlock: (...args: Parameters<typeof actual.lexBlock>) => {
            mocks.lexBlock(...args);
            return actual.lexBlock(...args);
        },
    };
});

vi.mock('../../../criticMarkup/parser', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../../../criticMarkup/parser')
    >();
    return {
        ...actual,
        scanCriticMarkup: (
            ...args: Parameters<typeof actual.scanCriticMarkup>
        ) => {
            mocks.scanCriticMarkup(...args);
            return actual.scanCriticMarkup(...args);
        },
        scanCriticMarkupCandidate: (
            ...args: Parameters<typeof actual.scanCriticMarkupCandidate>
        ) => {
            mocks.scanCriticMarkup(...args);
            return actual.scanCriticMarkupCandidate(...args);
        },
    };
});

beforeEach(() => {
    mocks.analyzeContext.mockClear();
    mocks.lexBlock.mockClear();
    mocks.scanCriticMarkup.mockClear();
});

describe('criticMarkup final Marked no-opener fast path', () => {
    it('keeps ordinary block lexing on Marked\'s non-provenance branch', () => {
        const documentSlice = vi.spyOn(MarkedSourceDocument.prototype, 'slice');
        const viewSlice = vi.spyOn(MarkedSourceView.prototype, 'slice');

        try {
            const tokens = lexBlock('ordinary paragraph\n', {
                criticMarkup: false,
                frontMatter: false,
            });
            expect(tokens[0].type).toBe('paragraph');
            expect(documentSlice).not.toHaveBeenCalled();
            expect(viewSlice).not.toHaveBeenCalled();
        }
        finally {
            documentSlice.mockRestore();
            viewSlice.mockRestore();
        }
    });

    it('does not install or execute mapped provenance for ordinary Markdown', () => {
        const source = 'ordinary Markdown without candidate syntax';
        const documentSlice = vi.spyOn(MarkedSourceDocument.prototype, 'slice');
        const viewSlice = vi.spyOn(MarkedSourceView.prototype, 'slice');
        const extension = criticMarkupDocumentExtension(source);
        const marked = new Marked();
        marked.use(extension);

        try {
            expect(extension.sourceProvenance).toBeUndefined();
            expect(marked.parse(source)).toContain('ordinary Markdown');
            expect(documentSlice).not.toHaveBeenCalled();
            expect(viewSlice).not.toHaveBeenCalled();
        }
        finally {
            documentSlice.mockRestore();
            viewSlice.mockRestore();
        }
    });

    it('still authenticates parser options on the no-opener path', () => {
        const source = 'ordinary Markdown';
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source, {
            parserOptions: { gfm: false },
        }));

        expect(() => marked.parse(source, { gfm: true }))
            .toThrow(/parser options differ/i);
    });

    it.each([
        {
            name: 'out-of-bounds parser offset',
            binding: {
                source: 'ordinary Markdown',
                parserOffset: 1,
                literalRanges: [],
            },
        },
        {
            name: 'invalid literal range',
            binding: {
                source: 'ordinary Markdown',
                parserOffset: 0,
                literalRanges: [{ start: -1, end: 0 }],
            },
        },
    ])('rejects an $name before taking the fast path', ({ binding }) => {
        expect(() => criticMarkupDocumentExtension(
            'ordinary Markdown',
            { sourceBinding: binding },
        )).toThrow(/binding|range|source|slice/i);
    });

    it('validates the actual lexer source before taking the fast path', () => {
        const preparedSource = 'first ordinary Markdown';
        const actualSource = 'other ordinary Markdown';
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(preparedSource));

        expect(() => marked.parse(actualSource))
            .toThrow(/source|revision|binding/i);
        expect(mocks.analyzeContext).not.toHaveBeenCalled();
        expect(mocks.scanCriticMarkup).not.toHaveBeenCalled();
    });

    it.each([
        'ordinary { braces } ++ -- == >> ~~ Markdown',
        '![plain image alternative](https://example.test/image.png)',
    ])('bypasses document context analysis for %s', (source) => {
        const marked = new Marked();
        marked.use(criticMarkupDocumentExtension(source));

        expect(() => marked.parse(source)).not.toThrow();
        expect(mocks.analyzeContext).not.toHaveBeenCalled();
        expect(mocks.lexBlock).not.toHaveBeenCalled();
        expect(mocks.scanCriticMarkup).not.toHaveBeenCalled();
    });
});

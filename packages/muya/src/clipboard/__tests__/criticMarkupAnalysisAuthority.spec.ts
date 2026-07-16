// @vitest-environment jsdom

import type Content from '../../block/base/content';
import type { ImageToken } from '../../inlineRenderer/types';
import type { Muya } from '../../muya';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBoundCriticMarkupDocument } from '../../inlineRenderer/__tests__/parseBoundDocument';
import {
    mappedMarkdown,
    markdownStatePath,
} from '../../state/markdownSourceMap';
import { CopyType } from '../types';

const calls = vi.hoisted(() => ({
    grammarScan: vi.fn(),
}));

vi.mock('../../criticMarkup/parser', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../../criticMarkup/parser')
    >();
    return {
        ...actual,
        scanCriticMarkupCandidate: (
            ...args: Parameters<typeof actual.scanCriticMarkupCandidate>
        ) => {
            calls.grammarScan(...args);
            return actual.scanCriticMarkupCandidate(...args);
        },
    };
});

vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (source: string) => source,
    loadLanguage: () => null,
    search: () => [],
}));

const Clipboard = (await import('../index')).default;
const SOURCE = 'before {++new++} after';

function copy(
    copyType: CopyType,
    projection: 'marked' | 'revised',
    selectedImage = false,
) {
    const parserOptions = {
        criticMarkupProjection: projection,
        frontMatter: true,
        footnote: false,
        math: true,
        superSubScript: true,
        isGitlabCompatibilityEnabled: true,
    } as const;
    const muya = {
        options: parserOptions,
        editor: {
            criticMarkupDocument: {
                get: () => parseBoundCriticMarkupDocument(
                    mappedMarkdown(
                        SOURCE,
                        markdownStatePath([]),
                        0,
                    ),
                    parserOptions,
                ),
            },
            selection: {
                image: selectedImage
                    ? { token: { raw: SOURCE } as ImageToken }
                    : null,
            },
        },
    } as unknown as Muya;
    const clipboard = new Clipboard(muya);
    clipboard.copyType = copyType;
    if (!selectedImage) {
        const block = {
            text: SOURCE,
            blockName: 'paragraph.content',
        } as unknown as Content;
        Object.defineProperty(clipboard, 'selection', {
            get: () => ({
                getSelection: () => ({
                    isSelectionInSameBlock: true,
                    anchor: { offset: 0, block, path: [] },
                    focus: { offset: SOURCE.length, block, path: [] },
                }),
                table: {
                    hasSelection: false,
                    getStateForCopy: () => null,
                    clear: vi.fn(),
                },
            }),
        });
    }
    const setData = vi.fn();

    clipboard.copyHandler({
        clipboardData: { setData },
    } as unknown as ClipboardEvent);

    return setData;
}

beforeEach(() => {
    calls.grammarScan.mockClear();
});

describe('clipboard CriticMarkup analysis authority', () => {
    it.each([
        [CopyType.NORMAL, 'marked', 0],
        [CopyType.NORMAL, 'revised', 1],
        [CopyType.COPY_AS_HTML, 'marked', 1],
        [CopyType.COPY_AS_HTML, 'revised', 1],
        [CopyType.COPY_AS_RICH, 'marked', 1],
        [CopyType.COPY_AS_RICH, 'revised', 1],
        [CopyType.COPY_AS_MARKDOWN, 'marked', 0],
        [CopyType.COPY_CODE_CONTENT, 'marked', 0],
    ] as const)(
        '%s / %s performs %i grammar analyses',
        (copyType, projection, expected) => {
            copy(copyType, projection);

            expect(calls.grammarScan).toHaveBeenCalledTimes(expected);
        },
    );

    it.each([
        [CopyType.NORMAL, 'marked', 0],
        [CopyType.NORMAL, 'revised', 1],
        [CopyType.COPY_AS_HTML, 'marked', 1],
        [CopyType.COPY_AS_RICH, 'revised', 1],
        [CopyType.COPY_AS_MARKDOWN, 'marked', 0],
        [CopyType.COPY_CODE_CONTENT, 'marked', 0],
    ] as const)(
        'selected image %s / %s preserves the same %i-analysis policy',
        (copyType, projection, expected) => {
            copy(copyType, projection, true);

            expect(calls.grammarScan).toHaveBeenCalledTimes(expected);
        },
    );
});

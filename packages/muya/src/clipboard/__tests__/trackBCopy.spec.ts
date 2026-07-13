// @vitest-environment jsdom

import type { ImageToken } from '../../inlineRenderer/types';
import type { Muya } from '../../muya';
import { describe, expect, it, vi } from 'vitest';
import { HOSTILE_CRITIC_MARKUP_CORPUS } from '../../criticMarkup/__tests__/sharedCorpus';
import { getClipBoardHtml } from '../../utils/marked/getClipboardHtml';
import { CopyType } from '../types';

// Track B — Copy (clipboard chain step 1). Ports `packages/muyajs`
// `copyCutCtrl.copyHandler` behaviour into `@muyajs/core`:
//   1. `normal` copy writes ONLY text/plain (markdown source); text/html is
//      blanked so an internal copy → paste round-trips through the markdown
//      branch losslessly and external pastes land as markdown source.
//   2. `copyAsHtml` writes the DOMPurify-sanitized rendered HTML into
//      text/plain and blanks text/html, with the empty-guard keyed on `text`.
//   3. A selected inline image supplies raw `![alt](src)` source to the same
//      mode/projection/sanitizer dispatcher as every other selection.

// The clipboard module pulls in CodeBlockContent → utils/prism which touches
// `window` at import time. Stub the prism shim (same stub as the sibling
// clipboard specs).
vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (s: string) => s,
    loadLanguage: () => null,
    search: () => [],
}));

const Clipboard = (await import('../index')).default;

function makeEvent() {
    const setData = vi.fn();
    return {
        event: {
            clipboardData: { setData },
        } as unknown as ClipboardEvent,
        setData,
    };
}

function dataFor(setData: ReturnType<typeof vi.fn>, format: string) {
    const call = setData.mock.calls.find(([f]) => f === format);
    return call ? call[1] : undefined;
}

const URL_ATTRIBUTES = new Set([
    'action',
    'formaction',
    'href',
    'poster',
    'src',
    'xlink:href',
]);

function expectInertHtml(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;

    expect(root.querySelector('script')).toBeNull();
    for (const element of root.querySelectorAll('*')) {
        for (const attribute of element.attributes) {
            expect(attribute.name.toLowerCase()).not.toMatch(/^on/);
            expect(attribute.name.toLowerCase()).not.toBe('srcdoc');
            if (URL_ATTRIBUTES.has(attribute.name.toLowerCase())) {
                const compactValue = attribute.value
                    .split('')
                    .filter(character => character.charCodeAt(0) > 0x20)
                    .join('')
                    .toLowerCase();
                expect(compactValue)
                    .not
                    .toMatch(/^(?:javascript|vbscript|data):/);
            }
        }
    }

    return root;
}

function expectSemanticReviewItems(
    root: HTMLElement,
    expectedTypes: readonly string[],
) {
    const byId = new Map<string, { type: string; start: number }>();
    for (const element of root.querySelectorAll<HTMLElement>(
        '[data-critic-id]',
    )) {
        expect(element.dataset.criticId).toMatch(/^critic-\d+-\d+$/);
        expect(element.dataset.criticRole)
            .toMatch(/^(?:only|start|middle|end)$/);
        expect(element.dataset.start).toMatch(/^\d+$/);
        expect(element.dataset.end).toMatch(/^\d+$/);
        byId.set(element.dataset.criticId!, {
            type: element.dataset.criticType!,
            start: Number(element.dataset.start),
        });
    }

    expect([...byId.values()]
        .sort((left, right) => left.start - right.start)
        .map(item => item.type))
        .toEqual(expectedTypes);
}

function fakeMuya(overrides: Partial<Muya> = {}) {
    return {
        options: { frontMatter: true },
        editor: { selection: { image: null } },
        ...overrides,
    } as unknown as Muya;
}

function clipboardWithData(html: string, text: string, muya: Muya = fakeMuya()) {
    const clipboard = new Clipboard(muya);
    clipboard.getClipboardData = () => ({ html, text });
    return clipboard;
}

describe('track B — normal copy writes only text/plain', () => {
    it('blanks text/html and writes markdown source to text/plain', () => {
        const clipboard = clipboardWithData('<p>hi</p>', 'hi');
        const { event, setData } = makeEvent();

        clipboard.copyHandler(event);

        expect(dataFor(setData, 'text/html')).toBe('');
        expect(dataFor(setData, 'text/plain')).toBe('hi');
    });

    it('skips setData entirely when the selection is empty', () => {
        const clipboard = clipboardWithData('', '');
        const { event, setData } = makeEvent();

        clipboard.copyHandler(event);

        expect(setData).not.toHaveBeenCalled();
    });

    it('round-trips: a normal copy produces markdown that pastes losslessly', () => {
        // text/html empty means `getCopyTextType` classifies the paste as
        // `onlyMarkdown`, so the markdown source is re-inserted verbatim.
        const markdown = '**bold** and `code`';
        const clipboard = clipboardWithData('<p><strong>bold</strong></p>', markdown);
        const { event, setData } = makeEvent();

        clipboard.copyHandler(event);

        expect(dataFor(setData, 'text/html')).toBe('');
        expect(dataFor(setData, 'text/plain')).toBe(markdown);
    });

    it('copies the visible revised projection while leaving Copy as Markdown raw', () => {
        const markdown = '{++new++} {--old--}';
        const muya = fakeMuya({
            options: {
                frontMatter: true,
                criticMarkupProjection: 'revised',
            },
        } as unknown as Partial<Muya>);
        const clipboard = clipboardWithData('<p>new </p>', markdown, muya);
        const normal = makeEvent();

        clipboard.copyHandler(normal.event);
        expect(dataFor(normal.setData, 'text/plain')).toBe('new ');

        clipboard.copyType = CopyType.COPY_AS_MARKDOWN;
        const raw = makeEvent();
        clipboard.copyHandler(raw.event);
        expect(dataFor(raw.setData, 'text/plain')).toBe(markdown);
    });

    it.each([
        ['marked', '{++new++} {--old--}'],
        ['original', ' old'],
        ['revised', 'new '],
    ] as const)(
        'pins the %s normal-copy plain-text sink policy',
        (projection, expected) => {
            const markdown = '{++new++} {--old--}';
            const muya = fakeMuya({
                options: {
                    frontMatter: true,
                    criticMarkupProjection: projection,
                },
            } as unknown as Partial<Muya>);
            const clipboard = clipboardWithData('<p>review</p>', markdown, muya);
            const { event, setData } = makeEvent();

            clipboard.copyHandler(event);

            expect(dataFor(setData, 'text/plain')).toBe(expected);
            expect(dataFor(setData, 'text/html')).toBe('');
        },
    );
});

describe('track B — copyAsRich still writes both slots', () => {
    it('keeps rendered html in text/html and markdown in text/plain', () => {
        const clipboard = clipboardWithData('<p>hi</p>', 'hi');
        clipboard.copyType = CopyType.COPY_AS_RICH;
        const { event, setData } = makeEvent();

        clipboard.copyHandler(event);

        expect(dataFor(setData, 'text/html')).toBe('<p>hi</p>');
        expect(dataFor(setData, 'text/plain')).toBe('hi');
    });

    it.each(HOSTILE_CRITIC_MARKUP_CORPUS)(
        'sanitizes $id before writing the rich HTML slot',
        (row) => {
            const clipboard = clipboardWithData(
                getClipBoardHtml(row.source),
                row.source,
            );
            clipboard.copyType = CopyType.COPY_AS_RICH;
            const { event, setData } = makeEvent();

            clipboard.copyHandler(event);

            const html = dataFor(setData, 'text/html') as string;
            expect(row.expected.mustBeInert).toBe(true);
            const root = expectInertHtml(html);
            expectSemanticReviewItems(root, row.expected.itemTypes);
        },
    );
});

describe('track B — copyAsHtml is sanitized and text-guarded', () => {
    it('writes sanitized rendered HTML to text/plain, blanks text/html', () => {
        const clipboard = clipboardWithData('', '# Heading\n\nhello');
        clipboard.copyType = CopyType.COPY_AS_HTML;
        const { event, setData } = makeEvent();

        clipboard.copyHandler(event);

        expect(dataFor(setData, 'text/html')).toBe('');
        const plain = dataFor(setData, 'text/plain') as string;
        expect(plain).toContain('<h1');
        expect(plain).toContain('hello');
    });

    it('neutralises XSS payloads in the exported html (DOMPurify)', () => {
        // muyajs `getSanitizeHtml` runs `sanitize(html, EXPORT_DOMPURIFY_CONFIG,
        // false)`, which escapes raw in-block HTML rather than dropping it. The
        // guarantee is no LIVE `<script>` element survives — the markup is
        // escaped to inert text.
        const clipboard = clipboardWithData('', 'before\n\n<script>alert(1)</script>\n\nafter');
        clipboard.copyType = CopyType.COPY_AS_HTML;
        const { event, setData } = makeEvent();

        clipboard.copyHandler(event);

        const plain = dataFor(setData, 'text/plain') as string;
        expect(plain).not.toContain('<script>');
        expect(plain).toContain('&lt;script&gt;');
    });

    it('guards on `text` being empty, not html', () => {
        // html empty but text non-empty: legacy guarded on text, so it MUST
        // still copy. (muya previously returned early on empty html.)
        const clipboard = clipboardWithData('', 'plain text');
        clipboard.copyType = CopyType.COPY_AS_HTML;
        const { event, setData } = makeEvent();

        clipboard.copyHandler(event);

        expect(setData).toHaveBeenCalled();
        expect(dataFor(setData, 'text/plain')).toBeTruthy();
    });

    it('skips when text is empty', () => {
        const clipboard = clipboardWithData('', '');
        clipboard.copyType = CopyType.COPY_AS_HTML;
        const { event, setData } = makeEvent();

        clipboard.copyHandler(event);

        expect(setData).not.toHaveBeenCalled();
    });
});

describe('track B — selected inline image uses normal-copy sink policy', () => {
    function imageToken(raw: string): ImageToken {
        return { type: 'image', raw } as unknown as ImageToken;
    }

    it('writes raw Markdown only to text/plain and skips text-selection extraction', () => {
        const raw = '![alt](https://e.com/x.png)';
        const muya = fakeMuya({
            editor: {
                selection: { image: { token: imageToken(raw) } },
            },
        } as unknown as Partial<Muya>);
        const clipboard = new Clipboard(muya);
        const getData = vi.fn(() => ({ html: 'SHOULD_NOT_RUN', text: 'SHOULD_NOT_RUN' }));
        clipboard.getClipboardData = getData;
        const { event, setData } = makeEvent();

        clipboard.copyHandler(event);

        expect(dataFor(setData, 'text/html')).toBe('');
        expect(dataFor(setData, 'text/plain')).toBe(raw);
        expect(getData).not.toHaveBeenCalled();
    });

    it('does nothing for an image with empty raw', () => {
        const muya = fakeMuya({
            editor: {
                selection: { image: { token: imageToken('') } },
            },
        } as unknown as Partial<Muya>);
        const clipboard = new Clipboard(muya);
        clipboard.getClipboardData = () => ({ html: '', text: '' });
        const { event, setData } = makeEvent();

        clipboard.copyHandler(event);

        expect(setData).not.toHaveBeenCalled();
    });
});

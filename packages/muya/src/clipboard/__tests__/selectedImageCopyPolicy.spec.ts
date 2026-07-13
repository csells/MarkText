// @vitest-environment jsdom

import type { Muya } from '../../muya';
import { describe, expect, it, vi } from 'vitest';
import { CopyType } from '../types';

vi.mock('../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (value: string) => value,
    loadLanguage: () => null,
    search: () => [],
}));

const Clipboard = (await import('../index')).default;

const RAW = '![{++<img src=x onerror=alert(1)>++}](https://example.test/image.png)';

function copy(
    copyType: CopyType,
    projection: 'marked' | 'original' | 'revised',
): Map<string, string> {
    const setData = vi.fn();
    const muya = {
        options: { criticMarkupProjection: projection },
        editor: {
            selection: { image: { token: { raw: RAW } } },
        },
    } as unknown as Muya;
    const clipboard = new Clipboard(muya);
    clipboard.copyType = copyType;
    clipboard.getClipboardData = vi.fn(() => {
        throw new Error('selected-image copy must not read the text selection');
    });

    clipboard.copyHandler({
        clipboardData: { setData },
    } as unknown as ClipboardEvent);

    return new Map(setData.mock.calls as Array<[string, string]>);
}

describe('selected-image copy uses the canonical sink policy', () => {
    it.each([
        CopyType.NORMAL,
        CopyType.COPY_AS_HTML,
        CopyType.COPY_AS_RICH,
        CopyType.COPY_AS_MARKDOWN,
    ])('never writes raw Markdown into text/html for %s', (copyType) => {
        for (const projection of ['marked', 'original', 'revised'] as const) {
            const payload = copy(copyType, projection);
            const html = payload.get('text/html') ?? '';

            expect(html).not.toBe(RAW);
            if (copyType === CopyType.COPY_AS_RICH) {
                expect(html).toContain('<img');
                const root = document.createElement('div');
                root.innerHTML = html;
                for (const element of root.querySelectorAll('*')) {
                    for (const attribute of element.attributes)
                        expect(attribute.name.toLowerCase()).not.toMatch(/^on/);
                }
            }
            else {
                expect(html).toBe('');
            }
        }
    });

    it.each(['marked', 'original', 'revised'] as const)(
        'keeps Markdown mode lossless under the %s projection',
        (projection) => {
            const payload = copy(CopyType.COPY_AS_MARKDOWN, projection);
            expect(payload.get('text/plain')).toBe(RAW);
        },
    );

    it('applies Original/Revised semantics to normal selected-image copy', () => {
        expect(copy(CopyType.NORMAL, 'original').get('text/plain'))
            .not
            .toContain('<img src=x');
        expect(copy(CopyType.NORMAL, 'revised').get('text/plain'))
            .toContain('<img src=x onerror=alert(1)>');
    });
});

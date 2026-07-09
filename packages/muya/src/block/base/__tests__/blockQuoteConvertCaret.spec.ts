// @vitest-environment happy-dom

import type { Muya } from '../../../muya';
import type Format from '../format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../../muya';
import Content from '../content';

vi.mock('../../../utils/prism/index', () => ({
    default: {},
    walkTokens: () => null,
    loadedLanguages: new Set(),
    transformAliasToOrigin: (s: string) => s,
    loadLanguage: () => Promise.resolve([]),
    search: () => [],
}));

// Typing `> ` at the start of a NON-first soft-wrapped line of a paragraph
// converts that line to a block quote and splits the preceding lines off. The
// caret must follow its text into the quote content. `_convertToBlockQuote`
// remapped the caret by subtracting only the stripped `> ` marker, NOT the
// preceding lines it moved out, so the caret was placed past the end of the
// (short) quote content. happy-dom does not maintain a DOM selection through
// `setCursor`, so we drive `getCursor` directly and capture the offset the
// conversion sets on the new quote content.

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    vi.restoreAllMocks();
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new MuyaClass(host, { markdown } as ConstructorParameters<typeof MuyaClass>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

describe('block-quote conversion caret placement', () => {
    it('places the caret in the quote content, not past its end, on a non-first soft-wrapped line', () => {
        const muya = bootMuya('seed\n');
        const content = muya.editor.scrollPage!.firstContentInDescendant() as Format;

        // `ab` is a preceding soft-wrapped line; `> cd` is being quoted. Caret at
        // offset 5 sits on `c`, the first char of the quoted content `cd`.
        content.text = 'ab\n> cd';
        vi.spyOn(content, 'getCursor').mockReturnValue({
            start: { offset: 5 },
            end: { offset: 5 },
        } as ReturnType<Format['getCursor']>);

        // Capture the caret the conversion sets on the freshly-created quote
        // content (a Content instance).
        const setCursorSpy = vi.spyOn(Content.prototype, 'setCursor');

        content.checkInlineUpdate();

        // Find the setCursor call whose target block is the quote content `cd`.
        let remapArgs: [number, number] | null = null;
        setCursorSpy.mock.instances.forEach((block, i) => {
            if ((block as unknown as { text?: string }).text === 'cd') {
                const call = setCursorSpy.mock.calls[i];
                remapArgs = [call[0], call[1]];
            }
        });
        expect(remapArgs, 'the caret should be remapped onto the quote content `cd`').toBeTruthy();
        // `c` is at offset 0 of `cd` — not offset 3 (5 minus only the `> ` marker),
        // which would be past the end of the two-character content.
        expect(remapArgs![0]).toBe(0);
        expect(remapArgs![1]).toBe(0);
    });
});

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASS_NAMES } from '../../config';
import { Muya } from '../../muya';
import { getOffsetOfParagraph } from '../dom';

describe('native element selection boundaries', () => {
    let muya: Muya | undefined;
    let host: HTMLDivElement;

    beforeEach(() => {
        vi.stubGlobal('MUYA_VERSION', 'test');
        host = document.body.appendChild(document.createElement('div'));
    });

    afterEach(() => {
        muya?.destroy();
        muya = undefined;
        host.remove();
        vi.unstubAllGlobals();
    });

    it.each([
        'word '.repeat(40),
        'before **bold** and [link](https://example.com) after',
        'A 😀 é 日本語',
        'before $x^2$ after',
        'before ![alt](https://example.com/image.png) after',
    ])(
        'reads a whole paragraph selection as text offsets: %s',
        (markdown) => {
            muya = new Muya(host, { markdown });
            muya.init();
            const block = muya.editor.scrollPage!.firstContentInDescendant()!;
            const range = document.createRange();
            range.selectNodeContents(block.domNode!);
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(range);

            const selection = muya.editor.selection.getSelection()!;
            expect(selection.anchor.offset).toBe(0);
            expect(selection.focus.offset).toBe(block.text.length);
        },
    );

    it('maps nested element boundaries and text offsets in the same UTF-16 domain', () => {
        const paragraph = document.createElement('span');
        paragraph.append('pre ');
        const nested = paragraph.appendChild(document.createElement('em'));
        nested.append('three', document.createTextNode('😀'));
        paragraph.append(' post');
        expect(getOffsetOfParagraph(nested, paragraph, 1)).toBe(9);
        expect(getOffsetOfParagraph(nested, paragraph, 2)).toBe(11);
        expect(getOffsetOfParagraph(nested.lastChild!, paragraph, 2)).toBe(11);
        expect(getOffsetOfParagraph(paragraph, paragraph, 2)).toBe(11);
    });

    it('does not count rendered math or ruby a second time at an element boundary', () => {
        const paragraph = document.createElement('span');
        paragraph.append('$x$');
        for (const className of [CLASS_NAMES.MU_MATH_RENDER, CLASS_NAMES.MU_RUBY_RENDER]) {
            const preview = paragraph.appendChild(document.createElement('span'));
            preview.className = className;
            preview.textContent = 'rendered preview';
        }
        paragraph.append(' after');
        expect(getOffsetOfParagraph(paragraph, paragraph, 3)).toBe(3);
        expect(getOffsetOfParagraph(paragraph, paragraph, 4)).toBe(9);
    });
});

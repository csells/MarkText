// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASS_NAMES } from '../../config';
import { Muya } from '../../muya';
import { getNodeAndOffset, getOffsetOfParagraph } from '../dom';

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

    it('maps offsets in a long highlighted block as its text reads', () => {
        const paragraph = document.createElement('span');
        let text = '';
        for (let line = 0; line < 40; line++) {
            const keyword = paragraph.appendChild(document.createElement('span'));
            keyword.className = 'token keyword';
            keyword.append('const');
            const nested = paragraph.appendChild(document.createElement('span'));
            nested.append(` value${line}`, document.createElement('b'));
            nested.lastChild!.appendChild(document.createTextNode('\t😀'));
            paragraph.append('\n');
            text += `const value${line}\t😀\n`;
        }
        const nodes: Text[] = [];
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
            nodes.push(node as Text);
        let before = 0;
        for (const node of nodes) {
            expect(getOffsetOfParagraph(node, paragraph, 1)).toBe(before + 1);
            const point = getNodeAndOffset(paragraph, before + 1);
            expect(getOffsetOfParagraph(point.node, paragraph, point.offset)).toBe(before + 1);
            before += node.data.length;
        }
        expect(before).toBe(text.length);
        expect(getOffsetOfParagraph(paragraph, paragraph, paragraph.childNodes.length)).toBe(text.length);
    });
});

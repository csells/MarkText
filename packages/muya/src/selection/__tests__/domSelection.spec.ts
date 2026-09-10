// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Format from '../../block/base/format';
import { Muya } from '../../muya';
import { getImageInfo } from '../../utils/image';

describe('exact native DOM selection endpoints', () => {
    let muya: Muya;
    let host: HTMLElement;
    beforeEach(() => {
        vi.stubGlobal('MUYA_VERSION', 'test');
        host = document.body.appendChild(document.createElement('div'));
        muya = new Muya(host, { markdown: 'ab' });
        muya.init();
    });
    afterEach(() => {
        muya.destroy();
        host.remove();
        document.getSelection()?.removeAllRanges();
        vi.unstubAllGlobals();
    });

    it('distinguishes before a rendered span from inside its text without stale selection memory', () => {
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const paragraph = block.domNode!;
        paragraph.innerHTML = '<span>ab</span>';
        const text = paragraph.firstChild!.firstChild!;
        const selection = muya.editor.selection;
        const outside = { node: paragraph, offset: 0 };
        const inside = { node: text, offset: 0 };
        selection.setDOMSelection(outside, outside);
        expect(selection.getDOMSelection()).toEqual({ anchor: outside, focus: outside });
        expect(selection.getSelection()?.anchor.offset).toBe(0);
        document.getSelection()!.setBaseAndExtent(text, 0, text, 0);
        expect(selection.getDOMSelection()).toEqual({ anchor: inside, focus: inside });
        expect(selection.getSelection()?.anchor.offset).toBe(0);
        selection.setDOMSelection(outside, inside);
        expect(selection.getDOMSelection()).toEqual({ anchor: outside, focus: inside });
        expect(selection.getSelection()).toMatchObject({ isCollapsed: false, direction: 'forward' });
        selection.setDOMSelection(inside, outside);
        expect(selection.getSelection()).toMatchObject({ isCollapsed: false, direction: 'backward' });
    });

    it('replaces a frozen table rectangle with an accepted text caret', () => {
        muya.setContent('| a | b |\n| --- | --- |\n| c | d |\n');
        const cell = muya.editor.scrollPage!.firstContentInDescendant()!;
        const selection = muya.editor.selection;
        const node = cell.domNode!;
        selection.table.setDOMSelection([{ anchor: { node, offset: 0 }, focus: { node, offset: node.childNodes.length } }], 0);
        expect(selection.type).toBe('table');
        expect(() => selection.setDOMSelection({ node, offset: 100 }, { node, offset: 100 })).toThrow(RangeError);
        expect(selection.type).toBe('table');
        const caret = selection.getDOMPoint({ path: cell.path, offset: 0 })!;
        selection.setDOMSelection(caret, caret);
        expect(selection.type).toBe('text');
        expect(selection.table.hasSelection).toBe(false);
        expect(selection.getDOMSelection()).toEqual({ anchor: caret, focus: caret });
        expect(muya.domNode.querySelector('.mu-table-cell-selected')).toBeNull();
    });

    it('exposes geometry conversion without replacing exact captured input points', () => {
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const paragraph = block.domNode!;
        paragraph.innerHTML = '<span>ab</span>';
        const text = paragraph.firstChild!.firstChild!;
        const selection = muya.editor.selection;
        const outside = { node: paragraph, offset: 0 };
        const inside = { node: text, offset: 0 };
        expect(selection.getTextPoint(outside)).toEqual({ path: block.path, offset: 0 });
        expect(selection.getTextPoint(inside)).toEqual({ path: block.path, offset: 0 });
        expect(selection.getDOMPoint({ path: block.path, offset: 1 })).toEqual({ node: text, offset: 1 });
        const input = vi.fn(() => false);
        muya.editor.bindDocumentEditing({
            prepareImage() { throw new Error('Unexpected image preparation'); },
            prepareClipboard() { throw new Error('Unexpected clipboard preparation'); },
            activeFormats: () => [],
            input,
            clipboard: () => { throw new Error('Unexpected clipboard'); },
            format: () => { throw new Error('Unexpected format'); },
            compositionStart: () => { throw new Error('Unexpected composition'); },
            compositionUpdate: () => { throw new Error('Unexpected composition'); },
            compositionEnd: () => { throw new Error('Unexpected composition'); },
        });
        selection.setDOMSelection(outside, outside);
        const event = new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, cancelable: true });
        Object.defineProperty(event, 'getTargetRanges', { value: () => [{ startContainer: text, startOffset: 0, endContainer: text, endOffset: 1 }] });
        paragraph.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(input).toHaveBeenCalledWith(expect.objectContaining({ selection: { anchor: outside, focus: outside }, range: { anchor: inside, focus: { node: text, offset: 1 } } }), expect.any(Function));
    });

    it.each([false, true])('keeps native image edges editable regardless of loading state: loaded=%s', (loaded) => {
        muya.setContent('![a](url)');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        if (loaded)
            block.domNode!.querySelector('.mu-image-container')!.appendChild(document.createElement('img'));
        const selection = muya.editor.selection;
        for (const offset of [0, block.text.length]) {
            const point = selection.getDOMPoint({ path: block.path, offset });
            expect(point).not.toBeNull();
            const element = point!.node instanceof Element ? point!.node : point!.node.parentElement;
            expect(element?.closest('[contenteditable="false"]')).toBeNull();
            block.setCursor(offset, offset);
            expect(selection.getDOMSelection()).toEqual({ anchor: point, focus: point });
            expect(selection.getTextPoint(point!)).toEqual({ path: block.path, offset });
        }
    });

    it('retains nested and empty inline boundaries and reports native range geometry', () => {
        const paragraph = muya.editor.scrollPage!.firstContentInDescendant()!.domNode!;
        paragraph.innerHTML = '<span><em>ab</em></span><button contenteditable="false"></button>';
        const outer = paragraph.firstChild!;
        const inner = outer.firstChild!;
        const selection = muya.editor.selection;
        const events: unknown[] = [];
        muya.on('selection-change', event => events.push(event));
        for (const point of [{ node: paragraph, offset: 0 }, { node: outer, offset: 0 }, { node: inner, offset: 0 }, { node: paragraph, offset: 1 }, { node: paragraph, offset: 2 }]) {
            selection.setDOMSelection(point, point);
            expect(selection.getDOMSelection()).toEqual({ anchor: point, focus: point });
        }
        selection.setDOMSelection({ node: paragraph, offset: 1 }, { node: paragraph, offset: 2 });
        expect(events[events.length - 1]).toMatchObject({ isCollapsed: false, direction: 'forward' });
        expect(selection.getTextPoint({ node: paragraph, offset: 3 })).toBeNull();
        expect(selection.getDOMPoint({ path: [0, 'text'], offset: 20 })).toBeNull();
        expect(() => selection.setDOMSelection({ node: paragraph, offset: 3 }, { node: paragraph, offset: 3 })).toThrow(RangeError);
        expect(selection.getDOMSelection()).toEqual({ anchor: { node: paragraph, offset: 1 }, focus: { node: paragraph, offset: 2 } });
    });

    it('expands fallback deletion by one grapheme while preserving the actual caret', () => {
        muya.setContent([{ name: 'paragraph', text: 'a😀b' }]);
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const selection = muya.editor.selection;
        const caret = selection.getDOMPoint({ path: block.path, offset: 3 })!;
        const start = selection.getDOMPoint({ path: block.path, offset: 1 })!;
        const input = vi.fn(() => false);
        muya.editor.bindDocumentEditing({
            prepareImage() { throw new Error('Unexpected image preparation'); },
            prepareClipboard() { throw new Error('Unexpected clipboard preparation'); },
            activeFormats: () => [],
            input,
            clipboard: () => { throw new Error('Unexpected clipboard'); },
            format: () => { throw new Error('Unexpected format'); },
            compositionStart: () => { throw new Error('Unexpected composition'); },
            compositionUpdate: () => { throw new Error('Unexpected composition'); },
            compositionEnd: () => { throw new Error('Unexpected composition'); },
        });
        selection.setDOMSelection(caret, caret);
        block.domNode!.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', data: null, bubbles: true, cancelable: true }));
        expect(input).toHaveBeenCalledWith(expect.objectContaining({ selection: { anchor: caret, focus: caret }, range: { anchor: start, focus: caret } }), expect.any(Function));
    });
    it('resolves repeated empty widgets by their actual native extent and refuses stale extents', () => {
        muya.setContent('![a]() ![a]()\n');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        if (!(block instanceof Format))
            throw new Error('Expected formatted content');
        const wrappers = block.domNode!.querySelectorAll<HTMLElement>('.mu-inline-image');
        expect(wrappers).toHaveLength(2);
        for (const wrapper of wrappers) {
            const image = { ...getImageInfo(wrapper), block };
            const selection = muya.editor.selection.getImageDOMSelection(image);
            expect(selection).not.toBeNull();
            expect(selection!.anchor.node.childNodes[selection!.anchor.offset]).toBe(wrapper);
            expect(selection!.focus.offset).toBe(selection!.anchor.offset + 1);
            expect(muya.editor.selection.getImageDOMSelection({ ...image, token: { ...image.token, range: { ...image.token.range, end: image.token.range.end + 1 } } })).toBeNull();
        }
        const stale = { ...getImageInfo(wrappers[0]!), block };
        wrappers[0]!.remove();
        expect(muya.editor.selection.getImageDOMSelection(stale)).toBeNull();
    });
});

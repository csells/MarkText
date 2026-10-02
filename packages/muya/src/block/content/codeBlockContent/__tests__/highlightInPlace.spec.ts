// @vitest-environment happy-dom

import type Content from '../../../base/content';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../../muya';
import { getNodeAndOffset } from '../../../../selection/dom';

// A key in a long highlighted block redraws only the children its change
// reaches, with the DOM a whole redraw would leave: highlighting the block
// again and parsing all of it made a key in a 2,000-line fence cost more
// than a frame.

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function codeContent(muya: Muya): Content {
    let target: Content | null = null;
    const visit = (block: {
        constructor: { blockName?: string };
        children?: { forEach: (cb: (b: unknown) => void) => void };
    }) => {
        if (block.constructor.blockName === 'codeblock.content')
            target = block as unknown as Content;
        block.children?.forEach(b => visit(b as typeof block));
    };
    visit(muya.editor.scrollPage as unknown as Parameters<typeof visit>[0]);
    if (!target)
        throw new Error('codeblock.content block not found');
    return target;
}

/** A DOM point as the child indices down to its node, then its offset. */
function pathOf(root: Node, point: { node: Node; offset: number }): number[] {
    const path = [point.offset];
    for (let node = point.node; node !== root; node = node.parentNode!)
        path.unshift(Array.prototype.indexOf.call(node.parentNode!.childNodes, node));
    return path;
}

const fence = (text: string, lang = 'js') => `\`\`\`${lang}\n${text}\n\`\`\`\n`;
/** The children a whole redraw of `text` leaves. */
const drawnAlone = (text: string, lang = 'js') => codeContent(bootMuya(fence(text, lang))).domNode!.innerHTML;

const lines = Array.from({ length: 60 }, (_, index) => `const value${index} = compute(${index}) // note ${index}`).join('\n');

describe('codeBlockContent highlight in place', () => {
    it('keeps the children before and after a changed line', () => {
        const content = codeContent(bootMuya(fence(lines)));
        const before = [...content.domNode!.childNodes];
        content.text = lines.replace('value30 =', 'valuex30 =');
        content.update();

        const after = [...content.domNode!.childNodes];
        expect(content.domNode!.innerHTML).toBe(drawnAlone(content.text));
        expect(after[0]).toBe(before[0]);
        expect(after[after.length - 1]).toBe(before[before.length - 1]);
    });

    it('keeps the text node a key changes the text of', () => {
        const content = codeContent(bootMuya(fence(lines)));
        const walker = document.createTreeWalker(content.domNode!, NodeFilter.SHOW_TEXT);
        let text: Text | null = null;
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            if (node.textContent === '// note 30')
                text = node as Text;
        }
        expect(text).not.toBeNull();
        content.text = lines.replace('// note 30\n', '// note 30x\n');
        content.update();

        expect(text!.isConnected).toBe(true);
        expect(text!.data).toBe('// note 30x');
        expect(content.domNode!.innerHTML).toBe(drawnAlone(content.text));
    });

    it('keeps the child native input already wrote the key into', () => {
        const content = codeContent(bootMuya(fence(lines)));
        const text = [...content.domNode!.childNodes].find(node => node.nodeType === Node.TEXT_NODE
            && node.textContent!.includes('value30')) as Text;
        text.data = text.data.replace('value30', 'valuex30');
        content.text = lines.replace('value30 =', 'valuex30 =');
        content.update();

        expect(text.isConnected).toBe(true);
        expect(content.domNode!.innerHTML).toBe(drawnAlone(content.text));
    });

    // Markup nests tokens and wraps entities; CSS aliases its tokens.
    it.each([
        ['js', ['x', ' ', '\n', '"', '\'', '`', '/*', '*/', '//', '{', '}', '(', ')', ';', '\\', '<', '&']],
        ['html', ['x', ' ', '\n', '"', '<a href="', '">', '</a>', '&amp;', '<!--', '-->', '<script>', '</script>', '=', '&']],
        ['css', ['x', ' ', '\n', '"', '{', '}', ':', ';', '/*', '*/', '@media ', '#a', '.b', 'url(', ')']],
    ])('draws what a whole redraw of %s draws after each of many keys', (lang, pieces) => {
        let seed = 7;
        const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        const content = codeContent(bootMuya(fence(lines, lang)));
        // A block whose DOM is emptied before each draw redraws whole.
        const whole = codeContent(bootMuya(fence(lines, lang)));
        let text = lines;
        // Keys away from the block's start leave its first child in place.
        let kept = 0;
        for (let key = 0; key < 120; key += 1) {
            const at = Math.floor(random() * (text.length + 1));
            text = random() < 0.7
                ? text.slice(0, at) + pieces[Math.floor(random() * pieces.length)] + text.slice(at)
                : text.slice(0, at) + text.slice(at + 1 + Math.floor(random() * 3));
            if (text.trim() === '')
                text = lines;
            const first = content.domNode!.firstChild;
            content.text = text;
            content.update();
            if (content.domNode!.firstChild === first)
                kept += 1;
            whole.domNode!.innerHTML = '';
            whole.text = text;
            whole.update();
            expect(content.domNode!.innerHTML, JSON.stringify(text)).toBe(whole.domNode!.innerHTML);
            // A point found from the drawing's text lengths is the one a walk
            // over a copy of its DOM finds.
            const copy = content.domNode!.cloneNode(true) as HTMLElement;
            for (let read = 0; read < 8; read += 1) {
                const offset = Math.floor(random() * (text.length + 1));
                expect(pathOf(content.domNode!, getNodeAndOffset(content.domNode!, offset)), `${offset}`)
                    .toEqual(pathOf(copy, getNodeAndOffset(copy, offset)));
            }
        }
        expect(whole.domNode!.innerHTML).toBe(drawnAlone(text, lang));
        expect(kept).toBeGreaterThan(60);
    }, 60_000);
});

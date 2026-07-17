// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

const editors: Muya[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

describe('criticMarkup comment paired removal', () => {
    it('removing a comment also removes its anchor highlight, keeping the text', () => {
        const muya = boot('a {==reviewed==}{>>a note<<} b');
        const comment = muya.getCriticMarkupItems()
            .find(item => item.type === 'comment');
        expect(comment).toBeDefined();

        muya.resolveCriticMarkup('accept', comment);

        const md = muya.getMarkdown();
        // The comment note is gone, AND its anchor highlight markers are gone,
        // leaving just the plain (formerly highlighted) text.
        expect(md).not.toContain('{>>');
        expect(md).not.toContain('{==');
        expect(md).toContain('a reviewed b');
    });

    it('removing a plain highlight (no comment) removes only that highlight', () => {
        const muya = boot('a {==plain==} b');
        const highlight = muya.getCriticMarkupItems()
            .find(item => item.type === 'highlight');
        expect(highlight).toBeDefined();

        muya.resolveCriticMarkup('accept', highlight);

        const md = muya.getMarkdown();
        expect(md).not.toContain('{==');
        expect(md).toContain('a plain b');
    });
});

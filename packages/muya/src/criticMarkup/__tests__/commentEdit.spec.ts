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

describe('critic markup comment edit', () => {
    it('rewrites a comment\'s text in place, keeping its anchor', () => {
        const muya = boot('a {==reviewed==}{>>old note<<} b');
        const comment = muya.getCriticMarkupItems()
            .find(item => item.type === 'comment');
        expect(comment).toBeDefined();

        expect(muya.editCriticMarkupComment(comment!, 'new note')).toBe(true);

        const md = muya.getMarkdown();
        // The anchor highlight is untouched; only the comment body changed.
        expect(md).toContain('{==reviewed==}');
        expect(md).toContain('{>>new note<<}');
        expect(md).not.toContain('old note');
    });

    it('refuses to edit a non-comment item', () => {
        const muya = boot('a {==plain==} b');
        const highlight = muya.getCriticMarkupItems()
            .find(item => item.type === 'highlight');
        expect(highlight).toBeDefined();

        expect(muya.editCriticMarkupComment(highlight!, 'nope')).toBe(false);
        expect(muya.getMarkdown()).toContain('{==plain==}');
    });

    it('refuses to edit a comment to empty text', () => {
        const muya = boot('a {==reviewed==}{>>keep<<} b');
        const comment = muya.getCriticMarkupItems()
            .find(item => item.type === 'comment');

        expect(muya.editCriticMarkupComment(comment!, '   ')).toBe(false);
        expect(muya.getMarkdown()).toContain('{>>keep<<}');
    });
});

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

describe('comment survives anchor deletion', () => {
    it('a point comment (anchor text deleted) stays listed and removable', () => {
        // Deleting all of a comment's anchored text turns {==sel==}{>>note<<}
        // into a bare {>>note<<}. That comment must survive: still a review
        // item, still removable — the app never silently drops a comment.
        const muya = boot('a {>>note<<} b');
        const comment = muya.getCriticMarkupItems()
            .find(item => item.type === 'comment');
        expect(comment).toBeDefined();
        expect(comment!.content).toBe('note');

        expect(muya.resolveCriticMarkup('accept', comment)).toBe(true);
        expect(muya.getMarkdown()).not.toContain('{>>');
        expect(muya.getMarkdown()).toContain('a  b');
    });

    it('deleting the anchor text does not paired-remove the comment (resolve-only)', () => {
        // Paired removal fires only through resolve, never through ordinary
        // editing, so a bare {>>note<<} with no anchor resolves as itself.
        const muya = boot('{>>solo<<}');
        const comment = muya.getCriticMarkupItems()
            .find(item => item.type === 'comment');
        expect(comment).toBeDefined();
        expect(muya.resolveCriticMarkup('accept', comment)).toBe(true);
        expect(muya.getMarkdown()).not.toContain('solo');
    });
});

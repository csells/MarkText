// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const hosts: HTMLElement[] = [];
const editors: Muya[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

describe('criticMarkup live projection views', () => {
    it('reparses topology without changing canonical Markdown or history', () => {
        const source = 'first{++\n\n++}second\n';
        const muya = boot(source);
        const historyDepth = muya.getHistory().stack.undo.length;

        muya.setOptions({ criticMarkupProjection: 'original' }, true);
        expect(muya.domNode.querySelectorAll('.mu-paragraph')).toHaveLength(1);
        expect(muya.domNode.textContent).toContain('firstsecond');
        expect(muya.domNode.getAttribute('aria-readonly')).toBe('true');

        muya.setOptions({ criticMarkupProjection: 'revised' }, true);
        expect(muya.domNode.querySelectorAll('.mu-paragraph')).toHaveLength(2);
        expect(muya.domNode.textContent).toContain('first');
        expect(muya.domNode.textContent).toContain('second');

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getHistory().stack.undo).toHaveLength(historyDepth);

        muya.setOptions({ criticMarkupProjection: 'marked' }, true);
        expect(muya.domNode.querySelectorAll('.mu-paragraph')).toHaveLength(2);
        expect(muya.domNode.hasAttribute('aria-readonly')).toBe(false);
        expect(muya.getMarkdown()).toBe(source);
    });

    it('recomposes inline Markdown delimiters through the native parser', () => {
        const source = '{++**++}bold{++**++}\n';
        const muya = boot(source);

        muya.setOptions({ criticMarkupProjection: 'revised' }, true);
        expect(muya.domNode.querySelector('strong')?.textContent).toBe('bold');
        expect(muya.domNode.querySelector('[data-critic-type]')).toBeNull();

        muya.setOptions({ criticMarkupProjection: 'original' }, true);
        expect(muya.domNode.querySelector('strong')).toBeNull();
        expect(muya.domNode.textContent).toContain('bold');

        muya.setOptions({ criticMarkupProjection: 'marked' }, true);
        expect(muya.domNode.querySelectorAll('[data-critic-type="addition"]'))
            .toHaveLength(2);
        expect(muya.getMarkdown()).toBe(source);
    });

    it('exposes block syntax through the projected Markdown parse', () => {
        const source = '{--remove--}# heading\n';
        const muya = boot(source);

        muya.setOptions({ criticMarkupProjection: 'revised' }, true);

        expect(muya.domNode.querySelector('h1')?.textContent).toContain('heading');
        expect(muya.getMarkdown()).toBe(source);
    });

    it('keeps resolution and undo canonical while clean views stay read-only', async () => {
        const source = '{++new++} {--old--}\n';
        const muya = boot(source);
        muya.setOptions({ criticMarkupProjection: 'revised' }, true);

        expect(muya.editor.selection.anchorBlock).toBeNull();
        expect(muya.editor.selection.focusBlock).toBeNull();
        expect(muya.getCriticMarkupCommandState()).toMatchObject({
            canCreateAddition: false,
            canCreateComment: false,
            canResolveCurrent: false,
            canResolveAll: true,
        });
        expect(muya.resolveAllCriticMarkup('accept')).toBe(2);
        expect(muya.getMarkdown()).toBe('new \n');
        expect(muya.domNode.textContent).toContain('new');
        expect(muya.domNode.querySelector('[data-critic-type]')).toBeNull();

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
        expect(muya.domNode.textContent).toContain('new');
        expect(muya.domNode.querySelector('[data-critic-type]')).toBeNull();
    });

    it('does not treat projected selections as canonical review positions', () => {
        const muya = boot('{++new++} {--old--}\n');
        muya.setOptions({ criticMarkupProjection: 'revised' }, true);

        const projectedLeaf
            = muya.editor.scrollPage!.firstContentInDescendant()!;
        projectedLeaf.setCursor(1, 1, true);

        expect(muya.getCriticMarkupCommandState().canResolveCurrent)
            .toBe(false);
        expect(muya.navigateCriticMarkup('next')).toBeNull();
        expect(muya.resolveCriticMarkup('accept')).toBe(false);
    });

    it('rejects search-replace and cut mutations in clean projections', () => {
        const source = '{++new++} {--old--}\n';
        const muya = boot(source);
        muya.setOptions({ criticMarkupProjection: 'revised' }, true);

        muya.search('new');
        muya.replace('changed');
        const projectedLeaf
            = muya.editor.scrollPage!.firstContentInDescendant()!;
        projectedLeaf.setCursor(0, projectedLeaf.text.length, true);
        muya.editor.clipboard.cutHandler();
        muya.flush();

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.domNode.textContent).toContain('new');
    });
});

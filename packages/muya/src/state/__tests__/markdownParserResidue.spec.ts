// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';
import { parseCriticMarkupDocument } from '../../utils/marked/criticMarkupDocument';
import { plainMarkdown } from '../markdownSourceMap';
import { renderToStaticHTML } from '../renderToStaticHTML';

const editors: Muya[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(source: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown: source });
    muya.init();
    editors.push(muya);
    return muya;
}

describe('native Markdown parser residue', () => {
    it('keeps hostile residue literal while later CriticMarkup remains semantic', () => {
        const hostileTail = [
            'lazy **bold** [link](javascript:alert(1))',
            '<img src=x onerror=alert(1)> {++literal++}',
        ].join(' ');
        const source = `${'> '.repeat(160)}leading\n${hostileTail}`
            + '\n\n{++outside++}\n';

        const staticHtml = renderToStaticHTML(source, {
            frontMatter: false,
        });
        expect(staticHtml).toContain(
            '<pre class="marked-block-nesting-limit"',
        );
        expect(staticHtml).toContain(
            'data-markdown-diagnostic="marked-block-nesting-limit"',
        );
        expect(staticHtml).not.toContain('<strong>bold</strong>');
        expect(staticHtml).not.toContain('<img ');

        const muya = boot(source);
        const residue = muya.domNode.querySelector(
            '.mu-markdown-parser-residue',
        );
        expect(residue).not.toBeNull();
        expect(muya.domNode.querySelectorAll(
            '.mu-markdown-parser-residue',
        )).toHaveLength(1);
        expect(residue!.textContent).toContain(hostileTail);
        expect(residue!.querySelector('strong')).toBeNull();
        expect(residue!.querySelector('a')).toBeNull();
        expect(residue!.querySelector('img')).toBeNull();
        expect(residue!.querySelector('ins')).toBeNull();
        expect(muya.domNode.querySelectorAll('[data-critic-id]'))
            .toHaveLength(1);

        const firstSave = muya.getMarkdown();
        expect(firstSave).toContain(hostileTail);
        expect(parseCriticMarkupDocument(
            plainMarkdown(firstSave),
            { frontMatter: false },
        ).items).toHaveLength(1);

        const reopened = boot(firstSave);
        expect(reopened.getMarkdown()).toBe(firstSave);
        expect(reopened.getCriticMarkupItems()).toHaveLength(1);
    }, 15_000);
});

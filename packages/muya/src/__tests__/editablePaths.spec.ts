// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

const hosts: HTMLElement[] = [];

afterEach(() => {
    for (const host of hosts.splice(0))
        host.remove();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

describe('Muya editable content paths', () => {
    it('keeps unbound paragraphs locked across a whole-document rebuild', () => {
        const muya = boot('locked\n\neditable\n');

        muya.setEditablePaths([[1, 'text']]);
        let paragraphs = muya.domNode.querySelectorAll<HTMLElement>(
            'span.mu-paragraph-content',
        );
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('false');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');

        muya.setContent('locked again\n\neditable again\n');
        paragraphs = muya.domNode.querySelectorAll<HTMLElement>(
            'span.mu-paragraph-content',
        );
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('false');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');

        expect(muya.replaceContent('replaced\n\nstill editable\n')).toBe(true);
        paragraphs = muya.domNode.querySelectorAll<HTMLElement>(
            'span.mu-paragraph-content',
        );
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('false');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');

        muya.setOptions({ math: false }, true);
        paragraphs = muya.domNode.querySelectorAll<HTMLElement>(
            'span.mu-paragraph-content',
        );
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('false');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');

        muya.locale({ name: 'locked-test', resource: {} });
        paragraphs = muya.domNode.querySelectorAll<HTMLElement>(
            'span.mu-paragraph-content',
        );
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('false');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');

        muya.setEditablePaths(null);
        expect(paragraphs[0]?.getAttribute('contenteditable')).toBe('true');
        expect(paragraphs[1]?.getAttribute('contenteditable')).toBe('true');
    });
});

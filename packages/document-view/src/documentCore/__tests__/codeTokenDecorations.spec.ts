// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
    clearCodeTokenDecorations,
    paintCodeTokenDecorations,
} from '../codeTokenDecorations';

const codeBlock = (language: string, text: string): HTMLElement => {
    const host = document.createElement('div');
    const pre = document.createElement('pre');
    pre.className = 'document-view-code-block';
    const code = document.createElement('code');
    code.dataset.language = language;
    code.appendChild(document.createTextNode(text));
    pre.appendChild(code);
    host.appendChild(pre);
    return host;
};

describe('code token decorations', () => {
    it('emits themed token classes for a fenced language', () => {
        const host = codeBlock('js', 'const answer = 42');
        paintCodeTokenDecorations(host);

        expect(host.querySelector('span.token.keyword')?.textContent)
            .toBe('const');
        expect(host.querySelector('span.token.number')?.textContent)
            .toBe('42');
    });

    it('resolves an alias the fence spells differently', () => {
        const host = codeBlock('c++', 'int main() { return 0; }');
        paintCodeTokenDecorations(host);
        expect(host.querySelectorAll('span.token').length).toBeGreaterThan(0);
    });

    // The offset math of every other seam reads this text, so painting must be
    // text-preserving: same characters, no attributes on the wrappers.
    it('leaves the code text byte-identical', () => {
        const source = 'const answer = 42\nreturn answer\n';
        const host = codeBlock('js', source);
        paintCodeTokenDecorations(host);
        const code = host.querySelector('code');
        expect(code?.textContent).toBe(source);
        for (const span of host.querySelectorAll('span.token')) {
            expect(span.getAttributeNames().sort()).toEqual(['class']);
        }
    });

    it('restores the original single text node when cleared', () => {
        const source = 'const answer = 42';
        const host = codeBlock('js', source);
        paintCodeTokenDecorations(host);
        expect(host.querySelectorAll('span.token').length).toBeGreaterThan(0);

        clearCodeTokenDecorations(host);
        const code = host.querySelector('code');
        expect(code?.querySelectorAll('span.token').length).toBe(0);
        expect(code?.textContent).toBe(source);
        expect(code?.childNodes.length).toBe(1);
    });

    it('repaints idempotently', () => {
        const host = codeBlock('js', 'const answer = 42');
        paintCodeTokenDecorations(host);
        const first = host.querySelectorAll('span.token').length;
        paintCodeTokenDecorations(host);
        expect(host.querySelectorAll('span.token').length).toBe(first);
        expect(host.querySelector('code')?.textContent)
            .toBe('const answer = 42');
    });

    // Non-negotiable 2: no second Markdown recognizer ships in the
    // renderer, so a markdown fence renders unhighlighted by design (G40).
    it('does not tokenize a markdown fence', () => {
        const host = codeBlock('md', '# heading *emphasis*');
        paintCodeTokenDecorations(host);
        expect(host.querySelectorAll('span.token').length).toBe(0);
        expect(host.querySelector('code')?.textContent)
            .toBe('# heading *emphasis*');
    });

    it('leaves an unknown language untouched', () => {
        const host = codeBlock('not-a-language', 'const answer = 42');
        paintCodeTokenDecorations(host);
        expect(host.querySelectorAll('span.token').length).toBe(0);
        expect(host.querySelector('code')?.textContent)
            .toBe('const answer = 42');
    });
});

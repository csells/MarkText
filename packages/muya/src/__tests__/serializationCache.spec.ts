// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../muya';
import StateToMarkdown from '../state/stateToMarkdown';

// P4: getMarkdown serialization is cached per JSONState version — the
// sidebar, save path, word count, and bridge reads may all serialize in the
// same tick, and only the first should pay for materialization + generation.

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    vi.restoreAllMocks();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

describe('getMarkdown serialization cache', () => {
    it('serializes once per document version regardless of caller count', () => {
        const muya = boot('Hello <!--MC:a-->x<!--MC:~a--> world.\n\n[MC:a]: {"version":2,"status":"open"}\n');
        const generate = vi.spyOn(StateToMarkdown.prototype, 'generate');

        const first = muya.getMarkdown();
        muya.getMarkdown();
        muya.getMarkdown();

        expect(generate).toHaveBeenCalledTimes(1);
        expect(muya.getMarkdown()).toBe(first);
    });

    it('re-serializes after a document edit', () => {
        const muya = boot('plain text\n');
        const generate = vi.spyOn(StateToMarkdown.prototype, 'generate');

        const before = muya.getMarkdown();
        const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
        leaf.text = 'plain text edited';
        muya.flush();
        const after = muya.getMarkdown();

        expect(before).toContain('plain text');
        expect(after).toContain('plain text edited');
        expect(generate).toHaveBeenCalledTimes(2);
    });

    it('re-serializes after a comment-model mutation (no document op)', () => {
        const muya = boot('Hello <!--MC:a-->x<!--MC:~a--> world.\n\n[MC:a]: {"version":2,"status":"open"}\n');
        muya.getMarkdown();
        const generate = vi.spyOn(StateToMarkdown.prototype, 'generate');

        expect(muya.resolveComment('a', '2026-07-07T10:00:00.000Z')).toBe(true);
        const resolved = muya.getMarkdown();

        expect(resolved).toContain('"status":"resolved"');
        expect(generate).toHaveBeenCalledTimes(1);
    });
});

// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import { createDocumentCoreView } from '../documentCoreView';

/**
 * Increment 4, end to end — the loop the editor actually runs.
 *
 * A keystroke lands on the DOM, becomes a typed intent against the engine,
 * commits a new immutable revision, and the DOM re-renders from it. The engine
 * is the authority the whole way round: the view never edits its own DOM text
 * and never decides what the document now says.
 *
 * The point of proving it here rather than only in document-core is that this is
 * a real browser DOM, mounted by muya, driven by user-shaped gestures.
 */

const PARSE_CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    liveHtmlSafetyProfile: 'live-html-safety-profile-1',
    executionBudget: {
        limitsProfile: 'test-unbounded',
        accountingSchema: 'syntax-accounting-1',
    },
};

async function mount(source: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
    });
    return { host, view };
}

describe('document-core view', () => {
    it('mounts the engine-rendered document', async () => {
        const { host } = await mount('# Title\n\nHello {++world++}.\n');
        expect([...host.children].map(child => child.tagName)).toEqual([
            'H1',
            'P',
        ]);
        expect(host.querySelector('ins')?.textContent).toBe('world');
    });

    it('commits a keystroke and re-renders from the new revision', async () => {
        const { host, view } = await mount('Hello world.\n');
        await view.typeText(5, ' there');
        expect(host.textContent).toBe('Hello there world.');
        expect(view.modelText()).toBe('Hello there world.\n');
    });

    it('leaves a tracked change intact when typing beside it', async () => {
        const { host, view } = await mount('Hello {++world++}.\n');
        await view.typeText(0, 'Oh, ');
        // The addition is still an addition, not accepted or flattened away.
        expect(host.querySelector('ins')?.textContent).toBe('world');
        expect(host.textContent).toBe('Oh, Hello world.');
    });

    it('keeps the DOM offsets addressing the new revision after an edit', async () => {
        const { host, view } = await mount('Hello {++world++}.\n');
        await view.typeText(0, 'Oh, ');
        const inserted = host.querySelector('ins');
        // Offsets must describe the document as it is NOW; stale ones would
        // send the next edit to the wrong place.
        const start = Number(inserted?.getAttribute('data-model-start'));
        expect(view.modelText().slice(start, start + 5)).toBe('world');
    });

    it('undoes back to the exact prior document', async () => {
        const { host, view } = await mount('Hello world.\n');
        await view.typeText(5, '!');
        expect(view.modelText()).toBe('Hello! world.\n');
        await view.undo();
        expect(view.modelText()).toBe('Hello world.\n');
        expect(host.textContent).toBe('Hello world.');
    });
});

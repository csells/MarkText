// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import { createDocumentCoreView } from '../documentCoreView';

/**
 * Selection on the engine.
 *
 * The caret is a document position, not a DOM position. Keeping it in model
 * offsets means an edit elsewhere cannot leave the caret pointing at stale DOM,
 * and it is what lets the engine place the caret correctly after re-rendering
 * from a new revision.
 *
 * It also decides a CriticMarkup question the DOM cannot answer on its own: at
 * the boundary of a tracked change the same visual spot is two document
 * positions, and which one the caret takes determines whether typing extends the
 * change or the text beside it.
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

describe('selection', () => {
    it('reports the caret as a model offset', async () => {
        const { view } = await mount('Hello world.\n');
        expect(view.getSelection()).toEqual({ start: 0, end: 0 });
    });

    it.fails('eNGINE GAP: moves the caret to a model offset', async () => {
        // DocumentSession exposes snapshot/dispatch/flush/subscribe and no way
        // to move the caret: selection is set when the document opens and then
        // only moves as a side effect of an edit. A WYSIWYG editor needs
        // click-to-place and arrow keys, so the session must own a selection
        // change — the view tracking its own caret would be a second source of
        // truth for a position the engine already holds.
        //
        // Deliberately not bolted on here: a selection change is session state
        // rather than a new revision, so it has to settle what it does to
        // transitions and retained drafts. That belongs in document-core.
        const { view } = await mount('Hello world.\n');
        (view as unknown as { setCursorByOffset: (offset: number) => void })
            .setCursorByOffset(5);
        expect(view.getSelection()).toEqual({ start: 5, end: 5 });
    });

    it('places the caret where an edit left it', async () => {
        const { view } = await mount('Hello world.\n');
        await view.typeText(5, ' there');
        // The caret follows the inserted text, so the next keystroke continues
        // where the user was typing rather than jumping back.
        expect(view.getSelection().start).toBe(11);
    });

    it('tracks focus of the mounted element', async () => {
        const { host, view } = await mount('abc\n');
        expect(view.hasFocus()).toBe(false);
        host.setAttribute('tabindex', '0');
        host.focus();
        expect(view.hasFocus()).toBe(true);
        view.blur();
        expect(view.hasFocus()).toBe(false);
    });
});

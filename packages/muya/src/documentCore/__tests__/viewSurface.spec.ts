// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import { createDocumentCoreView } from '../documentCoreView';

/**
 * The remaining view surface the editor calls.
 *
 * These are the presentation-side methods — the mounted node, focus, focus mode,
 * float tools, image paste. They are thin next to the editing semantics, but the
 * editor calls them unconditionally, so a tab running on this engine has to
 * answer them rather than throw.
 *
 * Where a call needs document structure the engine does not yet expose, it is
 * recorded as an unsupported capability rather than approximated: quietly doing
 * something similar-but-wrong to a user's document is worse than declining.
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

async function mount(source = '# Title\n\nBody.\n') {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
    });
    return { host, view };
}

describe('view surface', () => {
    it('exposes the mounted node', async () => {
        const { host, view } = await mount();
        expect(view.domNode()).toBe(host);
    });

    it('focuses and blurs the mounted node', async () => {
        const { view } = await mount();
        view.focus();
        expect(view.hasFocus()).toBe(true);
        view.blur();
        expect(view.hasFocus()).toBe(false);
    });

    it('toggles focus mode as a root class', async () => {
        const { host, view } = await mount();
        view.setFocusMode(true);
        expect(host.classList.contains('mu-focus-mode')).toBe(true);
        view.setFocusMode(false);
        expect(host.classList.contains('mu-focus-mode')).toBe(false);
    });

    it('answers hideAllFloatTools without a float layer', async () => {
        const { view } = await mount();
        // This view mounts no float tools yet; the editor still calls this on
        // every selection change, so it must be a safe no-op rather than throw.
        expect(() => view.hideAllFloatTools()).not.toThrow();
    });

    it('pastes an image as Markdown the engine owns', async () => {
        const { view } = await mount('before after\n');
        await view.pasteImage(7, { src: 'assets/a.png', alt: 'a shape' });
        // The image is document content, so it goes in as source the engine
        // parses — not as a DOM node the view sticks in by itself.
        expect(await view.getMarkdown())
            .toBe('before ![a shape](assets/a.png)after\n');
    });

    it('reports which capabilities it supports', async () => {
        const { view } = await mount();
        // The editor can ask instead of discovering by exception, and a flow
        // that needs an unsupported capability is a reason not to migrate it
        // yet.
        expect(view.supports('typing')).toBe(true);
        expect(view.supports('search')).toBe(true);
        expect(view.supports('list-indentation')).toBe(false);
    });

    it('declines an unsupported structural command', async () => {
        const { view } = await mount('- one\n- two\n');
        // Approximating list indentation with text edits would corrupt the
        // document's structure; declining is the honest answer until the engine
        // exposes structural edits.
        await expect(view.setListIndentation(0, 'increase')).rejects.toThrow();
    });
});

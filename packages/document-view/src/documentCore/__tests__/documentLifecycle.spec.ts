// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

/**
 * Document lifecycle — what a real editing flow needs beyond typing and saving.
 *
 * The editor has to know when the document changed, so it can mark a tab dirty,
 * drive autosave and refresh derived state.
 * Migrating a flow onto the engine means these come from the engine too, rather
 * than the view tracking its own idea of "changed" — two sources of that truth
 * is how a tab ends up clean while the file on disk is stale.
 */

const PARSE_CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: {
      schema: 'markdown-options-1',
      gfm: true,
      frontMatter: true,
      math: true,
      gitLabMath: false,
      footnotes: false,
      subscriptAndSuperscript: true
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1',
    },
};

async function mount(source: string) {
    const host = document.createElement('div');
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
    });
    return { host, view };
}

describe('document lifecycle', () => {
    it('notifies a listener when an edit commits', async () => {
        const { view } = await mount('Hello world.\n');
        const seen: string[] = [];
        view.onChange(() => seen.push(view.modelText()));

        await view.typeText(5, ' there');
        expect(seen).toEqual(['Hello there world.\n']);
    });

    it('stops notifying once the listener is disposed', async () => {
        const { view } = await mount('a\n');
        let calls = 0;
        const subscription = view.onChange(() => {
            calls += 1;
        });

        await view.typeText(1, 'b');
        expect(calls).toBe(1);

        subscription.dispose();
        await view.typeText(2, 'c');
        // A leaked subscription would keep a closed document alive and keep
        // reporting changes for a tab the user already left.
        expect(calls).toBe(1);
    });

});

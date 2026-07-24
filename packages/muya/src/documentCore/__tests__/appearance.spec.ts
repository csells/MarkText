// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import { createDocumentCoreView } from '../documentCoreView';

/**
 * Appearance options.
 *
 * `setOptions` is the single most-called method the editor uses (29 call sites),
 * because every preference change routes through it. muya already defines the
 * contract: typography options are CSS custom properties on the editor root, and
 * code-block wrapping is a root class. Honouring that same contract means a
 * document-core tab themes identically to a legacy one, and preference plumbing
 * does not have to learn which engine a tab is running.
 *
 * Only the appearance keys are handled here; unrelated options are ignored
 * rather than rejected, since the editor passes one bag of options for
 * everything.
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

async function mount() {
    const host = document.createElement('div');
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot('# Title\n\nBody.\n'),
        parseConfiguration: PARSE_CONFIGURATION,
    });
    return { host, view };
}

describe('appearance options', () => {
    it('maps typography options to the documented custom properties', async () => {
        const { host, view } = await mount();
        view.setOptions({
            fontSize: 18,
            lineHeight: 1.8,
            editorFontFamily: 'Iosevka',
            codeFontSize: 14,
            codeFontFamily: 'Fira Code',
        });
        expect(host.style.getPropertyValue('--mu-font-size')).toBe('18px');
        expect(host.style.getPropertyValue('--mu-line-height')).toBe('1.8');
        expect(host.style.getPropertyValue('--mu-font-family')).toBe('Iosevka');
        expect(host.style.getPropertyValue('--mu-code-font-size')).toBe('14px');
        expect(host.style.getPropertyValue('--mu-code-font-family'))
            .toBe('Fira Code');
    });

    it('toggles code-block wrapping as a root class', async () => {
        const { host, view } = await mount();
        view.setOptions({ wrapCodeBlocks: true });
        expect(host.classList.contains('mu-code-wrap')).toBe(true);
        view.setOptions({ wrapCodeBlocks: false });
        expect(host.classList.contains('mu-code-wrap')).toBe(false);
    });

    it('leaves untouched options alone', async () => {
        const { host, view } = await mount();
        view.setOptions({ fontSize: 18 });
        view.setOptions({ lineHeight: 2 });
        // A later call must not clear an earlier one: the editor sets options
        // one preference at a time.
        expect(host.style.getPropertyValue('--mu-font-size')).toBe('18px');
        expect(host.style.getPropertyValue('--mu-line-height')).toBe('2');
    });

    it('ignores options it does not own', async () => {
        const { host, view } = await mount();
        expect(() => view.setOptions({
            mermaidTheme: 'dark',
            spellcheckEnabled: true,
        })).not.toThrow();
        expect(host.style.getPropertyValue('--mu-font-size')).toBe('');
    });

    it('does not disturb the rendered document', async () => {
        const { host, view } = await mount();
        view.setOptions({ fontSize: 18 });
        expect([...host.children].map(child => child.tagName)).toEqual([
            'H1',
            'P',
        ]);
    });
});

// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

/**
 * Appearance options.
 *
 * `setOptions` is the single most-called method the editor uses (29 call sites),
 * because every preference change routes through it. Typography options are
 * CSS custom properties on the editor root, and
 * code-block wrapping is a root class. The document-core view owns this contract
 * directly so preference plumbing has one editor surface.
 *
 * The target owns one closed option contract. Removed or misspelled keys fail
 * immediately instead of silently creating dead preference paths.
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
            editorLineWidth: '72ch',
        });
        expect(host.style.getPropertyValue('--document-view-font-size')).toBe('18px');
        expect(host.style.getPropertyValue('--document-view-line-height')).toBe('1.8');
        expect(host.style.getPropertyValue('--document-view-font-family')).toBe('Iosevka');
        expect(host.style.getPropertyValue('--document-view-code-font-size')).toBe('14px');
        expect(host.style.getPropertyValue('--document-view-code-font-family'))
            .toBe('Fira Code');
        expect(host.style.getPropertyValue('--document-view-editor-area-width'))
            .toBe('calc(100px + 72ch)');
    });

    it('toggles code-block wrapping as a root class', async () => {
        const { host, view } = await mount();
        view.setOptions({ wrapCodeBlocks: true });
        expect(host.classList.contains('document-view-code-wrap')).toBe(true);
        view.setOptions({ wrapCodeBlocks: false });
        expect(host.classList.contains('document-view-code-wrap')).toBe(false);
    });

    it('leaves untouched options alone', async () => {
        const { host, view } = await mount();
        view.setOptions({ fontSize: 18 });
        view.setOptions({ lineHeight: 2 });
        // A later call must not clear an earlier one: the editor sets options
        // one preference at a time.
        expect(host.style.getPropertyValue('--document-view-font-size')).toBe('18px');
        expect(host.style.getPropertyValue('--document-view-line-height')).toBe('2');
    });

    it('rejects options outside its closed contract', async () => {
        const { host, view } = await mount();
        expect(() => view.setOptions({
            mermaidTheme: 'dark',
            spellcheckEnabled: true,
        } as never)).toThrow(/Unknown document option: mermaidTheme/);
        expect(host.style.getPropertyValue('--document-view-font-size')).toBe('');
    });

    it('rejects wrong-typed and malformed option values at the runtime seam', async () => {
        const { view } = await mount();

        expect(() => view.setOptions({ fontSize: Number.NaN }))
            .toThrow(/fontSize/);
        expect(() => view.setOptions({ lineHeight: '1.8' } as never))
            .toThrow(/lineHeight/);
        expect(() => view.setOptions({ wrapCodeBlocks: 'yes' } as never))
            .toThrow(/wrapCodeBlocks/);
        expect(() => view.setOptions({ editorFontFamily: 12 } as never))
            .toThrow(/editorFontFamily/);
        expect(() => view.setOptions({ editorLineWidth: '72em' }))
            .toThrow(/editorLineWidth/);
    });

    it('clears an explicit editor width back to the theme width', async () => {
        const { host, view } = await mount();
        view.setOptions({ editorLineWidth: '900px' });
        view.setOptions({ editorLineWidth: '' });

        expect(host.style.getPropertyValue('--document-view-editor-area-width'))
            .toBe('');
    });

    it('does not disturb the rendered document', async () => {
        const { host, view } = await mount();
        view.setOptions({ fontSize: 18 });
        expect([...host.children].map(child => child.tagName)).toEqual([
            'H1',
            'P',
        ]);
    });

    it('reconfigures parser-owned Markdown features without changing source', async () => {
        const source = [
            'note[^n]',
            '',
            '[^n]: body',
            '',
            'H~2~O',
            '',
            '```math',
            'x+y',
            '```',
            '',
        ].join('\n');
        const host = document.createElement('div');
        const view = await createDocumentCoreView({
            host,
            source: createSourceSnapshot(source),
            parseConfiguration: {
                ...PARSE_CONFIGURATION,
                markdownOptions: {
                    ...PARSE_CONFIGURATION.markdownOptions,
                    footnotes: false,
                    gitLabMath: false,
                    subscriptAndSuperscript: false,
                },
            },
        });

        expect(host.querySelector('.footnotes')).toBeNull();
        expect(host.querySelector('sub')).toBeNull();
        expect(host.querySelector('.math-block')).toBeNull();

        view.setOptions({
            footnotes: true,
            gitLabMath: true,
            subscriptAndSuperscript: true,
        });
        await view.settled();

        expect(host.querySelector('.footnotes')).not.toBeNull();
        expect(host.querySelector('sub')?.textContent).toBe('2');
        expect(host.querySelector('.math-block code')?.textContent).toBe('x+y\n');
        expect(await view.getMarkdown()).toBe(source);
    });
});

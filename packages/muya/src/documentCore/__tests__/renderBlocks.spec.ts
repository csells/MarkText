// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import {
    canonicalMarkupDocument,
    createDocumentSession,
    createLanguageEngine,
    createSourceSnapshot,
    groupRenderBlocks,

    renderMarkupPlan,
} from '@marktext/document-core';
import { describe, expect, it } from 'vitest';
import { renderDocumentCoreBlocks } from '../renderBlocks';

/**
 * Increment 4 — the first production caller of the document engine.
 *
 * Until now `@marktext/document-core` rendered nothing: the engine could parse,
 * project and round-trip a keystroke, but no editor mounted it. This renders its
 * block tree into real DOM, which is what makes muya a *view* over the engine
 * rather than a second authority deciding structure for itself
 * (ADR-0009/ADR-0013).
 *
 * The DOM carries model offsets so selection maps back to the engine, and
 * CriticMarkup keeps its own elements so a tracked change looks like one.
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

async function render(source: string): Promise<HTMLElement> {
    const revision = createLanguageEngine().open(
        createSourceSnapshot(source),
        PARSE_CONFIGURATION,
    );
    if (revision.kind !== 'complete')
        throw new Error('Expected a complete revision');

    const session = await createDocumentSession({
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
        configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
        initialView: 'markup',
        trackChanges: false,
        initialSelection: {
            anchor: { offset: 0, affinity: 'next' },
            focus: { offset: 0, affinity: 'next' },
        },
    });

    const runs = renderMarkupPlan(session.snapshot().livePlan);
    const blocks = groupRenderBlocks(canonicalMarkupDocument(revision), runs);
    const host = document.createElement('div');
    renderDocumentCoreBlocks(host, blocks);
    return host;
}

describe('document-core block rendering', () => {
    it('mounts one element per engine-emitted block', async () => {
        const host = await render('# Title\n\nHello world.\n');
        expect([...host.children].map(child => child.tagName)).toEqual([
            'H1',
            'P',
        ]);
    });

    it('honours the heading level the engine parsed', async () => {
        // The engine records the level; the view must mount it rather than
        // flattening every heading to the same element.
        const host = await render('# One\n\n### Three\n\n###### Six\n');
        expect([...host.children].map(child => child.tagName)).toEqual([
            'H1',
            'H3',
            'H6',
        ]);
    });

    it('renders a tracked addition as an insertion inside its block', async () => {
        const host = await render('Hello {++brave ++}world.\n');
        const paragraph = host.firstElementChild;
        expect(paragraph?.tagName).toBe('P');
        expect(paragraph?.querySelector('ins')?.textContent).toBe('brave ');
        // The whole paragraph still reads as the author sees it.
        expect(paragraph?.textContent).toBe('Hello brave world.');
    });

    it('renders each CriticMarkup form with its own element', async () => {
        const host = await render('a{--cut--}b{==high==}c{~~old~>new~~}d\n');
        const paragraph = host.firstElementChild;
        expect(paragraph?.querySelector('del')?.textContent).toBe('cut');
        expect(paragraph?.querySelector('mark')?.textContent).toBe('high');
        // A substitution shows both arms: the old struck, the new inserted.
        const dels = [...(paragraph?.querySelectorAll('del') ?? [])].map(
            node => node.textContent,
        );
        const inses = [...(paragraph?.querySelectorAll('ins') ?? [])].map(
            node => node.textContent,
        );
        expect(dels).toContain('old');
        expect(inses).toContain('new');
    });

    it('carries model offsets so selection maps back to the engine', async () => {
        const host = await render('Hello {++brave ++}world.\n');
        const inserted = host.querySelector('ins');
        // The view must never recompute offsets from rendered text length.
        expect(inserted?.getAttribute('data-model-start')).toBe('6');
        expect(inserted?.getAttribute('data-model-end')).toBe('12');
    });

    it('splits a block-spanning addition into the blocks it creates', async () => {
        const host = await render('a{++\n\n++}b');
        expect([...host.children].map(child => child.tagName)).toEqual([
            'P',
            'P',
        ]);
        expect([...host.children].map(child => child.textContent)).toEqual([
            'a',
            'b',
        ]);
    });

    it('replaces prior content when re-rendered', async () => {
        const host = await render('# Title\n\nBody.\n');
        renderDocumentCoreBlocks(host, []);
        expect(host.children).toHaveLength(0);
    });
});

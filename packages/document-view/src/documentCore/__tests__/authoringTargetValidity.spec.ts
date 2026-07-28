// @vitest-environment happy-dom

import {
    createSourceSnapshot,
    type ParseConfiguration,
} from '@marktext/document-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { IDocumentCoreView } from '../documentCoreView';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

const CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: {
        schema: 'markdown-options-1',
        gfm: true,
        frontMatter: true,
        math: true,
        gitLabMath: false,
        footnotes: false,
        subscriptAndSuperscript: true,
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1',
    },
};

const mountedViews: IDocumentCoreView[] = [];

afterEach(async () => {
    await Promise.all(mountedViews.splice(0).map(view => view.destroy()));
    document.body.replaceChildren();
});

async function mount(source: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: CONFIGURATION,
    });
    mountedViews.push(view);
    return { host, view };
}

function textNodeContaining(root: Node, needle: string): Text {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node instanceof Text && node.data.includes(needle))
            return node;
    }
    throw new Error(`No mounted text contains ${JSON.stringify(needle)}`);
}

function selectText(root: Node, needle: string): void {
    const node = textNodeContaining(root, needle);
    const start = node.data.indexOf(needle);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + needle.length);
    const selection = document.getSelection();
    if (selection === null)
        throw new Error('The document has no browser Selection');
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
}

describe('document view parser-owned authoring targets', () => {
    it('widens a complete visible literal to its exact source owner', async () => {
        const source = 'A `code` Z';
        const { host, view } = await mount(source);
        selectText(host, 'code');

        await view.commitSelection();
        expect(view.getReviewIndex().authoring.canCreateComment).toBe(true);
        await view.authorCriticMarkup({
            kind: 'comment',
            comment: 'literal note',
        });

        expect(view.getMarkdownSync())
            .toBe('A {==`code`==}{>>literal note<<} Z');
        await view.undo();
        expect(view.getMarkdownSync()).toBe(source);
        expect(document.getSelection()?.toString()).toBe('code');
    });

    it('widens a complete nested change but rejects a partial literal', async () => {
        const source = 'A {++nested++} and `code` Z';
        const { host, view } = await mount(source);
        selectText(host, 'nested');

        await view.commitSelection();
        expect(view.getReviewIndex().authoring.canCreateHighlight).toBe(true);
        await view.authorCriticMarkup({ kind: 'highlight' });
        expect(view.getMarkdownSync()).toBe(
            'A {=={++nested++}==} and `code` Z',
        );
        await view.undo();

        selectText(host, 'od');
        await view.commitSelection();
        expect(view.getReviewIndex().authoring).toMatchObject({
            canCreateAddition: false,
            canCreateDeletion: false,
            canCreateSubstitution: false,
            canCreateHighlight: false,
            canCreateComment: false,
        });
        expect(view.getMarkdownSync()).toBe(source);
    });
});

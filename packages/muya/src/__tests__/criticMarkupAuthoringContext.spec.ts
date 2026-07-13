// @vitest-environment happy-dom

import type { Muya as MuyaInstance } from '../muya';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourceOffset } from '../mappedText';
import { Muya } from '../muya';

interface IAuthoringContextFixture {
    id: string;
    markdown: string;
    selected: string;
}

const AUTHORING_LITERAL_CONTEXTS: readonly IAuthoringContextFixture[] = [
    {
        id: 'link destination',
        markdown: '[label](https://example.test/path)\n',
        selected: 'example.test',
    },
    {
        id: 'link title',
        markdown: '[label](https://example.test "Review title")\n',
        selected: 'Review title',
    },
    {
        id: 'reference definition',
        markdown: 'See [label][ref].\n\n[ref]: https://example.test/path "Title"\n',
        selected: 'example.test',
    },
    {
        id: 'inline math',
        markdown: 'before $x + y$ after\n',
        selected: 'x + y',
    },
    {
        id: 'block math',
        markdown: '$$\nx + y\n$$\n',
        selected: 'x + y',
    },
    {
        id: 'inline raw HTML attribute',
        markdown: '<span data-review="pending">text</span>\n',
        selected: 'pending',
    },
    {
        id: 'raw HTML block',
        markdown: '<div data-review="pending">\ntext\n</div>\n',
        selected: 'pending',
    },
    {
        id: 'inline code',
        markdown: '`inline code`\n',
        selected: 'inline code',
    },
    {
        id: 'fenced code',
        markdown: '```md\nfenced code\n```\n',
        selected: 'fenced code',
    },
    {
        id: 'indented code',
        markdown: '    indented code\n',
        selected: 'indented code',
    },
    {
        id: 'image destination',
        markdown: '![alternative](https://example.test/image.png "Title")\n',
        selected: 'image.png',
    },
    {
        id: 'angle-bracket autolink',
        markdown: '<https://example.test/path>\n',
        selected: 'example.test',
    },
    {
        id: 'bare GFM autolink',
        markdown: 'https://example.test/path\n',
        selected: 'example.test',
    },
    {
        id: 'subscript',
        markdown: 'H ~subscript~ O\n',
        selected: 'subscript',
    },
    {
        id: 'superscript',
        markdown: 'x^superscript^\n',
        selected: 'superscript',
    },
];

const editors: MuyaInstance[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string): MuyaInstance {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);

    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);

    return muya;
}

function selectCanonicalSubstring(
    muya: MuyaInstance,
    source: string,
    selected: string,
): void {
    const sourceStart = source.indexOf(selected);
    if (sourceStart === -1) {
        throw new Error(
            `Expected canonical Markdown to contain selection ${JSON.stringify(selected)}.`,
        );
    }

    const model = muya.editor.criticMarkupDocument.get();
    const anchor = model.localPositionAt(sourceOffset(sourceStart));
    const focus = model.localPositionAt(
        sourceOffset(sourceStart + selected.length),
    );
    let anchorBlock = anchor
        ? muya.editor.scrollPage?.queryBlock([...anchor.path])
        : null;
    let focusBlock = focus
        ? muya.editor.scrollPage?.queryBlock([...focus.path])
        : null;
    let anchorOffset: number | undefined = anchor?.offset;
    let focusOffset: number | undefined = focus?.offset;

    // Code, math, and raw-HTML block serializers intentionally have no
    // identity source spans. They still expose a real editable content block,
    // and the public authoring command must fail closed for that live
    // selection because it cannot prove canonical eligibility.
    if (
        !anchor
        || !focus
        || !anchorBlock?.isContent()
        || !focusBlock?.isContent()
    ) {
        let candidate = muya.editor.scrollPage?.firstContentInDescendant();
        while (candidate) {
            const localStart = candidate.text.indexOf(selected);
            if (localStart !== -1) {
                anchorBlock = candidate;
                focusBlock = candidate;
                anchorOffset = localStart;
                focusOffset = localStart + selected.length;
                break;
            }
            candidate = candidate.nextContentInContext() ?? null;
        }
    }
    if (
        !anchorBlock?.isContent()
        || !focusBlock?.isContent()
        || anchorOffset === undefined
        || focusOffset === undefined
    ) {
        throw new Error('Literal context exposes no selectable live content.');
    }

    muya.editor.selection.setSelection(
        {
            offset: anchorOffset,
            block: anchorBlock,
            path: anchorBlock.path,
        },
        {
            offset: focusOffset,
            block: focusBlock,
            path: focusBlock.path,
        },
    );

    // Destinations, titles, definitions, and image source syntax are hidden in
    // the WYSIWYG DOM. Model a menu command after blur so the public command
    // consumes the exact cached canonical endpoints instead of a clamped DOM
    // selection.
    document.getSelection()?.removeAllRanges();
}

describe('criticMarkup authoring canonical literal contexts', () => {
    it.each(AUTHORING_LITERAL_CONTEXTS)(
        'rejects authoring in $id without publishing any mutation',
        ({ markdown, selected }) => {
            const muya = boot(markdown);
            const beforeMarkdown = muya.getMarkdown();
            selectCanonicalSubstring(muya, beforeMarkdown, selected);
            const beforeState = muya.getState();
            const beforeHistory = muya.getHistory();
            const emit = vi.spyOn(muya.eventCenter, 'emit');

            expect(muya.canCreateCriticMarkup('deletion')).toBe(false);
            expect(muya.createCriticMarkup({ type: 'deletion' })).toBe(false);

            expect(muya.getMarkdown()).toBe(beforeMarkdown);
            expect(muya.getState()).toEqual(beforeState);
            expect(muya.getHistory()).toEqual(beforeHistory);
            expect(emit).not.toHaveBeenCalled();
        },
    );

    it('allows authoring in parser-visible image alternative text', () => {
        const markdown = '![alternative](https://example.test/image.png)\n';
        const muya = boot(markdown);
        selectCanonicalSubstring(muya, markdown, 'alternative');

        expect(muya.canCreateCriticMarkup('deletion')).toBe(true);
        expect(muya.createCriticMarkup({ type: 'deletion' })).toBe(true);
        expect(muya.getMarkdown()).toBe(
            '![{--alternative--}](https://example.test/image.png)\n',
        );
    });
});

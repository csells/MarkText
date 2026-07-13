// @vitest-environment happy-dom

import type { Muya as MuyaInstance } from '../../muya';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

interface IMarkdownContextTransition {
    id: string;
    before: string;
    after: string;
}

const MARKDOWN_CONTEXT_TRANSITIONS: readonly IMarkdownContextTransition[] = [
    {
        id: 'creates inline code',
        before: 'placeholder',
        after: '`{++literal++}`',
    },
    {
        id: 'destroys inline code',
        before: '`\\{++literal++}`',
        after: '\\{++literal++}',
    },
    {
        id: 'creates a link destination',
        before: 'placeholder',
        after: '[label](https://example.test/{++literal++})',
    },
    {
        id: 'destroys a link destination',
        before: '[label](https://example.test/\\{++literal++})',
        after: '\\{++literal++}',
    },
    {
        id: 'creates inline math',
        before: 'placeholder',
        after: '$x + {++literal++}$',
    },
    {
        id: 'destroys inline math',
        before: '$x + \\{++literal++}$',
        after: 'x + \\{++literal++}',
    },
    {
        id: 'creates inline raw HTML',
        before: 'placeholder',
        after: 'text <span data-review="{++literal++}">value</span>',
    },
    {
        id: 'destroys inline raw HTML',
        before: 'text <span data-review="\\{++literal++}">value</span>',
        after: 'text \\{++literal++} value',
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

function boot(markdown: string, trackChanges = false): MuyaInstance {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);

    const muya = new Muya(host, {
        markdown: `${markdown}\n`,
        criticMarkupTrackChanges: trackChanges,
    });
    muya.init();
    editors.push(muya);

    return muya;
}

function canonical(markdown: string): string {
    return boot(markdown).getMarkdown();
}

describe('tracked CriticMarkup Markdown-context transitions', () => {
    it.each(MARKDOWN_CONTEXT_TRANSITIONS)(
        '$id against fresh canonical before and after documents',
        ({ before, after }) => {
            const expectedAfter = canonical(after);
            const muya = boot(before, true);
            const beforeMarkdown = muya.getMarkdown();
            const block = muya.editor.scrollPage!.firstContentInDescendant()!;
            block.setCursor(0, 0, true);
            const beforeHistoryLength = muya.getHistory().stack.undo.length;
            const changes = vi.fn();
            const rejected = vi.fn();
            muya.on('json-change', changes);
            muya.on('critic-markup-track-change-rejected', rejected);

            const result = muya.editor.mutationGateway.run(
                { kind: 'user-command' },
                () => {
                    block.text = after;
                    block.update();
                },
                {
                    path: block.path,
                    start: 0,
                    end: block.text.length,
                    inserted: after,
                },
            );

            expect(
                result,
                `rejections: ${JSON.stringify(rejected.mock.calls)}`,
            ).toBe('tracked');
            const trackedDocument = muya.editor.criticMarkupDocument.get();
            expect(trackedDocument.project('original')).toBe(beforeMarkdown);
            expect(trackedDocument.project('revised')).toBe(expectedAfter);
            expect(muya.getHistory().stack.undo)
                .toHaveLength(beforeHistoryLength + 1);
            expect(changes).toHaveBeenCalledTimes(1);
            expect(rejected).not.toHaveBeenCalled();
        },
    );
});

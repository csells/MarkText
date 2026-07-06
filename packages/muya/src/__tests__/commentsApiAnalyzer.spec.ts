// @vitest-environment happy-dom

import type * as Comments from '../comments';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../comments', async (importOriginal) => {
    const actual = await importOriginal<typeof Comments>();
    return {
        ...actual,
        analyzeMarkdownComments: vi.fn(actual.analyzeMarkdownComments),
    };
});

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

function metadata(data: Record<string, unknown>) {
    return `data:application/json;base64,${Buffer.from(JSON.stringify(data)).toString('base64')}`;
}

describe('muya comment API analyzer wiring', () => {
    it('derives public comments through the authoritative analyzer', async () => {
        const comments = await import('../comments');
        const { Muya } = await import('../muya');
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, {
            markdown: [
                'A <!--MC:a-->reviewed<!--MC:~a--> span.',
                '',
                `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
                '',
            ].join('\n'),
        } as ConstructorParameters<typeof Muya>[1]);
        muya.init();
        hosts.push(muya.domNode);

        vi.mocked(comments.analyzeMarkdownComments).mockClear();

        expect(muya.getComments().ranges).toEqual([
            expect.objectContaining({ id: 'a', preview: 'reviewed' }),
        ]);
        expect(vi.mocked(comments.analyzeMarkdownComments)).toHaveBeenCalled();
    });

    it('derives visible comment highlights through the authoritative analyzer', async () => {
        const comments = await import('../comments');
        const { Muya } = await import('../muya');
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, { markdown: 'No comments.\n' } as ConstructorParameters<typeof Muya>[1]);
        muya.init();
        hosts.push(muya.domNode);

        vi.mocked(comments.analyzeMarkdownComments).mockClear();

        muya.setContent([
            'A <!--MC:b-->highlighted<!--MC:~b--> span.',
            '',
            `[MC:b]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n'));

        const highlight = muya.domNode.querySelector<HTMLElement>('.mu-comment-highlight');
        expect(highlight?.textContent).toBe('highlighted');
        expect(vi.mocked(comments.analyzeMarkdownComments)).toHaveBeenCalled();
    });
});

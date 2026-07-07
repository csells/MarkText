// @vitest-environment happy-dom

import type * as CommentsModel from '../comments/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The facade imports the model module directly, so the spy must live on
// '../comments/model' (the barrel re-export would not intercept it).
vi.mock('../comments/model', async (importOriginal) => {
    const actual = await importOriginal<typeof CommentsModel>();
    return {
        ...actual,
        commentModelView: vi.fn(actual.commentModelView),
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

const DOC = [
    'A <!--MC:a-->reviewed<!--MC:~a--> span.',
    '',
    '[MC:a]: {"version":2,"status":"open"}',
    '',
].join('\n');

describe('muya comment API model-view wiring', () => {
    it('derives public comments through the model view, cached per version', async () => {
        const model = await import('../comments/model');
        const { Muya } = await import('../muya');
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, { markdown: DOC } as ConstructorParameters<typeof Muya>[1]);
        muya.init();
        hosts.push(muya.domNode);

        // Init renders highlights, which already derived the view; a
        // same-version read must serve the cache without re-deriving.
        expect(vi.mocked(model.commentModelView)).toHaveBeenCalled();
        vi.mocked(model.commentModelView).mockClear();

        expect(muya.getComments().ranges).toEqual([
            expect.objectContaining({ id: 'a', preview: 'reviewed' }),
        ]);
        expect(vi.mocked(model.commentModelView)).not.toHaveBeenCalled();
    });

    it('derives visible comment highlights through the same model view', async () => {
        const model = await import('../comments/model');
        const { Muya } = await import('../muya');
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, { markdown: 'No comments.\n' } as ConstructorParameters<typeof Muya>[1]);
        muya.init();
        hosts.push(muya.domNode);

        vi.mocked(model.commentModelView).mockClear();

        muya.setContent([
            'A <!--MC:b-->highlighted<!--MC:~b--> span.',
            '',
            '[MC:b]: {"version":2,"status":"open"}',
            '',
        ].join('\n'));

        const highlight = muya.domNode.querySelector<HTMLElement>('.mu-comment-highlight');
        expect(highlight).not.toBeNull();
        expect(highlight?.textContent).toBe('highlighted');
        expect(vi.mocked(model.commentModelView)).toHaveBeenCalled();
    });
});

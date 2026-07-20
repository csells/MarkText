// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../muya';

const editors: Muya[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

function boot(markdown: string, owner: Document = document): Muya {
    const host = owner.createElement('div');
    owner.body.appendChild(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

function hit(element: Element): void {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(element);
}

describe('muya CriticMarkup comment point hit-test', () => {
    it('returns the one parser-owned comment from its hidden body or visible anchor', () => {
        const muya = boot('{==anchored words==}{>>review note<<}\n');
        const comment = muya.getCriticMarkupReviewSnapshot().items[0];
        const commentBody = muya.domNode.querySelector<HTMLElement>('[data-critic-type="comment"]')!;
        const anchor = muya.domNode.querySelector<HTMLElement>('[data-critic-type="highlight"]')!;

        hit(commentBody);
        expect(muya.getCriticMarkupCommentAtPoint(41, 73)).toEqual(comment);

        hit(anchor);
        expect(muya.getCriticMarkupCommentAtPoint(41, 73)).toEqual(comment);
    });

    it('returns the deepest nested comment carried by structural DOM identity', () => {
        const muya = boot('{>>outer {>>inner<<} tail<<}\n');
        const comments = muya.getCriticMarkupReviewSnapshot().items;
        const [outer, inner] = comments;
        const carrier = document.createElement('span');
        carrier.setAttribute(
            'data-critic-structural-id',
            `${outer.id} ${inner.id}`,
        );
        muya.domNode.appendChild(carrier);

        hit(carrier);
        expect(muya.getCriticMarkupCommentAtPoint(5, 9)).toEqual(inner);
    });

    it('finds the containing comment anchor through a nested non-comment mark', () => {
        const muya = boot(
            '{==prefix {++nested++} suffix==}{>>review note<<}\n',
        );
        const comment = muya.getCriticMarkupReviewSnapshot().items.find(
            item => item.type === 'comment',
        );
        const nestedAddition = muya.domNode.querySelector<HTMLElement>(
            '[data-critic-type="addition"]',
        )!;

        hit(nestedAddition);
        expect(muya.getCriticMarkupCommentAtPoint(23, 31)).toEqual(comment);
    });

    it('fails closed outside marked editor-owned DOM', () => {
        const muya = boot('{>>review note<<}\n');
        const outside = document.createElement('span');
        outside.dataset.criticId = muya.getCriticMarkupReviewSnapshot().items[0].id;
        document.body.appendChild(outside);

        hit(outside);
        expect(muya.getCriticMarkupCommentAtPoint(1, 2)).toBeNull();

        muya.setOptions({ criticMarkupProjection: 'revised' }, true);
        hit(muya.domNode);
        expect(muya.getCriticMarkupCommentAtPoint(1, 2)).toBeNull();
    });

    it('hit-tests through the document that owns the editor root', () => {
        const owner = document.implementation.createHTMLDocument('embedded');
        const muya = boot('{>>review note<<}\n', owner);
        const comment = muya.getCriticMarkupReviewSnapshot().items[0];
        const indicator = muya.domNode.querySelector<HTMLElement>(
            '.mu-critic-comment-indicator',
        )!;
        const globalHit = vi.spyOn(document, 'elementFromPoint')
            .mockReturnValue(null);
        const ownerHit = vi.spyOn(owner, 'elementFromPoint')
            .mockReturnValue(indicator);

        expect(muya.domNode.ownerDocument).toBe(owner);
        expect(muya.getCriticMarkupCommentAtPoint(17, 29)).toEqual(comment);
        expect(ownerHit).toHaveBeenCalledWith(17, 29);
        expect(globalHit).not.toHaveBeenCalled();
    });

    it('does not inherit Critic identity from an ancestor outside the editor root', () => {
        const muya = boot('ordinary text {>>review note<<}\n');
        const comment = muya.getCriticMarkupReviewSnapshot().items[0];
        const outer = document.createElement('div');
        outer.dataset.criticId = comment.id;
        muya.domNode.parentElement!.replaceWith(outer);
        outer.appendChild(muya.domNode.parentElement ?? muya.domNode);
        const ordinaryText = muya.domNode.querySelector<HTMLElement>('[contenteditable]')
            ?? muya.domNode;

        hit(ordinaryText);
        expect(muya.getCriticMarkupCommentAtPoint(8, 13)).toBeNull();
    });

    it('rejects stale DOM identity instead of editing a guessed item', () => {
        const muya = boot('{>>review note<<}\n');
        const stale = document.createElement('span');
        stale.dataset.criticId = 'critic-stale-revision';
        muya.domNode.appendChild(stale);
        hit(stale);

        expect(() => muya.getCriticMarkupCommentAtPoint(3, 4))
            .toThrow(/stale for this revision/);
    });
});

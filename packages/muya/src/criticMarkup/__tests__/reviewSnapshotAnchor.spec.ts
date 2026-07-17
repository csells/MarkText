import type { ICriticMarkupItem } from '../commands';
import type { ICriticMarkupCommandState } from '../reviewContract';
import { describe, expect, it } from 'vitest';
import { createCriticMarkupReviewSnapshot } from '../reviewSnapshot';

const commandState: ICriticMarkupCommandState = {
    canCreateAddition: false,
    canCreateDeletion: false,
    canCreateSubstitution: false,
    canCreateHighlight: false,
    canCreateComment: false,
    canResolveCurrent: false,
    canResolveAll: false,
    trackChanges: false,
    projection: 'marked',
};

function item(partial: Partial<ICriticMarkupItem>): ICriticMarkupItem {
    return {
        id: 'x',
        type: 'comment',
        path: [0, 'text'],
        start: 0,
        end: 0,
        sourceStart: 0,
        sourceEnd: 0,
        raw: '',
        fragments: [],
        ...partial,
    } as ICriticMarkupItem;
}

describe('review snapshot anchor subsumption', () => {
    it('folds a comment\'s anchor highlight into a single comment item', () => {
        // {==reviewed==}{>>a note<<} — the highlight ends exactly where the
        // comment begins (gapless), so the highlight is the comment's anchor.
        const highlight = item({
            id: 'h1',
            type: 'highlight',
            sourceStart: 0,
            sourceEnd: 13,
            content: 'reviewed',
            raw: '{==reviewed==}',
        });
        const comment = item({
            id: 'c1',
            type: 'comment',
            sourceStart: 13,
            sourceEnd: 25,
            content: 'a note',
            raw: '{>>a note<<}',
        });

        const snapshot = createCriticMarkupReviewSnapshot(
            [highlight, comment],
            null,
            commandState,
        );

        expect(snapshot.items).toHaveLength(1);
        expect(snapshot.items[0].id).toBe('c1');
        expect(snapshot.items[0].type).toBe('comment');
        expect(snapshot.items[0].anchorId).toBe('h1');
        expect(snapshot.items[0].anchorText).toBe('reviewed');
    });

    it('keeps a plain highlight (no following comment) as its own item', () => {
        const highlight = item({
            id: 'h1',
            type: 'highlight',
            sourceStart: 0,
            sourceEnd: 10,
            content: 'plain',
            raw: '{==plain==}',
        });

        const snapshot = createCriticMarkupReviewSnapshot(
            [highlight],
            null,
            commandState,
        );

        expect(snapshot.items).toHaveLength(1);
        expect(snapshot.items[0].id).toBe('h1');
        expect(snapshot.items[0].type).toBe('highlight');
        expect(snapshot.items[0].anchorId).toBeUndefined();
    });

    it('surfaces a caret in the anchor as its comment (current-item remap)', () => {
        const highlight = item({
            id: 'h1',
            type: 'highlight',
            sourceStart: 0,
            sourceEnd: 13,
            content: 'reviewed',
            raw: '{==reviewed==}',
        });
        const comment = item({
            id: 'c1',
            type: 'comment',
            sourceStart: 13,
            sourceEnd: 25,
            content: 'a note',
            raw: '{>>a note<<}',
        });

        // The caret sits in the anchor highlight, but the comment card is the
        // one the sidebar should mark active.
        const snapshot = createCriticMarkupReviewSnapshot(
            [highlight, comment],
            highlight,
            commandState,
        );

        expect(snapshot.currentItemId).toBe('c1');
    });

    it('leaves a highlight separated from a comment by a gap as its own item', () => {
        // A space between them means it is not an anchor pair.
        const highlight = item({
            id: 'h1',
            type: 'highlight',
            sourceStart: 0,
            sourceEnd: 10,
            content: 'plain',
            raw: '{==plain==}',
        });
        const comment = item({
            id: 'c1',
            type: 'comment',
            sourceStart: 11,
            sourceEnd: 23,
            content: 'a note',
            raw: '{>>a note<<}',
        });

        const snapshot = createCriticMarkupReviewSnapshot(
            [highlight, comment],
            null,
            commandState,
        );

        expect(snapshot.items).toHaveLength(2);
        expect(snapshot.items[1].anchorId).toBeUndefined();
    });
});

// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

const editors: Muya[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

describe('critic markup comment edit', () => {
    it('exposes decoded semantic comment text while retaining raw identity', () => {
        const source = `${String.raw`{>>literal <<\} closer<<}`}\n`;
        const muya = boot(source);
        const [comment] = muya.getCriticMarkupReviewSnapshot().items;

        expect(comment.content).toBe('literal <<} closer');
        expect(comment.raw).toBe(String.raw`{>>literal <<\} closer<<}`);
        expect(document.querySelector('.mu-critic-comment-indicator')
            ?.getAttribute('title')).toBe('literal <<} closer');
        const historyDepth = muya.getHistory().stack.undo.length;

        expect(muya.editCriticMarkupComment(comment, comment.content!))
            .toBe(true);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getHistory().stack.undo).toHaveLength(historyDepth);
    });

    it.each([
        [
            String.raw`{++literal ++\} closer++}`,
            { type: 'addition', content: 'literal ++} closer' },
        ],
        [
            String.raw`{--literal --\} closer--}`,
            { type: 'deletion', content: 'literal --} closer' },
        ],
        [
            String.raw`{==literal ==\} closer==}`,
            { type: 'highlight', content: 'literal ==} closer' },
        ],
        [
            String.raw`{~~old \~> literal~>new ~~\} closer~~}`,
            {
                type: 'substitution',
                oldContent: 'old ~> literal',
                newContent: 'new ~~} closer',
            },
        ],
    ])('exposes semantic payloads for %s', (raw, expected) => {
        const muya = boot(`${raw}\n`);
        const [item] = muya.getCriticMarkupReviewSnapshot().items;

        expect(item).toMatchObject({ raw, ...expected });
        expect(muya.getMarkdown()).toBe(`${raw}\n`);
    });

    it('does not decode Critic-looking escapes inside Markdown literals', () => {
        const encodedClose = String.raw`<<\}`;
        const source = `{>>code \`${encodedClose}\` and prose ${encodedClose}<<}\n`;
        const muya = boot(source);
        const [comment] = muya.getCriticMarkupReviewSnapshot().items;

        expect(comment.content)
            .toBe(`code \`${encodedClose}\` and prose <<}`);
        expect(muya.getMarkdown()).toBe(source);
    });

    it('keeps an unchanged Markdown literal byte-exact when diff alignment splits it', () => {
        const literal = `\`${String.raw`<<\}`}\``;
        const source = `{>>${literal}<<<<}\n`;
        const muya = boot(source);
        const [comment] = muya.getCriticMarkupReviewSnapshot().items;
        const edited = `a${literal}\`<<`;

        expect(comment.content).toBe(`${literal}<<`);
        expect(muya.editCriticMarkupComment(comment, edited)).toBe(true);

        expect(muya.getMarkdown()).toBe(`{>>${edited}<<}\n`);
    });

    it.each([
        {
            kind: 'nested review item',
            source: '{>>outer {>>inner<<} tail<<}\n',
            current: 'outer {>>inner<<} tail',
            edited: 'outer {>>inner<<} {>>inner<<} tail',
        },
        (() => {
            const literal = `\`${String.raw`<<\}`}\``;
            return {
                kind: 'Markdown literal',
                source: `{>>outer ${literal} tail<<}\n`,
                current: `outer ${literal} tail`,
                edited: `outer ${literal} ${literal} tail`,
            };
        })(),
    ])('rejects duplicating an unchanged parser-owned $kind', ({
        source,
        current,
        edited,
    }) => {
        const muya = boot(source);
        const before = muya.getCriticMarkupItems();
        const outer = before.find(item =>
            item.type === 'comment' && item.content === current);
        expect(outer).toBeDefined();

        expect(muya.editCriticMarkupComment(outer!, edited)).toBe(false);

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getCriticMarkupItems().map(item => item.id))
            .toEqual(before.map(item => item.id));
    });

    it('rewrites a comment\'s text in place, keeping its anchor', () => {
        const source = 'a {==reviewed==}{>>old note<<} b';
        const expected = 'a {==reviewed==}{>>new note<<} b';
        const muya = boot(source);
        const comment = muya.getCriticMarkupItems()
            .find(item => item.type === 'comment');
        expect(comment).toBeDefined();
        const historyDepth = muya.getHistory().stack.undo.length;

        expect(muya.editCriticMarkupComment(comment!, 'new note')).toBe(true);

        const md = muya.getMarkdown();
        // The anchor highlight is untouched; only the comment body changed.
        expect(md).toContain('{==reviewed==}');
        expect(md).toContain('{>>new note<<}');
        expect(md).not.toContain('old note');
        expect(md).toBe(expected);
        expect(muya.getHistory().stack.undo).toHaveLength(historyDepth + 1);
        muya.undo();
        expect(muya.getMarkdown()).toBe(source);
        muya.redo();
        expect(muya.getMarkdown()).toBe(expected);
    });

    it.each([
        {
            kind: 'empty imported comment',
            source: 'a{>><<}b\n',
            current: '',
            edited: 'new note',
            expected: 'a{>>new note<<}b\n',
        },
        {
            kind: 'nested inner comment',
            source: '{>>outer {>>inner<<} tail<<}\n',
            current: 'inner',
            edited: 'revised inner',
            expected: '{>>outer {>>revised inner<<} tail<<}\n',
        },
        {
            kind: 'block-spanning comment',
            source: 'a{>>old\n\nnote<<}b\n',
            current: 'old\n\nnote',
            edited: 'new\n\nnote',
            expected: 'a{>>new\n\nnote<<}b\n',
        },
    ])('edits a $kind through one direct Review command while Track Changes is enabled', ({
        source,
        current,
        edited,
        expected,
    }) => {
        const muya = boot(source);
        muya.setOptions({ criticMarkupTrackChanges: true });
        const comment = muya.getCriticMarkupItems().find(item =>
            item.type === 'comment' && item.content === current);
        expect(comment).toBeDefined();
        const historyDepth = muya.getHistory().stack.undo.length;

        expect(muya.editCriticMarkupComment(comment!, edited)).toBe(true);

        expect(muya.getMarkdown()).toBe(expected);
        expect(muya.getHistory().stack.undo).toHaveLength(historyDepth + 1);
        muya.undo();
        expect(muya.getMarkdown()).toBe(source);
        muya.redo();
        expect(muya.getMarkdown()).toBe(expected);
    });

    it('refuses to edit a non-comment item', () => {
        const muya = boot('a {==plain==} b');
        const highlight = muya.getCriticMarkupItems()
            .find(item => item.type === 'highlight');
        expect(highlight).toBeDefined();

        expect(muya.editCriticMarkupComment(highlight!, 'nope')).toBe(false);
        expect(muya.getMarkdown()).toContain('{==plain==}');
    });

    it('refuses to edit a comment to empty text', () => {
        const muya = boot('a {==reviewed==}{>>keep<<} b');
        const comment = muya.getCriticMarkupItems()
            .find(item => item.type === 'comment');
        const historyDepth = muya.getHistory().stack.undo.length;

        expect(muya.editCriticMarkupComment(comment!, '   ')).toBe(false);
        expect(muya.getMarkdown()).toContain('{>>keep<<}');
        expect(muya.getHistory().stack.undo).toHaveLength(historyDepth);
    });

    it('preserves intentional boundary whitespace in edited comment text', () => {
        const muya = boot('{>> old <<}\n');
        const comment = muya.getCriticMarkupItems()
            .find(item => item.type === 'comment');
        expect(comment).toBeDefined();

        expect(muya.editCriticMarkupComment(comment!, ' new ')).toBe(true);

        expect(muya.getMarkdown()).toBe('{>> new <<}\n');
    });

    it('serializes edited semantic closers without leaking their protective escape', () => {
        const muya = boot('{>>old<<}\n');
        const [comment] = muya.getCriticMarkupReviewSnapshot().items;

        expect(muya.editCriticMarkupComment(
            comment,
            'new <<} closer',
        )).toBe(true);

        expect(muya.getMarkdown())
            .toBe(`${String.raw`{>>new <<\} closer<<}`}\n`);
        expect(muya.getCriticMarkupReviewSnapshot().items[0].content)
            .toBe('new <<} closer');
    });

    it('keeps an unchanged parent comment and its nested items byte-identical', () => {
        const source = '{>>outer {>>inner<<} tail<<}\n';
        const muya = boot(source);
        const before = muya.getCriticMarkupItems();
        const outer = before.find(item =>
            item.type === 'comment' && item.content?.startsWith('outer '));
        expect(outer).toBeDefined();

        expect(muya.editCriticMarkupComment(outer!, outer!.content!)).toBe(true);

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getCriticMarkupItems().map(item => ({
            id: item.id,
            type: item.type,
        }))).toEqual(before.map(item => ({
            id: item.id,
            type: item.type,
        })));
    });

    it('keeps nested raw identity opaque while decoding the child payload', () => {
        const source
            = `${String.raw`{>>outer {>>inner <<\}<<} tail<<}`}\n`;
        const muya = boot(source);
        const comments = muya.getCriticMarkupReviewSnapshot().items.filter(item => item.type === 'comment');
        const outer = comments.find(item => item.content?.startsWith('outer '));
        const inner = comments.find(item => item !== outer);
        expect(outer?.content)
            .toBe(String.raw`outer {>>inner <<\}<<} tail`);
        expect(inner?.content).toBe('inner <<}');

        expect(muya.editCriticMarkupComment(outer!, outer!.content!))
            .toBe(true);
        expect(muya.getMarkdown()).toBe(source);
    });

    it('edits parent prose without flattening an unchanged nested item', () => {
        const muya = boot('{>>outer {>>inner<<} tail<<}\n');
        const outer = muya.getCriticMarkupItems().find(item =>
            item.type === 'comment' && item.content?.startsWith('outer '));
        expect(outer).toBeDefined();

        expect(muya.editCriticMarkupComment(
            outer!,
            'revised {>>inner<<} tail',
        )).toBe(true);

        expect(muya.getMarkdown())
            .toBe('{>>revised {>>inner<<} tail<<}\n');
        expect(muya.getCriticMarkupItems().map(item => ({
            type: item.type,
            content: item.content,
        }))).toEqual([
            { type: 'comment', content: 'revised {>>inner<<} tail' },
            { type: 'comment', content: 'inner' },
        ]);
    });

    it('rejects rewriting a nested item through its parent comment', () => {
        const source = '{>>outer {>>inner<<} tail<<}\n';
        const muya = boot(source);
        const before = muya.getCriticMarkupItems();
        const outer = before.find(item =>
            item.type === 'comment' && item.content?.startsWith('outer '));
        expect(outer).toBeDefined();

        expect(muya.editCriticMarkupComment(
            outer!,
            'outer {>>changed<<} tail',
        )).toBe(false);

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getCriticMarkupItems().map(item => item.id))
            .toEqual(before.map(item => item.id));
    });

    it('relocates the parser-owned child instead of a matching code literal', () => {
        const source
            = '{>>outer `{>>inner<<}` actual {>>inner<<}<<}\n';
        const muya = boot(source);
        const outer = muya.getCriticMarkupItems().find(item =>
            item.type === 'comment' && item.content?.startsWith('outer '));
        expect(outer).toBeDefined();
        expect(muya.getCriticMarkupItems().map(item => item.type))
            .toEqual(['comment', 'comment']);

        expect(muya.editCriticMarkupComment(
            outer!,
            'revised `{>>inner<<}` actual {>>inner<<}',
        )).toBe(true);

        expect(muya.getMarkdown())
            .toBe('{>>revised `{>>inner<<}` actual {>>inner<<}<<}\n');
        expect(muya.getCriticMarkupItems().map(item => item.type))
            .toEqual(['comment', 'comment']);
    });
});

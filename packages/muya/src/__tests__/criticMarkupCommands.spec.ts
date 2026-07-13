// @vitest-environment happy-dom

import type Format from '../block/base/format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../muya';
import {
    runDeferredDirectMutation,
    runUserCommand,
} from './helpers/mutation';

const hosts: HTMLElement[] = [];

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);

    const muya = new Muya(host, { markdown });
    muya.init();
    const block = muya.editor.scrollPage!.firstContentInDescendant() as Format;

    return { muya, block };
}

describe('muya criticMarkup authoring commands', () => {
    it('routes explicit authoring through the review-command mutation boundary', () => {
        const { muya, block } = boot('word\n');
        block.setCursor(0, 4, true);
        const run = vi.spyOn(muya.editor.mutationGateway, 'run');

        expect(muya.createCriticMarkup({ type: 'addition' })).toBe(true);

        expect(run).toHaveBeenCalledWith(
            { kind: 'review-command' },
            expect.any(Function),
        );
    });

    it.each([
        [{ type: 'addition' } as const, '{++word++}'],
        [{ type: 'deletion' } as const, '{--word--}'],
        [{ type: 'highlight' } as const, '{==word==}'],
        [
            { type: 'substitution', replacement: 'term' } as const,
            '{~~word~>term~~}',
        ],
        [
            { type: 'comment', comment: 'Clarify this.' } as const,
            '{==word==}{>>Clarify this.<<}',
        ],
    ])('authors $type through normal leaf text operations', (input, expected) => {
        const { muya, block } = boot('word\n');
        block.setCursor(0, 4, true);

        expect(muya.createCriticMarkup(input)).toBe(true);
        expect(muya.getMarkdown()).toBe(`${expected}\n`);
    });

    it('inserts an empty addition at a caret for immediate typing', () => {
        const { muya, block } = boot('word\n');
        block.setCursor(2, 2, true);

        expect(muya.createCriticMarkup({ type: 'addition' })).toBe(true);
        expect(muya.getMarkdown()).toBe('wo{++++}rd\n');
    });

    it('rejects authoring inside inline code', () => {
        const { muya, block } = boot('`code`\n');
        block.setCursor(2, 4, true);

        expect(muya.canCreateCriticMarkup('deletion')).toBe(false);
        expect(muya.createCriticMarkup({ type: 'deletion' })).toBe(false);
        expect(muya.getMarkdown()).toBe('`code`\n');
    });

    it('records one standalone undo and redo boundary', async () => {
        const { muya, block } = boot('word\n');
        block.setCursor(0, 4, true);
        muya.createCriticMarkup({ type: 'addition' });

        expect(muya.getMarkdown()).toBe('{++word++}\n');
        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe('word\n'));

        muya.redo();
        await vi.waitFor(() =>
            expect(muya.getMarkdown()).toBe('{++word++}\n'));
    });

    it('separates pending typing from the review command undo boundary', async () => {
        const { muya, block } = boot('word\n');
        runDeferredDirectMutation(muya, () => {
            block.text = 'word!';
        });
        block.setCursor(0, 4, true);

        muya.createCriticMarkup({ type: 'addition' });
        expect(muya.getMarkdown()).toBe('{++word++}!\n');

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe('word!\n'));
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        first.setCursor(0, 0, true);
        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe('word\n'));
    });

    it('uses cached selection endpoints after a menu-style blur', () => {
        const { muya, block } = boot('word\n');
        block.setCursor(0, 4, true);
        document.getSelection()?.removeAllRanges();

        expect(muya.createCriticMarkup({ type: 'highlight' })).toBe(true);
        expect(muya.getMarkdown()).toBe('{==word==}\n');
    });

    it('restores the full selected payload after protective escaping', () => {
        const { muya, block } = boot('a ++} b\n');
        block.setCursor(0, 7, true);

        expect(muya.createCriticMarkup({ type: 'addition' })).toBe(true);
        const source = String.raw`{++a ++\} b++}`;
        expect(muya.getMarkdown()).toBe(`${source}\n`);
        const selection = muya.editor.selection.getSelection()!;
        expect([
            selection.anchor.offset,
            selection.focus.offset,
        ].sort((left, right) => left - right)).toEqual([3, source.length - 3]);
    });

    it('restores the full replacement arm after protective escaping', () => {
        const { muya, block } = boot('old\n');
        block.setCursor(0, 3, true);

        expect(muya.createCriticMarkup({
            type: 'substitution',
            replacement: 'new ~> value',
        })).toBe(true);
        const token = muya.getCriticMarkupItems()[0];
        const selection = muya.editor.selection.getSelection()!;
        const offsets = [selection.anchor.offset, selection.focus.offset]
            .sort((left, right) => left - right);

        expect(token.raw).toBe(String.raw`{~~old~>new \~> value~~}`);
        expect(offsets).toEqual([8, token.raw.length - 3]);
    });

    it('authors one addition across paragraph and heading selections', async () => {
        const source = 'before one\n\n# two after\n';
        const { muya, block: first } = boot(source);
        const second = first.nextContentInContext() as Format;
        muya.editor.selection.setSelection(
            { offset: 7, block: first, path: first.path },
            { offset: 5, block: second, path: second.path },
        );

        expect(muya.canCreateCriticMarkup('addition')).toBe(true);
        expect(muya.createCriticMarkup({ type: 'addition' })).toBe(true);
        expect(muya.getMarkdown())
            .toBe('before {++one\n\n# two++} after\n');

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
    });

    it('authors one substitution across block structure', () => {
        const { muya, block: first } = boot('old one\n\n# old two\n');
        const second = first.nextContentInContext() as Format;
        muya.editor.selection.setSelection(
            { offset: 4, block: first, path: first.path },
            { offset: 9, block: second, path: second.path },
        );

        expect(muya.createCriticMarkup({
            type: 'substitution',
            replacement: 'replacement',
        })).toBe(true);
        expect(muya.getMarkdown())
            .toBe('old {~~one\n\n# old two~>replacement~~}\n');
    });
});

describe('muya criticMarkup resolution commands', () => {
    it('routes targeted resolution through the review-command mutation boundary', () => {
        const { muya } = boot('{++new++}\n');
        const target = muya.getCriticMarkupItems()[0];
        const run = vi.spyOn(muya.editor.mutationGateway, 'run');

        expect(muya.resolveCriticMarkup('accept', target)).toBe(true);

        expect(run).toHaveBeenCalledWith(
            { kind: 'review-command' },
            expect.any(Function),
        );
    });

    it('discovers and resolves one logical item spanning paragraph and heading blocks', async () => {
        const source = 'before {++one\n\n# two++} after\n';
        const { muya } = boot(source);
        const second = muya.editor.scrollPage!.firstContentInDescendant()!
            .nextContentInContext() as Format;
        second.setCursor(3, 3, true);

        expect(muya.getCriticMarkupItems()).toMatchObject([{
            type: 'addition',
            raw: '{++one\n\n# two++}',
            sourceStart: 7,
            sourceEnd: 23,
        }]);
        expect(muya.getCurrentCriticMarkupItem()?.raw)
            .toBe('{++one\n\n# two++}');
        expect(muya.resolveCriticMarkup('accept')).toBe(true);
        expect(muya.getMarkdown()).toBe('before one\n\n# two after\n');

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
    });

    it('rejects a block-spanning addition as one rebuild boundary', async () => {
        const source = 'before {++one\n\n# two++} after\n';
        const { muya } = boot(source);
        const second = muya.editor.scrollPage!.firstContentInDescendant()!
            .nextContentInContext() as Format;
        second.setCursor(3, 3, true);

        expect(muya.resolveCriticMarkup('reject')).toBe(true);
        expect(muya.getMarkdown()).toBe('before  after\n');

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
    });

    it.each([
        ['accept', 'new\n'],
        ['reject', 'old\n'],
    ] as const)('resolves the current substitution atomically with %s', (decision, expected) => {
        const { muya, block } = boot('{~~old~>new~~}\n');
        block.setCursor(5, 5, true);

        expect(muya.resolveCriticMarkup(decision)).toBe(true);
        expect(muya.getMarkdown()).toBe(expected);
    });

    it('rejects a stale exact target without mutating the document', () => {
        const { muya, block } = boot('{++new++}\n');
        const [target] = muya.getCriticMarkupItems();
        runUserCommand(muya, () => {
            block.text = `x${block.text}`;
        });
        block.setCursor(0, 0, true);

        expect(muya.resolveCriticMarkup('accept', target)).toBe(false);
        expect(muya.getMarkdown()).toBe('x{++new++}\n');
    });

    it('resolves all five forms across leaves but leaves code literal', () => {
        const source = [
            '{++new++} {--old--}',
            '',
            '{~~old~>new~~} {==focus==} {>>note<<}',
            '',
            '`{++inline++}`',
            '',
            '```md',
            '{--fenced--}',
            '```',
            '',
        ].join('\n');
        const { muya } = boot(source);

        expect(muya.resolveAllCriticMarkup('accept')).toBe(5);
        expect(muya.getMarkdown()).toContain('new \n\nnew focus ');
        expect(muya.getMarkdown()).toContain('`{++inline++}`');
        expect(muya.getMarkdown()).toContain('{--fenced--}');
    });

    it('bulk-resolves block-spanning and leaf items in one transaction', async () => {
        const source = '{++one\n\n# two++}\n\n{--three--}\n';
        const { muya } = boot(source);

        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe('one\n\n# two\n\n\n');
        expect(muya.resolveAllCriticMarkup('accept')).toBe(2);
        expect(muya.getMarkdown()).toBe('one\n\n# two\n');

        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        first.setCursor(0, 0, true);
        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
    });

    it('records bulk resolution as one undo boundary', async () => {
        const source = '{++one++}\n\n{--two--}\n';
        const { muya } = boot(source);

        expect(muya.editor.criticMarkupDocument.get().project('revised'))
            .toBe('one\n\n\n');
        expect(muya.resolveAllCriticMarkup('accept')).toBe(2);
        expect(muya.getMarkdown()).toBe('one\n');

        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        first.setCursor(0, 0, true);
        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
    });

    it('creates no history entry for a no-op bulk command', () => {
        const { muya } = boot('plain\n');
        const before = muya.getHistory().stack.undo.length;

        expect(muya.resolveAllCriticMarkup('accept')).toBe(0);
        expect(muya.getHistory().stack.undo).toHaveLength(before);
    });

    it('re-evaluates block syntax exposed by resolution', () => {
        const { muya, block } = boot('{--remove--}# heading\n');
        block.setCursor(2, 2, true);

        expect(muya.resolveCriticMarkup('accept')).toBe(true);
        expect(muya.getMarkdown()).toBe('# heading\n');
        expect(muya.editor.scrollPage!.children.head?.blockName)
            .toBe('atx-heading');
    });

    it('uses the context-aware native token for discovery and resolution', () => {
        const source = '{++before [x](https://example.test/++}) after++}\n';
        const { muya, block } = boot(source);
        block.setCursor(3, 3, true);

        expect(muya.getCriticMarkupItems()).toMatchObject([{
            type: 'addition',
            raw: source.trim(),
            start: 0,
            end: source.trim().length,
        }]);
        expect(muya.resolveCriticMarkup('accept')).toBe(true);
        expect(muya.getMarkdown())
            .toBe('before [x](https://example.test/++}) after\n');
    });

    it('matches bulk projection when one item contains opaque escape bytes', () => {
        const literalCode = '`++\\}`';
        const source = `a{++${literalCode}++}b\n`;
        const { muya } = boot(source);
        const [target] = muya.getCriticMarkupItems();
        const bulkProjection
            = muya.editor.criticMarkupDocument.get().project('revised');

        expect(bulkProjection).toBe(`a${literalCode}b\n`);
        expect(muya.resolveCriticMarkup('accept', target)).toBe(true);
        expect(muya.getMarkdown()).toBe(bulkProjection);
    });

    it('bulk-resolves context-aware native tokens without truncating them', () => {
        const source = '{++before <span data-value="++}">x</span> after++}\n';
        const { muya } = boot(source);

        expect(muya.resolveAllCriticMarkup('accept')).toBe(1);
        expect(muya.getMarkdown())
            .toBe('before <span data-value="++}">x</span> after\n');
    });
});

describe('muya criticMarkup navigation commands', () => {
    it('focuses an exact review item by its parser-native document id', () => {
        const source = 'before {++one\n\n# two++} after\n\n{--three--}\n';
        const { muya, block } = boot(source);
        block.setCursor(0, 0, true);
        const [target] = muya.getCriticMarkupItems();

        expect(muya.focusCriticMarkup(target.id)).toMatchObject({
            id: target.id,
            raw: '{++one\n\n# two++}',
        });
        expect(muya.getCurrentCriticMarkupItem()?.id).toBe(target.id);
        expect(muya.editor.selection.getSelection()?.anchor).toMatchObject({
            path: target.fragments[0].path,
            offset: 10,
        });
    });

    it('focuses an exact review item by its source-mapped target', () => {
        const { muya, block } = boot('{++one++}\n\nplain {--two--}\n');
        block.setCursor(0, 0, true);
        const target = muya.getCriticMarkupItems()[1];

        expect(muya.focusCriticMarkup(target)?.id).toBe(target.id);
        expect(muya.getCurrentCriticMarkupItem()?.id).toBe(target.id);
    });

    it('rejects focus in a clean projection without moving its selection', () => {
        const { muya } = boot('{++one++}\n');
        const [target] = muya.getCriticMarkupItems();
        muya.setOptions({ criticMarkupProjection: 'revised' }, true);
        const projectedBlock
            = muya.editor.scrollPage!.firstContentInDescendant() as Format;
        projectedBlock.setCursor(1, 1, true);
        const before = muya.editor.selection.getSelection();

        expect(muya.focusCriticMarkup(target.id)).toBeNull();
        expect(muya.editor.selection.getSelection()).toMatchObject({
            anchor: { path: before?.anchor.path, offset: before?.anchor.offset },
            focus: { path: before?.focus.path, offset: before?.focus.offset },
        });
    });

    it('moves through review items in document order and wraps', () => {
        const { muya, block } = boot('{++one++}\n\nplain {--two--}\n');
        block.setCursor(0, 0, true);

        expect(muya.getCurrentCriticMarkupItem()?.raw).toBe('{++one++}');
        expect(muya.navigateCriticMarkup('next')?.raw).toBe('{--two--}');
        expect(muya.getCurrentCriticMarkupItem()?.raw).toBe('{--two--}');
        expect(muya.navigateCriticMarkup('next')?.raw).toBe('{++one++}');
        expect(muya.navigateCriticMarkup('previous')?.raw).toBe('{--two--}');
    });

    it('starts with the next item after a plain-text caret', () => {
        const { muya, block } = boot('plain {++one++} then {--two--}\n');
        block.setCursor(0, 0, true);

        expect(muya.getCurrentCriticMarkupItem()).toBeNull();
        expect(muya.navigateCriticMarkup('next')?.raw).toBe('{++one++}');
    });

    it('returns null without moving the selection when no review item exists', () => {
        const { muya, block } = boot('plain\n');
        block.setCursor(2, 2, true);
        const before = muya.editor.selection.getSelection();

        expect(muya.navigateCriticMarkup('next')).toBeNull();
        expect(muya.getCurrentCriticMarkupItem()).toBeNull();
        expect(muya.editor.selection.getSelection()?.anchor.offset)
            .toBe(before?.anchor.offset);
    });
});

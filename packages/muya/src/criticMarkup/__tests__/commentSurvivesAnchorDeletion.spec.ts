// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const editors: Muya[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string, trackChanges = false): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, {
        markdown,
        criticMarkupTrackChanges: trackChanges,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    editors.push(muya);
    return muya;
}

function deleteVisibleRange(
    muya: Muya,
    start: number,
    end: number,
    expected: string,
): void {
    const block = muya.editor.scrollPage!.firstContentInDescendant()!;
    block.setCursor(start, end, true);

    const selection = document.getSelection();
    if (!selection || selection.rangeCount !== 1)
        throw new TypeError('Expected the visible anchor selection.');
    expect(selection.toString()).toBe(expected);

    selection.getRangeAt(0).deleteContents();
    block.domNode!.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: null,
        inputType: 'deleteContentBackward',
    }));
}

function expectNativeCaretOutsideHiddenComment(): void {
    const selection = document.getSelection();
    expect(selection?.isCollapsed).toBe(true);
    for (const node of [selection?.anchorNode, selection?.focusNode]) {
        expect(node).not.toBeNull();
        const element = node?.nodeType === Node.ELEMENT_NODE
            ? node as Element
            : node?.parentElement;
        expect(element?.closest([
            '.mu-critic-comment',
            '.mu-critic-comment-text',
            '.mu-critic-marker',
            '[hidden][data-critic-type~="comment"]',
        ].join(', '))).toBeNull();
    }
}

describe('comment survives anchor deletion', () => {
    it('keeps the comment when the user deletes its visible anchor', async () => {
        const source = '{==reviewed==}{>>note<<}\n';
        const muya = boot(source);
        deleteVisibleRange(muya, 3, 11, 'reviewed');

        expect(muya.getMarkdown()).toBe('{>>note<<}\n');
        expect(muya.getCriticMarkupReviewSnapshot().items).toMatchObject([{
            type: 'comment',
            content: 'note',
        }]);
        expectNativeCaretOutsideHiddenComment();

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
        muya.redo();
        await vi.waitFor(() =>
            expect(muya.getMarkdown()).toBe('{>>note<<}\n'));

        const [comment] = muya.getCriticMarkupReviewSnapshot().items;
        expect(muya.resolveCriticMarkup('accept', comment)).toBe(true);
        expect(muya.getMarkdown()).not.toContain('{>>');
    });

    it('leaves adjacent plain highlights and point comments untouched', () => {
        const source
            = '{==plain==} {==reviewed==}{>>note<<} {>>solo<<}\n';
        const muya = boot(source);

        deleteVisibleRange(muya, 15, 23, 'reviewed');

        expect(muya.getMarkdown())
            .toBe('{==plain==} {>>note<<} {>>solo<<}\n');
        const snapshot = muya.getCriticMarkupReviewSnapshot();
        expect(snapshot.items.map(item => item.type))
            .toEqual(['highlight', 'comment', 'comment']);
        const point = snapshot.items.find(item => item.content === 'note');
        expect(point).toBeDefined();
        expect(muya.resolveCriticMarkup('accept', point!)).toBe(true);
        expect(muya.getMarkdown()).toBe('{==plain==}  {>>solo<<}\n');
    });

    it('keeps a partially edited anchor paired until its payload is empty', () => {
        const source = '{==reviewed==}{>>note<<}\n';
        const muya = boot(source);

        deleteVisibleRange(muya, 5, 9, 'view');

        expect(muya.getMarkdown()).toBe('{==reed==}{>>note<<}\n');
        expect(muya.getCriticMarkupReviewSnapshot().items).toMatchObject([{
            type: 'comment',
            content: 'note',
            anchorText: 'reed',
        }]);
    });

    it('collapses a fully deleted cross-paragraph anchor to a point comment', async () => {
        const source = '{==one\n\ntwo==}{>>note<<}\n';
        const muya = boot(source);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;
        muya.editor.selection.setSelection(
            { offset: 3, block: first, path: first.path },
            { offset: 3, block: last, path: last.path },
        );
        const materializeDraft = vi.spyOn(
            muya.editor.jsonState,
            'getMappedMarkdownFromState',
        );

        muya.editor.clipboard.cutHandler();

        expect(materializeDraft).toHaveBeenCalledTimes(1);
        expect(muya.getMarkdown()).toBe('{>>note<<}\n');
        expect(muya.getCriticMarkupReviewSnapshot().items).toMatchObject([{
            type: 'comment',
            content: 'note',
        }]);
        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
        muya.redo();
        await vi.waitFor(() =>
            expect(muya.getMarkdown()).toBe('{>>note<<}\n'));
    });

    it('collapses multiple escaped Unicode anchors in one history boundary', async () => {
        const escapedPayload = String.raw`a ==\} 😀`;
        const source = [
            `{==${escapedPayload}==}{>>first<<}`,
            '',
            '{==two==}{>>second<<}',
            '',
        ].join('\n');
        const muya = boot(source);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;
        const materializeDraft = vi.spyOn(
            muya.editor.jsonState,
            'getMappedMarkdownFromState',
        );
        const historyDepth = muya.getHistory().stack.undo.length;

        muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                first.text = first.text.replace(escapedPayload, '');
                last.text = last.text.replace('two', '');
            },
        );

        expect(materializeDraft).toHaveBeenCalledTimes(1);
        expect(muya.getMarkdown()).toBe('{>>first<<}\n\n{>>second<<}\n');
        expect(muya.getHistory().stack.undo).toHaveLength(historyDepth + 1);
        expect(muya.getCriticMarkupReviewSnapshot().items).toMatchObject([
            { type: 'comment', content: 'first' },
            { type: 'comment', content: 'second' },
        ]);

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
        muya.redo();
        await vi.waitFor(() =>
            expect(muya.getMarkdown())
                .toBe('{>>first<<}\n\n{>>second<<}\n'));
    });

    it('preserves nested notes when their outer visible anchor is deleted', async () => {
        const source
            = '{==outer {==inner==}{>>inner note<<} tail==}{>>outer note<<}\n';
        const expected = '{>>inner note<<}{>>outer note<<}\n';
        const muya = boot(source);
        const historyDepth = muya.getHistory().stack.undo.length;
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;

        muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                block.text = block.text.replace(
                    'outer {==inner==}{>>inner note<<} tail',
                    '',
                );
            },
        );

        expect(muya.getMarkdown()).toBe(expected);
        expect(muya.getHistory().stack.undo).toHaveLength(historyDepth + 1);
        expect(muya.getCriticMarkupReviewSnapshot().items).toMatchObject([
            { type: 'comment', content: 'inner note' },
            { type: 'comment', content: 'outer note' },
        ]);
        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
        muya.redo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(expected));
    });

    it('does not re-anchor a point comment to a preceding highlight', () => {
        const source
            = '{==previous==}{==doomed==}{>>outer note<<}\n';
        const muya = boot(source);
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;

        muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                block.text = block.text.replace('doomed', '');
            },
        );

        expect(muya.getMarkdown())
            .toBe('{==previous==}{====}{>>outer note<<}\n');
        const items = muya.getCriticMarkupReviewSnapshot().items;
        expect(items).toMatchObject([
            { type: 'highlight', content: 'previous' },
            { type: 'comment', content: 'outer note' },
        ]);
        expect(items[1]).not.toHaveProperty('anchorId');
        expect(items[1]).not.toHaveProperty('anchorText');
        expect(muya.getCriticMarkupItems().some(item =>
            'contentIsEmpty' in item)).toBe(false);
    });

    it('normalizes an emptied anchor when the same command inserts after its comment', () => {
        const muya = boot('{==reviewed==}{>>note<<}\n');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;

        muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                block.text = block.text.replace('reviewed', '');
                block.text = `${block.text}x`;
            },
        );

        expect(muya.getMarkdown()).toBe('{>>note<<}x\n');
    });

    it('keeps the point comment when a tracked anchor deletion is accepted', async () => {
        const source = '{==reviewed==}{>>note<<}\n';
        const expected = '{>>note<<}\n';
        const muya = boot(source, true);

        deleteVisibleRange(muya, 3, 11, 'reviewed');
        const tracked = muya.getMarkdown();
        const deletion = muya.getCriticMarkupItems().find(item =>
            item.type === 'deletion');
        expect(deletion).toBeDefined();
        const historyDepth = muya.getHistory().stack.undo.length;

        expect(muya.resolveCriticMarkup('accept', deletion!)).toBe(true);
        expect(muya.getMarkdown()).toBe(expected);
        expect(muya.getHistory().stack.undo).toHaveLength(historyDepth + 1);
        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(tracked));
        muya.redo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(expected));
    });

    it('keeps nested point comments when tracked outer deletion is accepted', async () => {
        const source
            = '{==outer {==inner==}{>>inner note<<} tail==}{>>outer note<<}\n';
        const expected = '{>>inner note<<}{>>outer note<<}\n';
        const muya = boot(source, true);
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;

        muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                block.text = block.text.replace(
                    'outer {==inner==}{>>inner note<<} tail',
                    '',
                );
            },
        );
        const tracked = muya.getMarkdown();
        expect(tracked).toBe(
            '{=={--outer {==inner==}{>>inner note<<} tail--}==}'
            + '{>>outer note<<}\n',
        );
        const deletion = muya.getCriticMarkupItems().find(item =>
            item.type === 'deletion');
        expect(deletion).toBeDefined();

        expect(muya.resolveCriticMarkup('accept', deletion!)).toBe(true);
        expect(muya.getMarkdown()).toBe(expected);
        expect(muya.getCriticMarkupReviewSnapshot().items).toMatchObject([
            { type: 'comment', content: 'inner note' },
            { type: 'comment', content: 'outer note' },
        ]);
        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(tracked));
        muya.redo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(expected));
    });

    it('keeps a tracked point comment separate from a preceding highlight', () => {
        const source = '{==previous==}{==doomed==}{>>note<<}\n';
        const muya = boot(source, true);
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;

        muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                block.text = block.text.replace('doomed', '');
            },
        );
        const deletion = muya.getCriticMarkupItems().find(item =>
            item.type === 'deletion');
        expect(deletion).toBeDefined();

        expect(muya.resolveCriticMarkup('accept', deletion!)).toBe(true);
        expect(muya.getMarkdown())
            .toBe('{==previous==}{====}{>>note<<}\n');
        const items = muya.getCriticMarkupReviewSnapshot().items;
        expect(items).toMatchObject([
            { type: 'highlight', content: 'previous' },
            { type: 'comment', content: 'note' },
        ]);
        expect(items[1]).not.toHaveProperty('anchorId');
    });

    it('waits for the whole direct command before normalizing deleted anchors', async () => {
        const source = [
            '{==one==}{>>first<<}',
            '',
            '{==two==}{>>second<<}',
            '',
        ].join('\n');
        const muya = boot(source);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const last = muya.editor.scrollPage!.lastContentInDescendant()!;
        const materializeDraft = vi.spyOn(
            muya.editor.jsonState,
            'getMappedMarkdownFromState',
        );
        const historyDepth = muya.getHistory().stack.undo.length;
        let normalizationCountDuringCommand = -1;

        muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                first.text = first.text.replace('one', '');
                muya.editor.jsonState.getLiveState();
                normalizationCountDuringCommand = materializeDraft.mock.calls.length;
                last.text = last.text.replace('two', '');
            },
        );

        expect(normalizationCountDuringCommand).toBe(0);
        expect(materializeDraft).toHaveBeenCalledTimes(1);
        expect(muya.getMarkdown()).toBe('{>>first<<}\n\n{>>second<<}\n');
        expect(muya.getHistory().stack.undo).toHaveLength(historyDepth + 1);

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe(source));
        muya.redo();
        await vi.waitFor(() =>
            expect(muya.getMarkdown())
                .toBe('{>>first<<}\n\n{>>second<<}\n'));
    });

    it('a point comment (anchor text deleted) stays listed and removable', () => {
        // Deleting all of a comment's anchored text turns {==sel==}{>>note<<}
        // into a bare {>>note<<}. That comment must survive: still a review
        // item, still removable — the app never silently drops a comment.
        const muya = boot('a {>>note<<} b');
        const comment = muya.getCriticMarkupItems()
            .find(item => item.type === 'comment');
        expect(comment).toBeDefined();
        expect(comment!.content).toBe('note');

        expect(muya.resolveCriticMarkup('accept', comment)).toBe(true);
        expect(muya.getMarkdown()).not.toContain('{>>');
        expect(muya.getMarkdown()).toContain('a  b');
    });

    it('deleting the anchor text does not paired-remove the comment (resolve-only)', () => {
        // Paired removal fires only through resolve, never through ordinary
        // editing, so a bare {>>note<<} with no anchor resolves as itself.
        const muya = boot('{>>solo<<}');
        const comment = muya.getCriticMarkupItems()
            .find(item => item.type === 'comment');
        expect(comment).toBeDefined();
        expect(muya.resolveCriticMarkup('accept', comment)).toBe(true);
        expect(muya.getMarkdown()).not.toContain('solo');
    });
});

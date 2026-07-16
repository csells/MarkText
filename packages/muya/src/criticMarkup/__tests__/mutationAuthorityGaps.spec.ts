// @vitest-environment happy-dom

import type { JSONOpList } from 'ot-json1';
import * as json1 from 'ot-json1';
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

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);

    const muya = new Muya(host, { markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

function selectionSnapshot(muya: Muya) {
    const selection = muya.getSelection();
    if (!selection)
        return null;

    return {
        anchor: {
            offset: selection.anchor.offset,
            path: [...selection.anchor.path],
        },
        focus: {
            offset: selection.focus.offset,
            path: [...selection.focus.path],
        },
        direction: selection.direction,
        isCollapsed: selection.isCollapsed,
        isSelectionInSameBlock: selection.isSelectionInSameBlock,
        type: selection.type,
    };
}

function searchSnapshot(muya: Muya) {
    return {
        checkpoint: muya.editor.searchModule.checkpoint(),
        matches: muya.editor.searchModule.matches.map(match => ({
            start: match.start,
            end: match.end,
            match: match.match,
            path: [...match.block.path],
        })),
    };
}

function observableSnapshot(muya: Muya) {
    return {
        markdown: muya.getMarkdown(),
        state: muya.getState(),
        tree: muya.editor.getLiveBlockState(),
        history: muya.getHistory(),
        search: searchSnapshot(muya),
        selection: selectionSnapshot(muya),
    };
}

function replacementOperation(): JSONOpList {
    return json1.editOp(
        [0, 'text'],
        'text-unicode',
        [{ d: 'before' }, 'after'],
    )!;
}

function prepareObservableState(muya: Muya, markdown: string): void {
    expect(muya.replaceContent(markdown)).toBe(true);
    muya.search('TARGET', {
        isCaseSensitive: true,
        isWholeWord: true,
        isRegexp: false,
        highlightIndex: 0,
    });
    const match = muya.editor.searchModule.matches[0];
    if (!match)
        throw new Error('Expected the rollback fixture to contain TARGET.');
    muya.editor.activeContentBlock = match.block;
    match.block.setCursor(match.start + 1, match.start + 1, true);
}

function observePublications(muya: Muya) {
    const jsonChanges = vi.fn();
    const selectionChanges = vi.fn();
    const reviewChanges = vi.fn();
    muya.on('json-change', jsonChanges);
    muya.on('selection-change', selectionChanges);
    muya.on('critic-markup-review-change', reviewChanges);
    return { jsonChanges, selectionChanges, reviewChanges };
}

const PUBLIC_COMMIT_SURFACES: readonly {
    name: string;
    invoke: (muya: Muya, operation: JSONOpList) => unknown;
}[] = [
    {
        name: 'Editor.updateContents',
        invoke: (muya, operation) => muya.editor.updateContents(
            operation,
            selectionSnapshot(muya),
            'api',
        ),
    },
    {
        name: 'Editor.rebuildContents',
        invoke: (muya, operation) => muya.editor.rebuildContents(
            operation,
            selectionSnapshot(muya),
            'api',
        ),
    },
    {
        name: 'Editor.commitPendingContents',
        invoke: (muya, operation) =>
            muya.editor.commitPendingContents(operation, 'api'),
    },
    {
        name: 'JSONState.applySilently',
        invoke: (muya, operation) =>
            muya.editor.jsonState.applySilently(operation, 'api'),
    },
];

describe('mutation authority closure gaps', () => {
    it.each(PUBLIC_COMMIT_SURFACES)(
        '$name rejects a direct call outside gateway authority',
        ({ invoke }) => {
            const muya = boot('before\n');
            muya.search('before', {
                isCaseSensitive: true,
                isWholeWord: true,
                isRegexp: false,
                highlightIndex: 0,
            });
            const block = muya.editor.scrollPage!.firstContentInDescendant()!;
            muya.editor.activeContentBlock = block;
            block.setCursor(2, 2, true);
            const before = observableSnapshot(muya);
            const publications = observePublications(muya);

            let thrown: unknown;
            try {
                invoke(muya, replacementOperation());
            }
            catch (error) {
                thrown = error;
            }

            expect(thrown).toBeInstanceOf(TypeError);
            expect((thrown as Error | undefined)?.message)
                .toMatch(/mutation gateway/i);
            expect(observableSnapshot(muya)).toEqual(before);
            expect(publications.jsonChanges).not.toHaveBeenCalled();
            expect(publications.selectionChanges).not.toHaveBeenCalled();
            expect(publications.reviewChanges).not.toHaveBeenCalled();
        },
    );

    it('rolls back every observable when document reset rebuild fails', () => {
        const muya = boot('seed\n');
        prepareObservableState(muya, 'before TARGET\n');
        const before = observableSnapshot(muya);
        const publications = observePublications(muya);

        vi.spyOn(muya.editor.scrollPage!, 'updateState')
            .mockImplementationOnce(() => {
                throw new Error('injected document-reset rebuild failure');
            });

        expect(() => muya.setContent('after\n'))
            .toThrowError('injected document-reset rebuild failure');

        expect(observableSnapshot(muya)).toEqual(before);
        expect(publications.jsonChanges).not.toHaveBeenCalled();
        expect(publications.selectionChanges).not.toHaveBeenCalled();
        expect(publications.reviewChanges).not.toHaveBeenCalled();
    });

    it('rolls back every observable when parse-affecting option rebuild fails', () => {
        const muya = boot('seed\n');
        prepareObservableState(muya, [
            '---',
            'title: before',
            '---',
            '',
            'TARGET',
            '',
        ].join('\n'));
        const before = observableSnapshot(muya);
        const publications = observePublications(muya);

        vi.spyOn(muya.editor.scrollPage!, 'updateState')
            .mockImplementationOnce(() => {
                throw new Error('injected parse-option rebuild failure');
            });

        expect(() => muya.setOptions({ frontMatter: false }, true))
            .toThrowError('injected parse-option rebuild failure');

        expect(observableSnapshot(muya)).toEqual(before);
        expect(publications.jsonChanges).not.toHaveBeenCalled();
        expect(publications.selectionChanges).not.toHaveBeenCalled();
        expect(publications.reviewChanges).not.toHaveBeenCalled();
    });

    it('rolls back a failed parse-affecting transition under the previous option snapshot', () => {
        const muya = boot('keep {++new++} tail\n');
        // Cache the revision's parser artifact under the CURRENT profile so a
        // rollback that rebuilds under the prospective profile fails loudly.
        muya.getCriticMarkupReviewSnapshot();
        const before = observableSnapshot(muya);
        const previousSuperSubScript = muya.options.superSubScript;

        vi.spyOn(muya.editor.scrollPage!, 'updateState')
            .mockImplementationOnce(() => {
                throw new Error('injected prospective-profile rebuild failure');
            });

        // The original failure must surface unchanged: rollback runs under
        // the previous snapshot, so it must not independently fail (a
        // CollectedError here means rollback rebuilt under the prospective
        // options).
        expect(() => muya.setOptions(
            { superSubScript: !previousSuperSubScript },
            true,
        )).toThrowError('injected prospective-profile rebuild failure');

        expect(muya.options.superSubScript).toBe(previousSuperSubScript);
        expect(observableSnapshot(muya)).toEqual(before);
        expect(muya.getCriticMarkupReviewSnapshot().items).toHaveLength(1);
    });
});

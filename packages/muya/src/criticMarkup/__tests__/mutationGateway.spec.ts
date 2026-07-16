// @vitest-environment happy-dom

import type Parent from '../../block/base/parent';
import type Frontmatter from '../../block/extra/frontmatter';
import type Table from '../../block/gfm/table';
import type TaskListCheckbox from '../../block/gfm/taskListCheckbox';
import diff from 'fast-diff';
import * as json1 from 'ot-json1';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScrollPage } from '../../block/scrollPage';
import type Format from '../../block/base/format';
import { Muya } from '../../muya';
import { diffToTextOp } from '../../utils';

const editors: Muya[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(
    markdown: string,
    options: ConstructorParameters<typeof Muya>[1] = {},
): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);

    const muya = new Muya(host, { ...options, markdown });
    muya.init();
    editors.push(muya);
    return muya;
}

function placeCursor(muya: Muya, offset: number): void {
    const block = muya.editor.scrollPage!.firstContentInDescendant()!;
    muya.editor.activeContentBlock = block;
    block.setCursor(offset, offset, true);
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

function detachedParagraph(muya: Muya, text = 'detached'): Parent {
    return ScrollPage.loadBlock('paragraph').create(muya, {
        name: 'paragraph',
        text,
    });
}

function expectRejectedTreeMutation(
    muya: Muya,
    mutate: () => void,
): void {
    const beforeMarkdown = muya.getMarkdown();
    const beforeState = structuredClone(muya.getState());
    const beforeHistory = muya.getHistory();
    const beforeDom = muya.editor.scrollPage!.domNode!.innerHTML;
    const changes = vi.fn();
    muya.on('json-change', changes);

    expect(mutate).toThrowError(/mutation gateway/i);
    expect(muya.getMarkdown()).toBe(beforeMarkdown);
    expect(muya.getState()).toEqual(beforeState);
    expect(muya.getHistory()).toEqual(beforeHistory);
    expect(muya.editor.scrollPage!.domNode!.innerHTML).toBe(beforeDom);
    expect(changes).not.toHaveBeenCalled();
}

describe('criticMarkup mutation gateway', () => {
    it('rejects a low-level content mutation before the live tree can diverge', () => {
        const source = 'before\n';
        const muya = boot(source);
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const beforeHistory = muya.getHistory();
        const changes = vi.fn();
        muya.on('json-change', changes);

        let thrown: unknown;
        try {
            block.text = 'bypassed the gateway';
        }
        catch (error) {
            thrown = error;
        }
        const liveText = block.text;
        const markdown = muya.getMarkdown();
        const history = muya.getHistory();
        expect(thrown).toBeInstanceOf(TypeError);
        expect((thrown as Error).message).toMatch(/mutation gateway/i);
        expect(liveText).toBe('before');
        expect(markdown).toBe(source);
        expect(history).toEqual(beforeHistory);
        expect(changes).not.toHaveBeenCalled();
    });

    it('rejects api-tagged append and insertion on the attached tree', () => {
        const muya = boot('before\n');
        const scrollPage = muya.editor.scrollPage!;

        expectRejectedTreeMutation(
            muya,
            () => scrollPage.append(detachedParagraph(muya), 'api'),
        );
        expectRejectedTreeMutation(
            muya,
            () => scrollPage.insertBefore(
                detachedParagraph(muya),
                scrollPage.firstChild as Parent,
                'api',
            ),
        );
    });

    it('rejects moving an attached node into a detached parent', () => {
        const muya = boot('before\n');
        const live = muya.editor.scrollPage!.firstChild as Parent;

        expectRejectedTreeMutation(
            muya,
            () => detachedParagraph(muya).append(live, 'api'),
        );
        expectRejectedTreeMutation(
            muya,
            () => detachedParagraph(muya).insertBefore(live, null, 'api'),
        );
    });

    it('does not expose linked-list mutators through live child views', () => {
        const muya = boot('before\n');
        const { children } = muya.editor.scrollPage!;

        expect('append' in children).toBe(false);
        expect('insertBefore' in children).toBe(false);
        expect('remove' in children).toBe(false);
    });

    it('rejects direct parent reassignment on an attached node', () => {
        const muya = boot('before\n');
        const live = muya.editor.scrollPage!.firstChild as Parent;
        const detached = detachedParagraph(muya);

        expectRejectedTreeMutation(muya, () => {
            live.parent = detached;
        });
    });

    it('rejects direct sibling relinking on attached nodes', () => {
        const muya = boot('first\n\nsecond\n');
        const first = muya.editor.scrollPage!.firstChild as Parent;
        const second = first.next as Parent;

        expectRejectedTreeMutation(muya, () => {
            first.next = null;
        });
        expectRejectedTreeMutation(muya, () => {
            second.prev = null;
        });
    });

    it('rejects a public task-list checkbox update outside the gateway', () => {
        const muya = boot('- [ ] item\n');
        const list = muya.editor.scrollPage!.firstChild as Parent;
        const item = list.firstChild as Parent;
        const checkbox = item.attachments.head as TaskListCheckbox;

        expectRejectedTreeMutation(muya, () => checkbox.update(true));
    });

    it('does not expose task-list DOM synchronization as a mutation surface', () => {
        const muya = boot('- [ ] item\n');
        const list = muya.editor.scrollPage!.firstChild as Parent;
        const item = list.firstChild as Parent;
        const checkbox = item.attachments.head as TaskListCheckbox;

        expect('syncDom' in checkbox).toBe(false);
    });

    it('rejects table alignment before any live cell can diverge', () => {
        const muya = boot('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
        const table = muya.editor.scrollPage!.firstChild as Table;

        expectRejectedTreeMutation(
            muya,
            () => table.alignColumn(0, 'center'),
        );
    });

    it('does not expose mutable serialization metadata', () => {
        const muya = boot('| a |\n| --- |\n| 1 |\n');
        const table = muya.editor.scrollPage!.firstChild as Table;
        const inner = table.firstChild as Parent;
        const row = inner.firstChild as Parent;
        const cell = row.firstChild as { meta: { align: string } } & Parent;

        const beforeMarkdown = muya.getMarkdown();
        const beforeState = structuredClone(muya.getState());
        const beforeHistory = muya.getHistory();
        const beforeDom = muya.editor.scrollPage!.domNode!.innerHTML;
        const changes = vi.fn();
        muya.on('json-change', changes);

        expect(() => {
            cell.meta.align = 'center';
        }).toThrow(TypeError);
        expect(muya.getMarkdown()).toBe(beforeMarkdown);
        expect(muya.getState()).toEqual(beforeState);
        expect(muya.getHistory()).toEqual(beforeHistory);
        expect(muya.editor.scrollPage!.domNode!.innerHTML).toBe(beforeDom);
        expect(changes).not.toHaveBeenCalled();
    });

    it('rejects live frontmatter language writes outside the gateway', () => {
        const muya = boot('---\ntitle: x\n---\n\nbody\n');
        const frontmatter = muya.editor.scrollPage!.firstChild as Frontmatter;

        expectRejectedTreeMutation(muya, () => {
            frontmatter.lang = 'toml';
        });
    });

    it('rejects api-tagged removal and replacement on the attached tree', () => {
        const muya = boot('before\n');
        const scrollPage = muya.editor.scrollPage!;
        const live = scrollPage.firstChild as Parent;

        expectRejectedTreeMutation(muya, () => live.remove('api'));
        expectRejectedTreeMutation(
            muya,
            () => live.replaceWith(detachedParagraph(muya), 'api'),
        );
        expectRejectedTreeMutation(
            muya,
            () => live.firstContentInDescendant()!.remove('api'),
        );
    });

    it('commits a direct user command before the gateway returns', () => {
        const muya = boot('before\n');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const changes = vi.fn();
        muya.on('json-change', changes);

        const result = muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                block.text = 'after';
                block.update();
            },
        );
        const markdownOnReturn = muya.getMarkdown();
        const changesOnReturn = changes.mock.calls.length;
        // Clean up the baseline implementation's deferred batch before making
        // assertions, so the intentionally red test cannot leak a RAF.
        muya.flush();

        expect(result).toBe('untracked');
        expect(markdownOnReturn).toBe('after\n');
        expect(changesOnReturn).toBe(1);
    });

    it('does not lend mutation authority to post-commit observers', () => {
        const muya = boot('before\n');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        let observerInheritedAuthority: boolean | null = null;
        muya.on('json-change', () => {
            try {
                muya.editor.mutationGateway.assertActive('post-commit observer');
                observerInheritedAuthority = true;
            }
            catch {
                observerInheritedAuthority = false;
            }
        });

        muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                block.text = 'after';
                block.update();
            },
        );

        expect(observerInheritedAuthority).toBe(false);
        expect(muya.getMarkdown()).toBe('after\n');
    });

    it('routes document resets through the gateway and rejects direct state reset', () => {
        const muya = boot('before\n');
        const run = vi.spyOn(muya.editor.mutationGateway, 'run');

        muya.setContent('after\n');

        expect(run).toHaveBeenCalledWith(
            { kind: 'document-reset' },
            expect.any(Function),
        );
        expect(muya.getMarkdown()).toBe('after\n');
        expect(() => muya.editor.jsonState.setContent('bypass\n'))
            .toThrow(/mutation gateway/i);
        expect(muya.getMarkdown()).toBe('after\n');
    });

    it('restores a direct proposal when its mutation callback throws', () => {
        const source = 'before\n';
        const muya = boot(source);
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const beforeHistory = muya.getHistory();
        const changes = vi.fn();
        muya.on('json-change', changes);

        expect(() => muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                block.text = 'partially mutated';
                block.update();
                throw new Error('injected command failure');
            },
        )).toThrowError('injected command failure');

        const liveText = muya.editor.scrollPage!
            .firstContentInDescendant()!
            .text;
        const markdown = muya.getMarkdown();
        const history = muya.getHistory();
        const changeCount = changes.mock.calls.length;
        expect(liveText).toBe('before');
        expect(markdown).toBe(source);
        expect(history).toEqual(beforeHistory);
        expect(changeCount).toBe(0);
    });

    it('keeps a direct command undoable when a post-commit observer throws', () => {
        const muya = boot('before\n');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        const laterObserver = vi.fn();
        muya.eventCenter.once('json-change', () => {
            throw new Error('injected direct observer failure');
        });
        muya.on('json-change', laterObserver);

        expect(() => muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                block.text = 'after';
                block.update();
            },
        )).toThrowError('post-commit notification failed');

        expect(muya.getMarkdown()).toBe('after\n');
        expect(laterObserver).toHaveBeenCalledTimes(1);
        muya.undo();
        expect(muya.getMarkdown()).toBe('before\n');
    });

    it('routes a public document mutation to the read-only sink in a clean projection', () => {
        const source = '{++new++} {--old--}\n';
        const muya = boot(source);
        muya.setOptions({ criticMarkupProjection: 'revised' }, true);
        const history = muya.getHistory();
        const changes = vi.fn();
        muya.on('json-change', changes);

        expect(muya.replaceContent('silently mutated\n')).toBe(false);

        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getHistory()).toEqual(history);
        expect(changes).not.toHaveBeenCalled();
        expect(muya.domNode.textContent).toContain('new');
        expect(muya.domNode.textContent).not.toContain('silently mutated');
    });

    it('publishes nothing when a prepared tracked commit fails during rebuild', () => {
        const source = 'teh stays put\n';
        const muya = boot(source, { criticMarkupTrackChanges: true });
        placeCursor(muya, 1);

        const beforeState = muya.getState();
        const beforeHistory = muya.getHistory();
        const beforeSelection = selectionSnapshot(muya);
        const changes = vi.fn();
        muya.on('json-change', changes);

        vi.spyOn(muya.editor.scrollPage!, 'updateState')
            .mockImplementationOnce(() => {
                throw new Error('injected rebuild failure');
            });

        expect(() =>
            muya.replaceCurrentWordInlineUnsafe('teh', 'the'),
        ).toThrowError('injected rebuild failure');

        expect(muya.getState()).toEqual(beforeState);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getHistory()).toEqual(beforeHistory);
        expect(selectionSnapshot(muya)).toEqual(beforeSelection);
        expect(changes).not.toHaveBeenCalled();
    });

    it('rolls back an ordinary update when incremental apply and fallback rebuild fail', () => {
        const source = 'before\n';
        const muya = boot(source);
        const beforeState = muya.getState();
        const beforeHistory = muya.getHistory();
        const beforeSelection = selectionSnapshot(muya);
        const changes = vi.fn();
        muya.on('json-change', changes);
        const operation = json1.editOp(
            [0, 'text'],
            'text-unicode',
            diffToTextOp(diff('before', 'Before')),
        )!;

        vi.spyOn(muya.editor.scrollPage!, 'queryBlock')
            .mockImplementationOnce(() => {
                throw new Error('injected incremental failure');
            });
        vi.spyOn(muya.editor.scrollPage!, 'updateState')
            .mockImplementationOnce(() => {
                throw new Error('injected fallback rebuild failure');
            });

        expect(() => muya.editor.mutationGateway.run(
            { kind: 'history-command' },
            () => muya.editor.updateContents(
                operation,
                beforeSelection,
                'api',
            ),
        )).toThrowError('injected fallback rebuild failure');

        expect(muya.getState()).toEqual(beforeState);
        expect(muya.getMarkdown()).toBe(source);
        expect(muya.getHistory()).toEqual(beforeHistory);
        expect(selectionSnapshot(muya)).toEqual(beforeSelection);
        expect(changes).not.toHaveBeenCalled();
    });

    it('restores undo history when a prepared history rebuild fails', () => {
        const muya = boot('before\n');
        expect(muya.replaceContent('after\n')).toBe(true);
        const beforeState = muya.getState();
        const beforeHistory = muya.getHistory();
        const beforeSelection = selectionSnapshot(muya);
        const changes = vi.fn();
        muya.on('json-change', changes);

        vi.spyOn(muya.editor.scrollPage!, 'updateState')
            .mockImplementationOnce(() => {
                throw new Error('injected undo rebuild failure');
            });

        expect(() => muya.undo())
            .toThrowError('injected undo rebuild failure');

        expect(muya.getState()).toEqual(beforeState);
        expect(muya.getMarkdown()).toBe('after\n');
        expect(muya.getHistory()).toEqual(beforeHistory);
        expect(selectionSnapshot(muya)).toEqual(beforeSelection);
        expect(changes).not.toHaveBeenCalled();
    });

    it('does not leak prepared selection events when publication preparation fails', () => {
        const muya = boot('before\n');
        const beforeSelection = selectionSnapshot(muya);
        const { op } = muya.editor.jsonState.buildReplaceOp('after\n');
        const selections = vi.fn();
        const changes = vi.fn();
        muya.on('selection-change', selections);
        muya.on('json-change', changes);

        expect(() => muya.editor.mutationGateway.run(
            { kind: 'history-command' },
            () => muya.editor.rebuildContents(
                op,
                beforeSelection,
                'api',
                () => {
                    throw new Error('injected publication preparation failure');
                },
            ),
        )).toThrowError('injected publication preparation failure');

        expect(muya.getMarkdown()).toBe('before\n');
        expect(selectionSnapshot(muya)).toEqual(beforeSelection);
        expect(selections).not.toHaveBeenCalled();
        expect(changes).not.toHaveBeenCalled();
    });

    it('restores the exact search options after a prepared commit rolls back', () => {
        const muya = boot('before\n');
        muya.search('BEFORE', {
            isCaseSensitive: true,
            highlightIndex: -1,
        });
        expect(muya.editor.searchModule.matches).toHaveLength(0);
        const { op } = muya.editor.jsonState.buildReplaceOp('after\n');

        expect(() => muya.editor.mutationGateway.run(
            { kind: 'history-command' },
            () => muya.editor.rebuildContents(
                op,
                selectionSnapshot(muya),
                'api',
                () => {
                    throw new Error('injected search rollback');
                },
            ),
        )).toThrowError('injected search rollback');

        expect(muya.editor.searchModule.value).toBe('BEFORE');
        expect(muya.editor.searchModule.matches).toHaveLength(0);
        expect(muya.editor.searchModule.index).toBe(-1);
    });

    it('publishes exactly one final selection after a successful rebuild', () => {
        const muya = boot('before\n');
        const selections = vi.fn();
        muya.on('selection-change', selections);

        expect(muya.replaceContent('after\n')).toBe(true);

        expect(selections).toHaveBeenCalledTimes(1);
        expect(selections.mock.calls[0][0]).toMatchObject({
            anchor: { offset: 0 },
            focus: { offset: 0 },
            kind: 'text',
        });
    });

    it('keeps a committed replacement undoable when an observer throws', () => {
        const muya = boot('before\n');
        const laterObserver = vi.fn();
        muya.eventCenter.once('json-change', () => {
            throw new Error('injected observer failure');
        });
        muya.on('json-change', laterObserver);

        expect(() => muya.replaceContent('after\n'))
            .toThrowError('post-commit notification failed');
        expect(muya.getMarkdown()).toBe('after\n');
        expect(laterObserver).toHaveBeenCalledTimes(1);

        muya.undo();
        expect(muya.getMarkdown()).toBe('before\n');
    });

    it('keeps a committed tracked edit when a post-commit observer throws', () => {
        const muya = boot('ab\n', { criticMarkupTrackChanges: true });
        const laterObserver = vi.fn();
        muya.eventCenter.once('json-change', () => {
            throw new Error('injected tracked observer failure');
        });
        muya.on('json-change', laterObserver);

        const block = muya.editor.scrollPage!
            .firstContentInDescendant()! as Format;
        block.domNode!.textContent = 'axb';
        block.setCursor(2, 2);
        // The commit is durable before observers run; a listener failure
        // must surface as the post-commit error, not roll back the tracked
        // document or mask itself behind an invariant violation.
        expect(() => block.inputHandler(new InputEvent('input', {
            bubbles: true,
            data: 'x',
            inputType: 'insertText',
        }))).toThrowError('post-commit notification failed');
        expect(muya.getMarkdown()).toBe('a{++x++}b\n');
        expect(laterObserver).toHaveBeenCalledTimes(1);

        muya.undo();
        expect(muya.getMarkdown()).toBe('ab\n');
    });

    it('never reuses a failed proposal cache version for a later commit', () => {
        const muya = boot('before\n');
        const beforeVersion = muya.editor.jsonState.documentVersion;
        const { op } = muya.editor.jsonState.buildReplaceOp('failed\n');

        expect(() => muya.editor.mutationGateway.run(
            { kind: 'history-command' },
            () => muya.editor.rebuildContents(
                op,
                selectionSnapshot(muya),
                'api',
                () => {
                    expect(
                        muya.editor.criticMarkupDocument.get().markdown,
                    ).toBe('failed\n');
                    throw new Error('reject cached proposal');
                },
            ),
        )).toThrowError('reject cached proposal');

        const rolledBackVersion = muya.editor.jsonState.documentVersion;
        expect(rolledBackVersion).toBeGreaterThan(beforeVersion);
        expect(muya.getMarkdown()).toBe('before\n');

        expect(muya.replaceContent('committed\n')).toBe(true);
        expect(muya.editor.jsonState.documentVersion)
            .toBeGreaterThan(rolledBackVersion);
        expect(muya.editor.criticMarkupDocument.get().markdown)
            .toBe('committed\n');
    });

    it('routes asynchronous image placeholder and resolution writes through Track Changes', async () => {
        const imageAction = vi.fn().mockResolvedValue('assets/shot.png');
        const muya = boot('x\n', {
            criticMarkupTrackChanges: true,
            imageAction,
        });
        const rejected = vi.fn();
        muya.on('critic-markup-track-change-rejected', rejected);
        placeCursor(muya, 1);

        await muya.editor.clipboard.pasteImage('/abs/shot.png');
        muya.flush();

        expect(rejected).not.toHaveBeenCalled();
        expect(imageAction).toHaveBeenCalledOnce();
        expect(muya.getMarkdown()).toBe('x{++![](assets/shot.png)++}\n');
    });
});

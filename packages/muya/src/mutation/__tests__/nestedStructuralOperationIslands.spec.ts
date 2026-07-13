// @vitest-environment happy-dom

import type Format from '../../block/base/format';
import type TreeNode from '../../block/base/treeNode';
import type Table from '../../block/gfm/table';
import type TaskListItem from '../../block/gfm/taskListItem';
import type {
    ICapturedStateMutation,
    TStateOperationIntent,
} from '../../state/mutationCapture';
import type { TState } from '../../state/types';
import type { TMutationResult } from '../types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TaskListCheckbox from '../../block/gfm/taskListCheckbox';
import { Muya } from '../../muya';
import { markdownStatePath } from '../../state/markdownSourceMap';
import StateToMarkdown from '../../state/stateToMarkdown';
import { deriveOperationSourceEdits } from '../operationSourceEdits';

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

    const muya = new Muya(host, {
        markdown,
        criticMarkupTrackChanges: true,
    });
    muya.init();
    editors.push(muya);
    return muya;
}

function findTable(muya: Muya): Table {
    let table: Table | null = null;
    const visit = (block: TreeNode) => {
        if ((block.constructor as typeof TreeNode).blockName === 'table')
            table = block as Table;
        if (block.isParent())
            block.children.forEach(visit);
    };
    visit(muya.editor.scrollPage!);
    if (!table)
        throw new Error('Expected a table in the structural-operation fixture.');
    return table;
}

function contentBlocksByText(muya: Muya, text: string): Format[] {
    const matches: Format[] = [];
    let block = muya.editor.scrollPage!.firstContentInDescendant();
    while (block) {
        if (block.text === text)
            matches.push(block as Format);
        block = block.nextContentInContext() ?? null;
    }
    return matches;
}

function placeStableCursor(muya: Muya, text: string): void {
    const block = contentBlocksByText(muya, text)[0];
    if (!block)
        throw new Error(`Expected stable cursor block ${JSON.stringify(text)}.`);
    muya.editor.activeContentBlock = block;
    block.setCursor(0, 0, true);
}

function runCapturedTrackedCommand(
    muya: Muya,
    mutate: () => void,
): {
    captured: ICapturedStateMutation<unknown>;
    result: TMutationResult;
} {
    const capture = vi.spyOn(muya.editor.jsonState, 'capture');
    let result!: TMutationResult;
    let capturedResult: (typeof capture.mock.results)[number] | undefined;
    try {
        result = muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            mutate,
        );
        capturedResult = capture.mock.results.at(-1);
    }
    finally {
        capture.mockRestore();
    }
    if (!capturedResult || capturedResult.type !== 'return') {
        throw new TypeError(
            'Expected the real command to produce one captured operation batch.',
        );
    }
    return { captured: capturedResult.value, result };
}

function derive(captured: ICapturedStateMutation<unknown>) {
    const serializer = new StateToMarkdown({ listIndentation: 1 });
    const before = serializer.generateMapped(captured.beforeState);
    const after = serializer.generateMapped(captured.afterState);
    const edits = deriveOperationSourceEdits(captured, before, after);
    if (!edits)
        throw new TypeError('Expected exact operation-derived source edits.');
    return { before, after, edits };
}

function rangesOverlap(
    left: { start: number; end: number },
    right: { start: number; end: number },
): boolean {
    if (left.start === left.end)
        return right.start <= left.start && left.start <= right.end;
    if (right.start === right.end)
        return left.start <= right.start && right.start <= left.end;
    return left.start < right.end && right.start < left.end;
}

function applyEdits(
    source: string,
    edits: readonly { oldRange: { start: number; end: number }; inserted: string }[],
): string {
    return [...edits]
        .sort((left, right) => right.oldRange.start - left.oldRange.start)
        .reduce((result, edit) =>
            result.slice(0, edit.oldRange.start)
            + edit.inserted
            + result.slice(edit.oldRange.end), source);
}

function expectUntouchedSegmentsPreserved(
    before: string,
    after: string,
    edits: readonly { oldRange: { start: number; end: number }; inserted: string }[],
): void {
    let beforeCursor = 0;
    let afterCursor = 0;
    for (const edit of [...edits].sort((left, right) =>
        left.oldRange.start - right.oldRange.start)) {
        const untouched = before.slice(beforeCursor, edit.oldRange.start);
        expect(after.slice(afterCursor, afterCursor + untouched.length))
            .toBe(untouched);
        beforeCursor = edit.oldRange.end;
        afterCursor += untouched.length + edit.inserted.length;
    }
    expect(after.slice(afterCursor)).toBe(before.slice(beforeCursor));
}

function expectProjectionLaws(
    muya: Muya,
    before: string,
    after: string,
): void {
    expect(muya.editor.criticMarkupDocument.get().project('original'))
        .toBe(before);
    expect(muya.editor.criticMarkupDocument.get().project('revised'))
        .toBe(after);
}

function operationIntents(
    captured: ICapturedStateMutation<unknown>,
    kind: TStateOperationIntent['kind'],
) {
    return captured.intents.filter(intent => intent.kind === kind);
}

function allStates(states: readonly TState[]): TState[] {
    return states.flatMap(state => [
        state,
        ...('children' in state
            ? allStates(state.children as TState[])
            : []),
    ]);
}

describe('nested structural operation islands under Track Changes', () => {
    it('attributes first-column removal to the exact repeated cells, not their identical siblings', () => {
        const muya = boot([
            '| same | same | KEEP |',
            '| --- | --- | --- |',
            '| same | same | KEEP |',
            '| same | same | KEEP |',
            '',
        ].join('\n'));
        placeStableCursor(muya, 'KEEP');
        const table = findTable(muya);

        const { captured, result } = runCapturedTrackedCommand(
            muya,
            () => void table.removeColumn(0),
        );
        const { before, after, edits } = derive(captured);
        const removals = operationIntents(captured, 'remove');
        expect(removals.length).toBeGreaterThan(1);

        const intendedCells = removals.map(intent =>
            before.sourceMap.rangeForPath(markdownStatePath([
                ...intent.path,
                'text',
            ]))!);
        const identicalSiblings = removals.map((intent) => {
            const siblingPath = [...intent.path];
            siblingPath[siblingPath.length - 1]
                = Number(siblingPath.at(-1)) + 1;
            return before.sourceMap.rangeForPath(markdownStatePath([
                ...siblingPath,
                'text',
            ]))!;
        });
        expect(intendedCells.every(range =>
            edits.some(edit => rangesOverlap(edit.oldRange, range))))
            .toBe(true);
        expect(edits.every(edit =>
            identicalSiblings.every(range =>
                !rangesOverlap(edit.oldRange, range))))
            .toBe(true);

        expect(applyEdits(before.text, edits)).toBe(after.text);
        expectUntouchedSegmentsPreserved(before.text, after.text, edits);
        expect(result).toBe('tracked');
        expectProjectionLaws(muya, before.text, after.text);
        expect(muya.getMarkdown()).toContain('KEEP');
        expect(allStates(muya.getState()).some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
    });

    it('maps each inserted table-column cell to its deepest operation island', () => {
        const muya = boot([
            '| left | right |',
            '| --- | --- |',
            '| one | two |',
            '',
        ].join('\n'));
        placeStableCursor(muya, 'left');
        const table = findTable(muya);

        const { captured, result } = runCapturedTrackedCommand(
            muya,
            () => void table.insertColumn(1, 'center'),
        );
        const { before, after, edits } = derive(captured);
        const insertions = operationIntents(captured, 'insert');
        expect(insertions.length).toBeGreaterThan(1);

        for (const intent of insertions) {
            expect(
                after.sourceMap.nodeRange(markdownStatePath(intent.path)),
            ).not.toBeNull();
        }
        expect(edits.every(edit => edit.oldRange.start === edit.oldRange.end))
            .toBe(true);
        expect(applyEdits(before.text, edits)).toBe(after.text);
        expectUntouchedSegmentsPreserved(before.text, after.text, edits);
        expect(result).toBe('tracked');
        expectProjectionLaws(muya, before.text, after.text);
        expect(muya.getMarkdown()).toContain('left');
        expect(muya.getMarkdown()).toContain('right');
        expect(allStates(muya.getState()).some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
    });

    it('attributes removal of the first repeated nested list item to that exact item', () => {
        const muya = boot([
            '- parent',
            '  - same',
            '  - same',
            '  - KEEP',
            '- tail',
            '',
        ].join('\n'));
        placeStableCursor(muya, 'parent');
        const repeated = contentBlocksByText(muya, 'same');
        expect(repeated).toHaveLength(2);
        const targetItem = repeated[0].parent!.parent!;

        const { captured, result } = runCapturedTrackedCommand(
            muya,
            () => targetItem.remove(),
        );
        const { before, after, edits } = derive(captured);
        const [removal] = operationIntents(captured, 'remove');
        expect(removal).toBeDefined();
        const targetRange = before.sourceMap.nodeRange(
            markdownStatePath(removal.path),
        )!;
        const duplicatePath = [...removal.path];
        duplicatePath[duplicatePath.length - 1]
            = Number(duplicatePath.at(-1)) + 1;
        const duplicateRange = before.sourceMap.nodeRange(
            markdownStatePath(duplicatePath),
        )!;

        expect(edits.every(edit =>
            targetRange.start <= edit.oldRange.start
            && edit.oldRange.end <= targetRange.end)).toBe(true);
        expect(edits.every(edit =>
            !rangesOverlap(edit.oldRange, duplicateRange))).toBe(true);
        expect(applyEdits(before.text, edits)).toBe(after.text);
        expectUntouchedSegmentsPreserved(before.text, after.text, edits);
        expect(result).toBe('tracked');
        expectProjectionLaws(muya, before.text, after.text);
        expect(muya.getMarkdown()).toContain('KEEP');
        expect(allStates(muya.getState()).some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(muya.getMarkdown()).toContain('tail');
        const trackedStates = allStates(muya.getState());
        expect(trackedStates.some(state =>
            state.name === 'markdown-parser-residue')).toBe(false);
        expect(trackedStates.filter(state =>
            state.name === 'paragraph' && state.text === 'same'))
            .toHaveLength(2);
        expect(trackedStates.filter(state =>
            state.sourceTrivia?.criticBefore?.some(marker =>
                marker.type === 'deletion'
                && marker.marker === 'open'))).toHaveLength(1);
        const structural = muya.domNode.querySelector(
            '[data-critic-structural-id]',
        );
        expect(structural?.tagName).toBe('LI');
    });

    it('maps a nested task-list metadata replacement to its exact source marker', () => {
        const muya = boot([
            '- [ ] parent',
            '  - [ ] TARGET',
            '- [ ] KEEP',
            '',
        ].join('\n'));
        placeStableCursor(muya, 'parent');
        const target = contentBlocksByText(muya, 'TARGET')[0];
        if (!target)
            throw new Error('Expected the nested task-list target.');
        const taskItem = target.parent!.parent! as TaskListItem;

        const { captured, result } = runCapturedTrackedCommand(
            muya,
            () => TaskListCheckbox.setItemChecked(taskItem, true),
        );
        const { before, after, edits } = derive(captured);
        const [replacement] = operationIntents(captured, 'replace');
        expect(replacement).toBeDefined();

        expect(
            before.sourceMap.nodeRange(markdownStatePath(replacement.path)),
        ).not.toBeNull();
        expect(
            after.sourceMap.nodeRange(markdownStatePath(replacement.path)),
        ).not.toBeNull();
        expect(applyEdits(before.text, edits)).toBe(after.text);
        expectUntouchedSegmentsPreserved(before.text, after.text, edits);
        expect(result).toBe('tracked');
        expectProjectionLaws(muya, before.text, after.text);
        expect(muya.getMarkdown()).toContain('KEEP');
    });
});

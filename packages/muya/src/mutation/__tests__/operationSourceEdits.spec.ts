import type { Doc } from 'ot-json1';
import type { IListItemState, TState } from '../../state/types';
import type { TDiff } from '../../utils';
import * as json1 from 'ot-json1';
import { describe, expect, it } from 'vitest';
import {
    fromMarkdownSourceMap,
    markdownStatePath,
} from '../../state/markdownSourceMap';
import { StateMutationCapture } from '../../state/mutationCapture';
import StateToMarkdown from '../../state/stateToMarkdown';
import {
    deriveOperationSourceEdits,
    textIntentGroups,
} from '../operationSourceEdits';

function asDoc(value: TState): Doc {
    return value as unknown as Doc;
}

function mapped(states: TState[]) {
    return fromMarkdownSourceMap(
        new StateToMarkdown().generateWithSourceMap(states),
    );
}

function applyEdits(
    source: string,
    edits: readonly {
        oldRange: { start: number; end: number };
        inserted: string;
    }[],
): string {
    return [...edits]
        .sort((left, right) => right.oldRange.start - left.oldRange.start)
        .reduce((result, edit) =>
            result.slice(0, edit.oldRange.start)
            + edit.inserted
            + result.slice(edit.oldRange.end), source);
}

function captureText(
    before: TState[],
    path: (string | number)[],
    operation: TDiff[],
) {
    const capture = new StateMutationCapture(0, before);
    const jsonOperation = json1.editOp(
        path,
        'text-unicode',
        operation,
    )!;
    capture.recordText(path, operation, jsonOperation);
    return capture;
}

describe('operation-scoped Markdown source edits', () => {
    it('groups equal structural paths while keeping numeric and string segments distinct', () => {
        const intent = (path: (string | number)[]) => ({
            kind: 'text-edit' as const,
            path,
            operation: [] as never,
            before: 'a',
            after: 'b',
            edits: [{ oldRange: { start: 0, end: 1 }, inserted: 'b' }],
        });
        const groups = textIntentGroups([
            intent([1, 'text']),
            intent(['1', 'text']),
            intent([1, 'text']),
        ]);

        expect(groups.map(group => ({
            path: group.path,
            count: group.intents.length,
        }))).toEqual([
            { path: [1, 'text'], count: 2 },
            { path: ['1', 'text'], count: 1 },
        ]);
    });

    it('keeps insertions immediately outside both Critic delimiter edges distinct', () => {
        const before: TState[] = [{ name: 'paragraph', text: '{++x++}' }];
        const capture = captureText(
            before,
            [0, 'text'],
            ['L', 7, 'R'],
        );
        const captured = capture.finish(undefined);
        const beforeMapped = mapped(before);
        const afterMapped = mapped(captured.afterState);

        const edits = deriveOperationSourceEdits(
            captured,
            beforeMapped,
            afterMapped,
        );

        expect(edits).toEqual([
            { oldRange: { start: 0, end: 0 }, inserted: 'L' },
            { oldRange: { start: 7, end: 7 }, inserted: 'R' },
        ]);
        expect(applyEdits(beforeMapped.text, edits!)).toBe(afterMapped.text);
    });

    it('preserves one exact selection replacement instead of widening shared text', () => {
        const before: TState[] = [{ name: 'paragraph', text: 'keep bc keep' }];
        const capture = captureText(
            before,
            [0, 'text'],
            [5, { d: 'bc' }, 'X'],
        );
        const captured = capture.finish(undefined);
        const beforeMapped = mapped(before);
        const afterMapped = mapped(captured.afterState);

        const edits = deriveOperationSourceEdits(
            captured,
            beforeMapped,
            afterMapped,
        );

        expect(edits).toEqual([{
            oldRange: { start: 5, end: 7 },
            inserted: 'X',
        }]);
        expect(edits![0].oldRange).not.toEqual({ start: 0, end: 12 });
        expect(applyEdits(beforeMapped.text, edits!)).toBe(afterMapped.text);
    });

    it('composes the delete-then-insert operations emitted by replacement input', () => {
        const before: TState[] = [{ name: 'paragraph', text: 'abc' }];
        const capture = captureText(
            before,
            [0, 'text'],
            [1, { d: 'b' }],
        );
        const insertion = json1.editOp(
            [0, 'text'],
            'text-unicode',
            [1, 'X'],
        )!;
        capture.recordText([0, 'text'], [1, 'X'], insertion);
        const captured = capture.finish(undefined);
        const beforeMapped = mapped(before);
        const afterMapped = mapped(captured.afterState);

        const edits = deriveOperationSourceEdits(
            captured,
            beforeMapped,
            afterMapped,
        );

        expect(captured.intents).toHaveLength(2);
        expect(edits).toEqual([{
            oldRange: { start: 1, end: 2 },
            inserted: 'X',
        }]);
        expect(applyEdits(beforeMapped.text, edits!)).toBe(afterMapped.text);
    });

    it('composes a large captured insertion without variadic argument expansion', () => {
        const inserted = 'x'.repeat(200_000);
        const before: TState[] = [{ name: 'paragraph', text: '' }];
        const capture = captureText(
            before,
            [0, 'text'],
            [inserted],
        );
        const captured = capture.finish(undefined);
        const beforeMapped = mapped(before);
        const afterMapped = mapped(captured.afterState);

        const edits = deriveOperationSourceEdits(
            captured,
            beforeMapped,
            afterMapped,
        );

        expect(edits).toEqual([{
            oldRange: { start: 0, end: 0 },
            inserted,
        }]);
        expect(applyEdits(beforeMapped.text, edits!)).toBe(afterMapped.text);
    });

    it('scopes a block conversion to its insert/remove operation island', () => {
        const before: TState[] = [
            { name: 'paragraph', text: 'convert me' },
            { name: 'paragraph', text: 'UNTOUCHED' },
        ];
        const capture = new StateMutationCapture(0, before);
        const heading: TState = {
            name: 'atx-heading',
            meta: { level: 2 },
            text: '## convert me',
        };
        capture.recordInsert(
            [0],
            asDoc(heading),
            json1.insertOp([0], asDoc(heading))!,
        );
        capture.recordRemove([1], json1.removeOp([1])!);
        const captured = capture.finish(undefined);
        const beforeMapped = mapped(before);
        const afterMapped = mapped(captured.afterState);

        const edits = deriveOperationSourceEdits(
            captured,
            beforeMapped,
            afterMapped,
        );
        const untouched = beforeMapped.sourceMap.rangeForPath(
            markdownStatePath([1, 'text']),
        )!;

        expect(captured.intents.map(intent => ({
            kind: intent.kind,
            path: intent.path,
        }))).toEqual([
            { kind: 'insert', path: [0] },
            { kind: 'remove', path: [1] },
        ]);
        expect(edits).toEqual([{
            oldRange: { start: 0, end: 0 },
            inserted: '## ',
        }]);
        expect(edits!.every(edit => edit.oldRange.end <= untouched.start))
            .toBe(true);
        expect(edits!.every(edit => !edit.inserted.includes('UNTOUCHED')))
            .toBe(true);
        expect(applyEdits(beforeMapped.text, edits!)).toBe(afterMapped.text);
    });

    it('keeps a structural list conversion inside the captured list island', () => {
        const bullet: TState = {
            name: 'bullet-list',
            meta: { marker: '-', loose: false },
            children: [
                {
                    name: 'list-item',
                    children: [{ name: 'paragraph', text: 'one' }],
                },
                {
                    name: 'list-item',
                    children: [{ name: 'paragraph', text: 'two' }],
                },
            ],
        };
        const ordered: TState = {
            name: 'order-list',
            meta: { start: 1, delimiter: '.', loose: false },
            children: [
                {
                    name: 'list-item',
                    children: [{ name: 'paragraph', text: 'one' }],
                },
                {
                    name: 'list-item',
                    children: [{ name: 'paragraph', text: 'two' }],
                },
            ],
        };
        const before: TState[] = [
            bullet,
            { name: 'paragraph', text: 'UNTOUCHED' },
        ];
        const capture = new StateMutationCapture(0, before);
        capture.recordInsert(
            [0],
            asDoc(ordered),
            json1.insertOp([0], asDoc(ordered))!,
        );
        capture.recordRemove([1], json1.removeOp([1])!);
        const captured = capture.finish(undefined);
        const beforeMapped = mapped(before);
        const afterMapped = mapped(captured.afterState);

        const edits = deriveOperationSourceEdits(
            captured,
            beforeMapped,
            afterMapped,
        );
        const untouched = beforeMapped.sourceMap.nodeRange(
            markdownStatePath([1]),
        )!;

        expect(edits).not.toBeNull();
        expect(applyEdits(beforeMapped.text, edits!)).toBe(afterMapped.text);
        expect(edits!.every(edit => edit.oldRange.end <= untouched.start))
            .toBe(true);
        expect(edits!.every(edit => !edit.inserted.includes('UNTOUCHED')))
            .toBe(true);
    });

    it('turns a captured paragraph split into only the inserted block boundary', () => {
        const before: TState[] = [
            { name: 'paragraph', text: 'ab' },
            { name: 'paragraph', text: 'tail' },
        ];
        const capture = new StateMutationCapture(0, before);
        const textOperation = json1.editOp(
            [0, 'text'],
            'text-unicode',
            [1, { d: 'b' }],
        )!;
        capture.recordText([0, 'text'], [1, { d: 'b' }], textOperation);
        const inserted: TState = { name: 'paragraph', text: 'b' };
        capture.recordInsert(
            [1],
            asDoc(inserted),
            json1.insertOp([1], asDoc(inserted))!,
        );
        const captured = capture.finish(undefined);
        const beforeMapped = mapped(before);
        const afterMapped = mapped(captured.afterState);

        const edits = deriveOperationSourceEdits(
            captured,
            beforeMapped,
            afterMapped,
        );

        expect(edits).toEqual([{
            oldRange: { start: 1, end: 1 },
            inserted: '\n\n',
        }]);
        expect(applyEdits(beforeMapped.text, edits!)).toBe(afterMapped.text);
    });

    it('keeps disjoint structural islands separate from an untouched middle block', () => {
        const before: TState[] = [
            { name: 'paragraph', text: 'A' },
            { name: 'paragraph', text: 'MIDDLE' },
            { name: 'paragraph', text: 'B' },
        ];
        const capture = new StateMutationCapture(0, before);
        const first: TState = { name: 'paragraph', text: 'FIRST' };
        capture.recordInsert(
            [1],
            asDoc(first),
            json1.insertOp([1], asDoc(first))!,
        );
        const last: TState = { name: 'paragraph', text: 'LAST' };
        capture.recordInsert(
            [3],
            asDoc(last),
            json1.insertOp([3], asDoc(last))!,
        );
        const captured = capture.finish(undefined);
        const beforeMapped = mapped(before);
        const afterMapped = mapped(captured.afterState);

        const edits = deriveOperationSourceEdits(
            captured,
            beforeMapped,
            afterMapped,
        );
        const middle = beforeMapped.sourceMap.rangeForPath(
            markdownStatePath([1, 'text']),
        )!;

        expect(edits).toHaveLength(2);
        expect(applyEdits(beforeMapped.text, edits!)).toBe(afterMapped.text);
        expect(edits!.every(edit =>
            edit.oldRange.end <= middle.start
            || middle.end <= edit.oldRange.start)).toBe(true);
        expect(edits!.every(edit => !edit.inserted.includes('MIDDLE')))
            .toBe(true);
    });

    it('follows nested sibling identity through sequential draft-relative shifts', () => {
        const listItem = (text: string): IListItemState => ({
            name: 'list-item',
            children: [{ name: 'paragraph', text }],
        });
        const before: TState[] = [{
            name: 'bullet-list',
            meta: { marker: '-', loose: false },
            children: [
                listItem('HEAD'),
                listItem('same'),
                listItem('same'),
                listItem('TAIL'),
            ],
        }];
        const capture = new StateMutationCapture(0, before);
        const inserted = listItem('same');
        const insertPath = [0, 'children', 1];
        capture.recordInsert(
            insertPath,
            asDoc(inserted),
            json1.insertOp(insertPath, asDoc(inserted))!,
        );
        // TAIL moved from index 3 to index 4 in the isolated draft. The second
        // path is therefore relative to the updated draft, not to `before`.
        const removePath = [0, 'children', 4];
        capture.recordRemove(removePath, json1.removeOp(removePath)!);
        const captured = capture.finish(undefined);
        const beforeMapped = mapped(before);
        const afterMapped = mapped(captured.afterState);
        const firstSame = beforeMapped.sourceMap.nodeRange(
            markdownStatePath([0, 'children', 1]),
        )!;
        const removedTail = beforeMapped.sourceMap.nodeRange(
            markdownStatePath([0, 'children', 3]),
        )!;

        const edits = deriveOperationSourceEdits(
            captured,
            beforeMapped,
            afterMapped,
        );

        expect(edits).not.toBeNull();
        expect(applyEdits(beforeMapped.text, edits!)).toBe(afterMapped.text);
        expect(edits).toContainEqual({
            oldRange: {
                start: firstSame.start,
                end: firstSame.start,
            },
            inserted: '- same\n',
        });
        expect(edits!.some(edit =>
            edit.oldRange.start < removedTail.end
            && removedTail.start < edit.oldRange.end)).toBe(true);
        expect(afterMapped.text.match(/same/g)).toHaveLength(3);
        expect(afterMapped.text).not.toContain('TAIL');
    });

    it('rejects serializer drift outside the paths named by the captured batch', () => {
        const before: TState[] = [
            { name: 'paragraph', text: 'A' },
            { name: 'paragraph', text: 'UNTOUCHED' },
        ];
        const capture = new StateMutationCapture(0, before);
        const inserted: TState = { name: 'paragraph', text: 'INSERTED' };
        capture.recordInsert(
            [1],
            asDoc(inserted),
            json1.insertOp([1], asDoc(inserted))!,
        );
        const captured = capture.finish(undefined);
        const unexplainedAfter: TState[] = [
            { name: 'paragraph', text: 'A' },
            inserted,
            { name: 'paragraph', text: 'UNEXPLAINED-DRIFT' },
        ];

        expect(deriveOperationSourceEdits(
            captured,
            mapped(before),
            mapped(unexplainedAfter),
        )).toBeNull();
    });
});

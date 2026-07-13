// @vitest-environment happy-dom

import type { IMutationAuthority } from '../../mutation/authority';
import type { Muya } from '../../muya';
import type { TState } from '../types';
import diff from 'fast-diff';
import * as json1 from 'ot-json1';
import * as otText from 'ot-text-unicode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMutationAuthority } from '../../mutation/authority';
import { diffToTextOp } from '../../utils';
import JSONState, { asDoc, asState } from '../index';

const authorityByState = new WeakMap<JSONState, IMutationAuthority>();

function authorizedCapture<T>(state: JSONState, mutate: () => T) {
    return authorityByState.get(state)!.run(() => state.capture(mutate));
}

function makeState(blocks: TState[]): {
    emit: ReturnType<typeof vi.fn>;
    state: JSONState;
} {
    const emit = vi.fn();
    const muya = {
        options: {
            footnote: false,
            isGitlabCompatibilityEnabled: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
            frontMatter: false,
            math: false,
            listIndentation: 1,
        },
        eventCenter: { emit },
    } as unknown as Muya;

    const authority = createMutationAuthority();
    const state = new JSONState(muya, blocks, authority);
    authorityByState.set(state, authority);
    return {
        emit,
        state,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('jSONState.capture', () => {
    it('captures exact sequential operation intents without publishing or scheduling them', () => {
        const initial: TState[] = [
            { name: 'paragraph', text: 'alpha' },
            {
                name: 'task-list',
                meta: { marker: '-', loose: false },
                children: [{
                    name: 'task-list-item',
                    meta: { checked: false },
                    children: [{ name: 'paragraph', text: 'task' }],
                }],
            },
            { name: 'paragraph', text: 'omega' },
        ];
        const { emit, state } = makeState(initial);
        const beforeRevision = state.liveRevision;
        const schedule = vi.spyOn(window, 'requestAnimationFrame');

        const captured = authorizedCapture(state, () => {
            state.editOperation([0, 'text'], [3, 'X']);
            state.insertOperation([1], {
                name: 'paragraph',
                text: 'inserted',
            });
            state.replaceOperation(
                [2, 'children', 0, 'meta', 'checked'],
                false,
                true,
            );
            state.removeOperation([3]);

            return 'mutation-result';
        });

        expect(captured.value).toBe('mutation-result');
        expect(captured.baseRevision).toBe(beforeRevision);
        expect(captured.beforeState).toEqual(initial);
        expect(captured.afterState).toEqual([
            { name: 'paragraph', text: 'alpXha' },
            { name: 'paragraph', text: 'inserted' },
            {
                name: 'task-list',
                meta: { marker: '-', loose: false },
                children: [{
                    name: 'task-list-item',
                    meta: { checked: true },
                    children: [{ name: 'paragraph', text: 'task' }],
                }],
            },
        ]);
        expect(captured.intents).toHaveLength(4);
        expect(captured.intents[0]).toMatchObject({
            kind: 'text-edit',
            path: [0, 'text'],
            before: 'alpha',
            after: 'alpXha',
            edits: [{
                oldRange: { start: 3, end: 3 },
                inserted: 'X',
            }],
        });
        expect(captured.intents[1]).toMatchObject({
            kind: 'insert',
            path: [1],
            value: { name: 'paragraph', text: 'inserted' },
        });
        expect(captured.intents[2]).toMatchObject({
            kind: 'replace',
            path: [2, 'children', 0, 'meta', 'checked'],
            before: false,
            after: true,
        });
        expect(captured.intents[3]).toMatchObject({
            kind: 'remove',
            path: [3],
            value: { name: 'paragraph', text: 'omega' },
        });
        expect(captured.operation).not.toBeNull();
        expect(asState(json1.type.apply(
            asDoc(captured.beforeState),
            captured.operation,
        ))).toEqual(captured.afterState);

        expect(state.getState()).toEqual(initial);
        expect(state.getLiveState()).toEqual(initial);
        expect(state.liveRevision).toBe(beforeRevision);
        expect(emit).not.toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();
    });

    it('keeps disjoint text edits exact across code-point and UTF-16 coordinates', () => {
        const family = '👨‍👩‍👧‍👦';
        const before = `A${family}e\u0301Z`;
        const after = `A${family}XeZ`;
        const operation = diffToTextOp(diff(before, after));

        // This is the operation-unit contract: ot-text-unicode counts code
        // points, while the source ranges exposed below remain UTF-16 offsets.
        expect(otText.type.apply(before, operation)).toBe(after);

        const { emit, state } = makeState([{
            name: 'paragraph',
            text: before,
        }]);
        const captured = authorizedCapture(state, () => {
            state.editOperation([0, 'text'], operation);
        });
        const insertAt = before.indexOf('e');
        const accentAt = before.indexOf('\u0301');

        expect(captured.intents).toHaveLength(1);
        expect(captured.intents[0]).toMatchObject({
            kind: 'text-edit',
            path: [0, 'text'],
            before,
            after,
            edits: [
                {
                    oldRange: { start: insertAt, end: insertAt },
                    inserted: 'X',
                },
                {
                    oldRange: { start: accentAt, end: accentAt + 1 },
                    inserted: '',
                },
            ],
        });
        expect(captured.afterState).toEqual([{
            name: 'paragraph',
            text: after,
        }]);
        expect(state.getState()).toEqual([{
            name: 'paragraph',
            text: before,
        }]);
        expect(emit).not.toHaveBeenCalled();
    });

    it('captures paragraph split and join as exact structural batches', () => {
        const splitState = makeState([{ name: 'paragraph', text: 'ab' }]).state;
        const split = authorizedCapture(splitState, () => {
            splitState.editOperation([0, 'text'], [1, { d: 'b' }]);
            splitState.insertOperation([1], {
                name: 'paragraph',
                text: 'b',
            });
        });

        expect(split.intents).toMatchObject([
            {
                kind: 'text-edit',
                path: [0, 'text'],
                before: 'ab',
                after: 'a',
            },
            {
                kind: 'insert',
                path: [1],
                value: { name: 'paragraph', text: 'b' },
            },
        ]);
        expect(split.afterState).toEqual([
            { name: 'paragraph', text: 'a' },
            { name: 'paragraph', text: 'b' },
        ]);
        expect(asState(json1.type.apply(
            asDoc(split.beforeState),
            split.operation,
        ))).toEqual(split.afterState);
        expect(splitState.getState()).toEqual([{
            name: 'paragraph',
            text: 'ab',
        }]);

        const joinState = makeState([
            { name: 'paragraph', text: 'a' },
            { name: 'paragraph', text: 'b' },
        ]).state;
        const join = authorizedCapture(joinState, () => {
            joinState.editOperation([0, 'text'], [1, 'b']);
            joinState.removeOperation([1]);
        });

        expect(join.intents).toMatchObject([
            {
                kind: 'text-edit',
                path: [0, 'text'],
                before: 'a',
                after: 'ab',
            },
            {
                kind: 'remove',
                path: [1],
                value: { name: 'paragraph', text: 'b' },
            },
        ]);
        expect(join.afterState).toEqual([{ name: 'paragraph', text: 'ab' }]);
        expect(asState(json1.type.apply(
            asDoc(join.beforeState),
            join.operation,
        ))).toEqual(join.afterState);
        expect(joinState.getState()).toEqual([
            { name: 'paragraph', text: 'a' },
            { name: 'paragraph', text: 'b' },
        ]);
    });

    it('preserves independent table-cell edits as separate path intents', () => {
        const initial: TState[] = [{
            name: 'table',
            children: [
                {
                    name: 'table.row',
                    children: [
                        { name: 'table.cell', meta: { align: 'none' }, text: 'a' },
                        { name: 'table.cell', meta: { align: 'none' }, text: 'b' },
                    ],
                },
                {
                    name: 'table.row',
                    children: [
                        { name: 'table.cell', meta: { align: 'none' }, text: 'c' },
                        { name: 'table.cell', meta: { align: 'none' }, text: 'd' },
                    ],
                },
            ],
        }];
        const { state } = makeState(initial);
        const captured = authorizedCapture(state, () => {
            state.editOperation(
                [0, 'children', 0, 'children', 0, 'text'],
                [{ d: 'a' }],
            );
            state.editOperation(
                [0, 'children', 1, 'children', 1, 'text'],
                [{ d: 'd' }],
            );
        });

        expect(captured.intents).toMatchObject([
            {
                kind: 'text-edit',
                path: [0, 'children', 0, 'children', 0, 'text'],
                before: 'a',
                after: '',
            },
            {
                kind: 'text-edit',
                path: [0, 'children', 1, 'children', 1, 'text'],
                before: 'd',
                after: '',
            },
        ]);
        expect(captured.afterState).toEqual([{
            name: 'table',
            children: [
                {
                    name: 'table.row',
                    children: [
                        { name: 'table.cell', meta: { align: 'none' }, text: '' },
                        { name: 'table.cell', meta: { align: 'none' }, text: 'b' },
                    ],
                },
                {
                    name: 'table.row',
                    children: [
                        { name: 'table.cell', meta: { align: 'none' }, text: 'c' },
                        { name: 'table.cell', meta: { align: 'none' }, text: '' },
                    ],
                },
            ],
        }]);
        expect(asState(json1.type.apply(
            asDoc(captured.beforeState),
            captured.operation,
        ))).toEqual(captured.afterState);
        expect(state.getState()).toEqual(initial);
    });

    it('discards an interrupted capture without leaking its partial batch', () => {
        const initial: TState[] = [{ name: 'paragraph', text: 'before' }];
        const { emit, state } = makeState(initial);
        const beforeRevision = state.liveRevision;
        const schedule = vi.spyOn(window, 'requestAnimationFrame');

        expect(() => authorizedCapture(state, () => {
            state.editOperation([0, 'text'], [6, ' partial']);
            throw new Error('proposal failed');
        })).toThrowError('proposal failed');

        expect(state.getState()).toEqual(initial);
        expect(state.getLiveState()).toEqual(initial);
        expect(state.liveRevision).toBe(beforeRevision);
        expect(emit).not.toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();
    });

    it('retains sequential IME intents even when their composition is a no-op', () => {
        const initial: TState[] = [{ name: 'paragraph', text: 'ab' }];
        const { emit, state } = makeState(initial);

        const captured = authorizedCapture(state, () => {
            state.editOperation([0, 'text'], [1, '文']);
            state.editOperation([0, 'text'], [1, { d: '文' }]);
        });

        expect(captured.intents).toHaveLength(2);
        expect(captured.intents).toMatchObject([
            {
                kind: 'text-edit',
                before: 'ab',
                after: 'a文b',
            },
            {
                kind: 'text-edit',
                before: 'a文b',
                after: 'ab',
            },
        ]);
        expect(captured.operation).toBeNull();
        expect(captured.afterState).toEqual(initial);
        expect(state.getState()).toEqual(initial);
        expect(emit).not.toHaveBeenCalled();
    });
});

// @vitest-environment happy-dom

import type { IMutationAuthority } from '../../mutation/authority';
import type { Muya } from '../../muya';
import type { TState } from '../types';
import { describe, expect, it } from 'vitest';
import { createMutationAuthority } from '../../mutation/authority';
import JSONState from '../index';

const authorityByState = new WeakMap<JSONState, IMutationAuthority>();

function authorize(state: JSONState, mutate: () => void): void {
    authorityByState.get(state)!.run(mutate);
}

// #2938: switching files (setContent) within the same frame as a pending edit
// left the previous document's deferred op batch in the cache. The scheduled
// requestAnimationFrame then applied that op to the NEW document's state,
// corrupting it (or throwing and freezing `_isGoing`), which broke saving the
// switched-to file. setContent must drop the pending batch and cancel its
// scheduled flush.

function makeState(blocks: TState[]): JSONState {
    let state: JSONState;
    const muya = {
        options: {
            footnote: false,
            isGitlabCompatibilityEnabled: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
            frontMatter: false,
            math: false,
            listIndentation: 1,
        },
        eventCenter: { emit: () => {} },
        editor: {
            commitPendingContents: (operation: Parameters<JSONState['applySilently']>[0], source: string) => {
                const change = state.applySilently(operation, source);
                state.publish(change);
            },
        },
    } as unknown as Muya;
    const authority = createMutationAuthority();
    state = new JSONState(muya, blocks, authority);
    authorityByState.set(state, authority);
    return state;
}

function nextFrame(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

describe('setContent drops the previous document pending op batch (#2938)', () => {
    it('a deferred op from the old doc does not corrupt the new content after a tab switch', async () => {
        const state = makeState([{ name: 'paragraph', text: 'A' }]);

        // Pending edit against doc A (insert a block at index 1), not yet flushed.
        authorize(state, () =>
            state.insertOperation([1], { name: 'paragraph', text: 'STALE' }));

        // Switch to doc B within the same frame.
        authorize(state, () => state.setContent([
            { name: 'paragraph', text: 'B1' },
            { name: 'paragraph', text: 'B2' },
        ]));

        // Let the (cancelled) rAF window elapse.
        await nextFrame();
        await nextFrame();

        const texts = (state.getState() as Array<{ text: string }>).map(b => b.text);
        // The stale insert must NOT have been applied to doc B.
        expect(texts).toEqual(['B1', 'B2']);
    });

    it('edits after a setContent still flush normally', async () => {
        const state = makeState([{ name: 'paragraph', text: 'A' }]);
        authorize(state, () =>
            state.insertOperation([1], { name: 'paragraph', text: 'STALE' }));
        authorize(state, () =>
            state.setContent([{ name: 'paragraph', text: 'B' }]));
        await nextFrame();

        // A fresh op against doc B applies cleanly (not frozen by a stuck _isGoing).
        authorize(state, () =>
            state.insertOperation([1], { name: 'paragraph', text: 'C' }));
        await nextFrame();
        await nextFrame();

        const texts = (state.getState() as Array<{ text: string }>).map(b => b.text);
        expect(texts).toEqual(['B', 'C']);
    });
});

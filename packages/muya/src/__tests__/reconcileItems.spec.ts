// @vitest-environment happy-dom

import type { TState } from '../state/types';
import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

const hosts: HTMLElement[] = [];

afterEach(() => {
    for (const host of hosts.splice(0))
        host.remove();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    hosts.push(muya.domNode);
    return muya;
}

type ListState = TState & { children: (TState & { children: (TState & { text: string })[] })[] };

describe('reconciling the changed items of one list', () => {
    it('copies only the changed items and keeps the others as held', () => {
        const muya = boot('- one\n- two\n- three\n- four\n');
        try {
            const heldBefore = muya.editor.jsonState.getRoot(0) as ListState;
            const firstItem = heldBefore.children[0];
            const firstNode = muya.domNode.querySelector('li');
            const content = muya.getState() as ListState[];
            content[0].children[2].children[0].text = 'three typed';
            const changed = muya.reconcileContent(content, {
                start: 0,
                previousEnd: 1,
                nextEnd: 1,
                items: { start: 2, previousEnd: 3, nextEnd: 3 },
            });
            expect(changed).toBe(true);
            expect(muya.getState()).toEqual(content);
            const heldAfter = muya.editor.jsonState.getRoot(0) as ListState;
            expect(heldAfter.children[0]).toBe(firstItem);
            expect(heldAfter.children[2]).not.toBe(content[0].children[2]);
            expect(muya.domNode.querySelector('li')).toBe(firstNode);
            expect([...muya.domNode.querySelectorAll('span.mu-paragraph-content')].map(node => node.textContent))
                .toEqual(['one', 'two', 'three typed', 'four']);
        }
        finally {
            muya.destroy();
        }
    });

    it('inserts and removes items between the kept ones', () => {
        const muya = boot('- one\n- two\n- three\n');
        try {
            const content = muya.getState() as ListState[];
            const inserted = structuredClone(content[0].children[1]);
            inserted.children[0].text = 'inserted';
            content[0].children.splice(1, 1, inserted, structuredClone(content[0].children[1]));
            muya.reconcileContent(content, {
                start: 0,
                previousEnd: 1,
                nextEnd: 1,
                items: { start: 1, previousEnd: 2, nextEnd: 3 },
            });
            expect(muya.getState()).toEqual(content);
            expect([...muya.domNode.querySelectorAll('span.mu-paragraph-content')].map(node => node.textContent))
                .toEqual(['one', 'inserted', 'two', 'three']);
        }
        finally {
            muya.destroy();
        }
    });
});

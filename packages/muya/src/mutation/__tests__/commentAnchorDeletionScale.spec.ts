// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const inspection = vi.hoisted(() => ({ count: 0 }));

vi.mock('../operationSourceEdits', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../operationSourceEdits')
    >();
    return {
        ...actual,
        deriveOperationSourceEdits: (
            ...args: Parameters<typeof actual.deriveOperationSourceEdits>
        ) => {
            const edits = actual.deriveOperationSourceEdits(...args);
            return edits?.map((edit) => {
                const oldRange = edit.oldRange;
                return {
                    inserted: edit.inserted,
                    get oldRange() {
                        inspection.count++;
                        return oldRange;
                    },
                };
            });
        },
    };
});

const editors: Muya[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function sourceFor(pairCount: number): string {
    return Array.from({ length: pairCount }, (_, index) => {
        const label = String(index).padStart(2, '0');
        return `{==a${label}==}{>>c${label}<<}`;
    }).join('') + '\n';
}

function anchorNormalizationInspections(pairCount: number): number {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, { markdown: sourceFor(pairCount) });
    muya.init();
    editors.push(muya);
    const block = muya.editor.scrollPage!.firstContentInDescendant()!;

    inspection.count = 0;
    muya.editor.mutationGateway.run(
        { kind: 'user-command' },
        () => {
            for (let index = 0; index < pairCount; index++) {
                const label = String(index).padStart(2, '0');
                block.text = block.text.replace(`a${label}`, '');
            }
        },
    );
    expect(muya.getMarkdown()).toBe(
        Array.from({ length: pairCount }, (_, index) => {
            const label = String(index).padStart(2, '0');
            return `{>>c${label}<<}`;
        }).join('') + '\n',
    );
    return inspection.count;
}

describe('deleted comment anchor normalization scale', () => {
    it('does not rescan every source edit for every anchor pair', () => {
        const small = anchorNormalizationInspections(32);
        const large = anchorNormalizationInspections(64);

        expect(large).toBeLessThan(small * 2.7);
    });
});

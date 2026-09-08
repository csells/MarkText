import { describe, expect, it, vi } from 'vitest';
import { serializeNativeState, serializeNativeTable } from '../applyNativeOperation';

describe('native state serialization limits', () => {
    it.each([Number.NaN, Infinity, -Infinity, -1, 1.5])('rejects invalid maximumUnits %s before reading state', (maximumUnits) => {
        const states = [{
            get name(): string {
                throw new Error('State should not be traversed');
            },
        }];
        expect(serializeNativeState(states, { maximumUnits })).toBeUndefined();
    });

    it('rejects cycles and repeated state nodes without serializing them', () => {
        const children: unknown[] = [];
        const cyclic = { name: 'block-quote', children };
        children.push(cyclic);
        expect(serializeNativeState([cyclic], { maximumUnits: 100 })).toBeUndefined();
        const paragraph = { name: 'paragraph', text: 'text' };
        expect(serializeNativeState([paragraph, paragraph], { maximumUnits: 100 })).toBeUndefined();
    });

    it('accepts a finite sufficient bound and refuses an exhausted bound', () => {
        const states = [{ name: 'paragraph', text: 'text' }];
        expect(serializeNativeState(states, { maximumUnits: 100 })).toBe('text\n');
        expect(serializeNativeState(states, { maximumUnits: 0 })).toBeUndefined();
    });
});

it.each([1, 3, 6])('keeps an empty native level %s heading prefix ready for queued typing', (level) => {
    const marker = '#'.repeat(level);
    expect(serializeNativeState([{ name: 'atx-heading', meta: { level }, text: marker }])).toBe(`${marker}\n`);
});

describe('native table fragment serialization', () => {
    const table = (rows: string[][]) => ({
        name: 'table',
        children: rows.map(row => ({
            name: 'table.row',
            children: row.map(text => ({ name: 'table.cell', text, meta: { align: 'none' } })),
        })),
    });

    it('accepts an exact UTF-16 source budget independently of state metadata', () => {
        const state = table([['中', 'e\u0301'], ['ab', 'xyz']]);
        const expected = '| 中  | e\u0301   |\n| --- | --- |\n| ab  | xyz |';
        expect(serializeNativeTable(state, expected.length)).toBe(expected);
        expect(serializeNativeTable(state, expected.length - 1)).toBeUndefined();
        expect(serializeNativeState([state])).toBe(`${expected}\n`);
    });

    it('rejects malformed and ragged native tables without serializing them', () => {
        expect(serializeNativeTable({ name: 'paragraph', text: 'x' }, 100)).toBeUndefined();
        expect(serializeNativeTable({ name: 'table', children: [{ name: 'paragraph', text: 'x' }] }, 100)).toBeUndefined();
        expect(serializeNativeTable(table([['a', 'b'], ['x']]), 100)).toBeUndefined();
        const cyclic: { name: string; children: unknown[] } = { name: 'table', children: [] };
        cyclic.children.push(cyclic);
        expect(serializeNativeTable(cyclic, 100)).toBeUndefined();
    });

    it('refuses padding amplification before materializing the table', () => {
        const state = table([['wide'.repeat(100)], ...Array.from({ length: 20 }, () => ['x'])]);
        const originalRepeat = String.prototype.repeat;
        let paddingUnits = 0;
        const padding = vi.spyOn(String.prototype, 'repeat').mockImplementation(function (this: string, count: number) {
            paddingUnits += this.length * count;
            if (paddingUnits > 1000)
                throw new Error('Table serialization exceeded its allocation budget');
            return originalRepeat.call(this, count);
        });
        try {
            expect(serializeNativeTable(state, 1000)).toBeUndefined();
            expect(paddingUnits).toBe(0);
        }
        finally {
            padding.mockRestore();
        }
    });
});

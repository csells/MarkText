import { describe, expect, it } from 'vitest';
import { serializeNativeState } from '../applyNativeOperation';

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

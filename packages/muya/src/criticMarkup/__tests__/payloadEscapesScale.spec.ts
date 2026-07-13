import type { ICriticMarkupContentToken } from '../parser';
import { describe, expect, it, vi } from 'vitest';
import { ExcludedRanges } from '../excludedRanges';
import {
    parseCriticMarkupAt,
    serializeCriticMarkupDraft,
} from '../parser';
import { projectCriticMarkupToken } from '../project';

function countedString(source: string): {
    value: string;
    numericReads: () => number;
} {
    let reads = 0;
    const value = new Proxy(Object.create(null) as object, {
        get(_target, property) {
            if (property === 'length')
                return source.length;
            if (property === 'slice')
                return source.slice.bind(source);
            if (property === 'startsWith')
                return source.startsWith.bind(source);
            if (typeof property === 'string' && /^\d+$/.test(property)) {
                reads++;
                return source[Number(property)];
            }
            return undefined;
        },
    }) as unknown as string;
    return { value, numericReads: () => reads };
}

function additionToken(content: string): ICriticMarkupContentToken {
    return {
        type: 'addition',
        raw: '',
        content,
        range: { start: 0, end: 0 },
        contentRange: { start: 0, end: 0 },
        markers: {
            open: { raw: '{++', range: { start: 0, end: 3 } },
            close: { raw: '++}', range: { start: 3, end: 6 } },
        },
    };
}

describe('criticMarkup payload escape scale contracts', () => {
    it('leaves delimiter candidates byte-exact when they cross opaque boundaries', () => {
        const payload = '{++x ++}';
        const opaque = ExcludedRanges.from(payload.length, [
            { start: 1, end: 4 },
            { start: 6, end: 8 },
        ]);

        expect(serializeCriticMarkupDraft(
            { type: 'addition', content: payload },
            { content: opaque },
        )).toBe(`{++${payload}++}`);
    });

    it('escapes the real close in an overlapping close-prefix run', () => {
        const payload = '+++}';
        const serialized = serializeCriticMarkupDraft({
            type: 'addition',
            content: payload,
        });
        const token = parseCriticMarkupAt(serialized, 0)!;

        expect(serialized.slice(3, -3)).toBe(String.raw`+++\}`);
        expect(projectCriticMarkupToken(token, 'revised')).toBe(payload);
    });

    it('encodes one unowned slash run with linear indexed reads', () => {
        const slashes = '\\'.repeat(512);
        const payload = countedString(slashes);

        expect(serializeCriticMarkupDraft({
            type: 'addition',
            content: payload.value,
        })).toBe(`{++${slashes}++}`);
        expect(payload.numericReads()).toBeLessThanOrEqual(slashes.length * 16);
    });

    it('decodes one unowned slash run with linear indexed reads', () => {
        const slashes = '\\'.repeat(512);
        const payload = countedString(slashes);

        expect(projectCriticMarkupToken(
            additionToken(payload.value),
            'revised',
        )).toBe(slashes);
        expect(payload.numericReads()).toBeLessThanOrEqual(slashes.length * 16);
    });

    it('uses monotonic opaque ownership instead of rescanning every range', () => {
        const count = 128;
        const segment = '{++x';
        const payload = segment.repeat(count);
        const opaque = ExcludedRanges.from(
            payload.length,
            Array.from({ length: count }, (_, index) => ({
                start: index * segment.length + 3,
                end: index * segment.length + 4,
            })),
        );
        const overlaps = vi.spyOn(ExcludedRanges.prototype, 'overlaps');
        let overlapCalls: number;
        let serialized: string;

        try {
            serialized = serializeCriticMarkupDraft(
                { type: 'addition', content: payload },
                { content: opaque },
            );
            overlapCalls = overlaps.mock.calls.length;
        }
        finally {
            overlaps.mockRestore();
        }

        expect(serialized).toBe(`{++${payload.split('{++').join('\\{++')}++}`);
        expect(overlapCalls).toBe(0);
    });
});

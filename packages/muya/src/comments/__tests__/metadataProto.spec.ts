import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decodeCommentMetadata, encodeCommentMetadata } from '../metadata';

function encodeJson(json: string): string {
    return `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
}

const objectHasOwn = (Object as typeof Object & {
    hasOwn: (object: object, property: PropertyKey) => boolean;
}).hasOwn;

describe('comment metadata __proto__ safety', () => {
    it('round-trips a display object carrying a __proto__ key without throwing or polluting', () => {
        // A hostile file embeds the metadata as base64 JSON, so the `__proto__`
        // arrives as a real JSON key (JSON.parse makes it an own property).
        const raw = encodeJson(
            '{"version":1,"status":"open","replies":[],"display":{"__proto__":{"polluted":1},"keep":2}}',
        );

        const decoded = decodeCommentMetadata(raw);
        // Re-encoding a decoded thread happens on every edit (reply/resolve/…).
        expect(() => encodeCommentMetadata(decoded)).not.toThrow();
        // No global prototype pollution, and the display object keeps a normal
        // prototype (the `__proto__` key must be handled as data, not via the
        // prototype setter).
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        const display = decoded.display as Record<string, unknown>;
        expect(Object.getPrototypeOf(display)).toBe(Object.prototype);
        expect(display.keep).toBe(2);
        expect(objectHasOwn(display, '__proto__')).toBe(true);
    });
});

// Thermo-nuclear review: FORBIDDEN_METADATA_KEYS (an explicit Set) was 100%
// subsumed by FORBIDDEN_METADATA_KEY_PATTERN (/anchor|offset|path|range|repair/i)
// beside it. This locks that every previously-listed key is still rejected, so
// deleting the redundant Set cannot change behavior.
describe('forbidden comment metadata keys (anchor/offset/path/range/repair)', () => {
    const previouslyEnumeratedKeys = [
        'anchor',
        'anchors',
        'anchorOffset',
        'anchorOffsets',
        'alternateAnchor',
        'alternateAnchors',
        'endOffset',
        'endPath',
        'range',
        'repairCoordinate',
        'repairCoordinates',
        'startOffset',
        'startPath',
    ];

    for (const key of previouslyEnumeratedKeys) {
        it(`rejects a display key "${key}"`, () => {
            const dataUri = encodeJson(JSON.stringify({
                status: 'open',
                replies: [],
                display: { [key]: 'x' },
            }));
            expect(() => decodeCommentMetadata(dataUri)).toThrow();
        });
    }
});

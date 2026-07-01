import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decodeCommentMetadata, encodeCommentMetadata } from '../metadata';

const encodeJson = (json: string): string =>
    `data:application/json;base64,${Buffer.from(json).toString('base64')}`;

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
        expect(Object.prototype.hasOwnProperty.call(display, '__proto__')).toBe(true);
    });
});

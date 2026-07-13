import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MUYA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../muya.ts');

function sourceLineCount(source: string): number {
    return source.split(/\r\n|\r|\n/).length - (source.endsWith('\n') ? 1 : 0);
}

describe('muya public facade architecture', () => {
    it('is smaller than its upstream/develop coordinator baseline', () => {
        const source = readFileSync(MUYA_PATH, 'utf8');

        expect(sourceLineCount(source)).toBeLessThan(1712);
    });

    it('delegates mutation policy instead of owning gateway ceremony and direct-command twins', () => {
        const source = readFileSync(MUYA_PATH, 'utf8');

        expect(source).toContain('MutationCommandDispatcher');
        expect(source).not.toContain('mutationGateway.run(');
        expect(source).not.toMatch(/private\s+_[A-Za-z0-9]+Direct\s*\(/);
    });
});

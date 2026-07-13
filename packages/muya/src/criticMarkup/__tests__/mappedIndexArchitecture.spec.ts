import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MUYA_SOURCE = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../..',
);

function productionSource(relativePath: string): string {
    return readFileSync(resolve(MUYA_SOURCE, relativePath), 'utf8');
}

describe('mapped coordinate/index architecture', () => {
    it('keeps path identity and range search in the mapped-range layer', () => {
        const canonical = productionSource('mapped-range/index.ts');

        expect(canonical).toContain('export class MappedPathIndex');
        expect(canonical).toContain('export function lowerBound');
        expect(canonical).toContain('export function upperBound');
        expect(canonical).toContain('export class HalfOpenIntervalIndex');
        expect(canonical).not.toContain('JSON.stringify');
    });

    it.each([
        'mappedText.ts',
        'state/markdownSourceMap.ts',
        'mutation/operationSourceEdits.ts',
        'criticMarkup/document.ts',
        'criticMarkup/commands.ts',
        'inlineRenderer/index.ts',
        'utils/marked/criticMarkupContext.ts',
    ])('%s does not own path serialization', (relativePath) => {
        const source = productionSource(relativePath);

        expect(source).not.toMatch(/function\s+pathKey\s*\(/);
        expect(source).not.toMatch(/JSON\.stringify\([^\n]*(?:path|\.path)/i);
    });

    it('makes mutation path grouping compose the canonical path index', () => {
        const source = productionSource('mutation/operationSourceEdits.ts');

        expect(source).toMatch(/from ['"]\.\.\/mapped-range['"]/);
        expect(source).toContain('new MappedPathIndex');
        expect(source).not.toMatch(/new Map<\s*string,/);
        expect(source).not.toMatch(/JSON\.stringify\([^\n]*(?:path|\.path)/i);
        expect(source).not.toMatch(/\.path as TBlockPath/);
    });

    it('makes CriticMarkupDocument compose canonical indexes', () => {
        const source = productionSource('criticMarkup/document.ts');

        expect(source).toMatch(/from ['"]\.\.\/mapped-range['"]/);
        expect(source).toContain('MappedPathIndex');
        expect(source).toContain('HalfOpenIntervalIndex');
        expect(source).not.toMatch(/function\s+sourceIndex(?:Lower|Upper)Bound/);
        expect(source).not.toMatch(/Map<string,\s*(?:readonly\s+)?IPathItemIndexEntry/);
    });

    it('keeps every cached document index behind runtime-private identity', () => {
        const source = productionSource('criticMarkup/document.ts');

        for (const name of [
            'itemsById',
            'itemsByParent',
            'itemsByPath',
            'sourceIntervals',
            'fragmentPaths',
        ]) {
            expect(source).toContain(`readonly #${name}`);
            expect(source).not.toContain(`private readonly _${name}`);
        }
    });

    it('keeps every SourceMap query index behind runtime-private identity', () => {
        const source = productionSource('mappedText.ts');

        for (const name of [
            'pathLookupIndexes',
            'firstBoundaryBySourceOffset',
            'firstSpanBySourceEnd',
            'nodeRangeByPath',
        ]) {
            expect(source).toContain(`readonly #${name}`);
            expect(source).not.toContain(`private readonly _${name}`);
        }
    });
});

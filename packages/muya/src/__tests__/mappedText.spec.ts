import type { TLocalRange, TSourceRange } from '../mappedText';
import type { TMarkdownStatePath } from '../state/markdownSourceMap';
import type { TMarkedParserPath } from '../utils/marked/criticMarkupContext';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    localOffset,
    localRange,
    MappedText,
    MappedTextWriter,
    sourceOffset,
    sourceRange,
} from '../mappedText';
import { markdownStatePath } from '../state/markdownSourceMap';
import { markedParserPath } from '../utils/marked/criticMarkupContext';

function statePath(...parts: Array<string | number>): TMarkdownStatePath {
    return markdownStatePath(parts);
}

function mappedChunk(
    text: string,
    path: TMarkdownStatePath,
    start: number,
) {
    const writer = new MappedTextWriter<TMarkdownStatePath>();
    writer.appendMapped(text, path, localOffset(start));

    return writer.build();
}

function plainChunk(text: string) {
    const writer = new MappedTextWriter<TMarkdownStatePath>();
    writer.appendPlain(text);

    return writer.build();
}

function sourceSection(source: string, start: string, end: string): string {
    const startOffset = source.indexOf(start);
    const endOffset = source.indexOf(end, startOffset + start.length);
    if (startOffset < 0 || endOffset < 0)
        throw new Error(`Missing mapped-text source section: ${start}`);

    return source.slice(startOffset, endOffset);
}

describe('mappedText', () => {
    it('keeps every SourceMap query index behind runtime-private identity', () => {
        const textPath = statePath(0, 'text');
        const nodePath = statePath(0);
        const spanMapped = new MappedText('a', [{
            path: textPath,
            localStart: localOffset(0),
            localEnd: localOffset(1),
            sourceStart: sourceOffset(0),
            sourceEnd: sourceOffset(1),
        }]);
        const boundaryMapped = new MappedText('a', [], [], [{
            path: textPath,
            localOffset: localOffset(0),
            sourceOffset: sourceOffset(0),
        }]);
        const nodeMapped = new MappedText('a', [], [{
            path: nodePath,
            sourceStart: sourceOffset(0),
            sourceEnd: sourceOffset(1),
        }]);
        const poison = (sourceMap: object, name: string) => {
            const exposed = (
                sourceMap as Record<string, { clear: () => void } | undefined>
            )[name];
            exposed?.clear();
            return exposed;
        };

        const exposed = [
            poison(spanMapped.sourceMap, '_pathLookupIndexes'),
            poison(boundaryMapped.sourceMap, '_firstBoundaryBySourceOffset'),
            poison(spanMapped.sourceMap, '_firstSpanBySourceEnd'),
            poison(nodeMapped.sourceMap, '_nodeRangeByPath'),
        ];

        expect(exposed).toEqual([undefined, undefined, undefined, undefined]);
        expect(spanMapped.sourceMap.localToSource(
            textPath,
            localOffset(0),
        )).toBe(sourceOffset(0));
        expect(spanMapped.sourceMap.sourceToLocal(sourceOffset(1))).toEqual({
            path: textPath,
            offset: localOffset(1),
        });
        expect(boundaryMapped.sourceMap.sourceToLocal(sourceOffset(0))).toEqual({
            path: textPath,
            offset: localOffset(0),
        });
        expect(nodeMapped.sourceMap.nodeRange(nodePath)).toEqual({
            start: sourceOffset(0),
            end: sourceOffset(1),
        });
    });

    it('answers repeated lookups from construction-time indexes without query-time array walks', () => {
        const textPath = statePath(0, 'text');
        const nodePath = statePath(0);
        const mapped = new MappedText(
            'a<>b',
            [
                {
                    path: textPath,
                    localStart: localOffset(0),
                    localEnd: localOffset(1),
                    sourceStart: sourceOffset(0),
                    sourceEnd: sourceOffset(1),
                },
                {
                    path: textPath,
                    localStart: localOffset(1),
                    localEnd: localOffset(2),
                    sourceStart: sourceOffset(3),
                    sourceEnd: sourceOffset(4),
                },
            ],
            [
                {
                    path: nodePath,
                    sourceStart: sourceOffset(0),
                    sourceEnd: sourceOffset(2),
                },
                {
                    path: nodePath,
                    sourceStart: sourceOffset(2),
                    sourceEnd: sourceOffset(4),
                },
            ],
            [{
                path: textPath,
                localOffset: localOffset(1),
                sourceOffset: sourceOffset(1),
            }],
        );
        const sourceAtBoundary = mapped.sourceMap.localToSource(
            textPath,
            localOffset(1),
            'previous',
        );
        const sourceAfterGap = mapped.sourceMap.localToSource(
            textPath,
            localOffset(1),
            'next',
        );
        const localBeforeGap = mapped.sourceMap.sourceToLocal(
            sourceOffset(2),
            'previous',
        );
        const localAfterGap = mapped.sourceMap.sourceToLocal(
            sourceOffset(2),
            'next',
        );
        const pathRange = mapped.sourceMap.rangeForPath(textPath);
        const repeatedPathRange = mapped.sourceMap.rangeForPath(textPath);
        const nodeRange = mapped.sourceMap.nodeRange(nodePath);
        const repeatedNodeRange = mapped.sourceMap.nodeRange(nodePath);

        expect(sourceAtBoundary).toBe(sourceOffset(1));
        expect(sourceAfterGap).toBe(sourceOffset(3));
        expect(localBeforeGap).toEqual({
            path: textPath,
            offset: localOffset(1),
        });
        expect(localAfterGap).toEqual({
            path: textPath,
            offset: localOffset(1),
        });
        expect(pathRange).toEqual({
            start: sourceOffset(0),
            end: sourceOffset(4),
        });
        expect(pathRange).toBe(repeatedPathRange);
        expect(Object.isFrozen(pathRange)).toBe(true);
        expect(nodeRange).toEqual({
            start: sourceOffset(0),
            end: sourceOffset(4),
        });
        expect(nodeRange).toBe(repeatedNodeRange);
        expect(Object.isFrozen(nodeRange)).toBe(true);

        const source = readFileSync(
            resolve(dirname(fileURLToPath(import.meta.url)), '../mappedText.ts'),
            'utf8',
        );
        const localLookup = sourceSection(
            source,
            '    localToSource(',
            '    sourceToLocal(',
        );
        const sourceLookup = sourceSection(
            source,
            '    sourceToLocal(',
            '    rangeForPath(',
        );
        const pathRangeLookup = sourceSection(
            source,
            '    rangeForPath(',
            '    nodeRange(',
        );
        const nodeRangeLookup = sourceSection(
            source,
            '    nodeRange(',
            '\n}\n\n/** Immutable text paired',
        );

        expect(localLookup).toContain('#pathLookupIndexes.get');
        expect(localLookup).toContain('lastSpanAtOrBefore(');
        expect(sourceLookup).toContain('#firstBoundaryBySourceOffset.get');
        expect(sourceLookup).toContain('lastSpanAtOrBefore(');
        expect(sourceLookup).toContain('firstSpanAtOrAfter(');
        expect(pathRangeLookup).toContain('#pathLookupIndexes.get');
        expect(nodeRangeLookup).toContain('#nodeRangeByPath.get');
        for (const lookup of [
            localLookup,
            sourceLookup,
            pathRangeLookup,
            nodeRangeLookup,
        ]) {
            expect(lookup).not.toMatch(/\bfor\s*\(|\.(?:find|map)\s*\(/);
        }
    });

    it('writes structural and identity-mapped text through one immutable value', () => {
        const path = statePath(0, 'children', 1, 'text');
        const writer = new MappedTextWriter<TMarkdownStatePath>();
        writer.appendPlain('> ');
        writer.appendMapped('alpha', path, localOffset(0));
        writer.appendPlain('\n> ');
        writer.appendMapped('beta', path, localOffset(5));

        const mapped = writer.build();

        expect(mapped.text).toBe('> alpha\n> beta');
        expect(mapped.sourceMap.localToSource(path, localOffset(2)))
            .toBe(sourceOffset(4));
        expect(mapped.sourceMap.localToSource(path, localOffset(6)))
            .toBe(sourceOffset(11));
        expect(mapped.sourceMap.sourceToLocal(sourceOffset(3))).toEqual({
            path,
            offset: localOffset(1),
        });
        expect(mapped.sourceMap.sourceToLocal(sourceOffset(8))).toBeNull();
        expect(mapped.sourceMap.rangeForPath(path)).toEqual({
            start: sourceOffset(2),
            end: sourceOffset(14),
        });
    });

    it('concatenates values while shifting source coordinates exactly once', () => {
        const path = statePath(0, 'text');
        const joined = MappedText.concat([
            mappedChunk('alpha', path, 0),
            plainChunk(' | '),
            mappedChunk('beta', path, 5),
        ]);

        expect(joined.text).toBe('alpha | beta');
        expect(joined.sourceMap.localToSource(path, localOffset(1)))
            .toBe(sourceOffset(1));
        expect(joined.sourceMap.localToSource(path, localOffset(6)))
            .toBe(sourceOffset(9));
        expect(joined.sourceMap.sourceToLocal(sourceOffset(6))).toBeNull();
        expect(joined.sourceMap.sourceToLocal(sourceOffset(10))).toEqual({
            path,
            offset: localOffset(7),
        });
    });

    it('concatenates more mapped spans than the engine argument limit', () => {
        const spanCount = 200_000;
        const path = statePath(0, 'text');
        const text = 'x'.repeat(spanCount);
        const fragmented = new MappedText(
            text,
            Array.from({ length: spanCount }, (_, index) => ({
                path,
                localStart: localOffset(index),
                localEnd: localOffset(index + 1),
                sourceStart: sourceOffset(index),
                sourceEnd: sourceOffset(index + 1),
            })),
        );

        const joined = MappedText.concat([fragmented]);

        expect(joined.text).toBe(text);
        expect(joined.sourceMap.spans).toHaveLength(1);
        expect(joined.sourceMap.localToSource(path, localOffset(spanCount - 1)))
            .toBe(sourceOffset(spanCount - 1));
    }, 60_000);

    it('coalesces only adjacent identity spans with the same structural path', () => {
        const numericPath = statePath(0, 1);
        const stringPath = statePath(0, '1');
        const mapped = new MappedText('abcd', [
            {
                path: statePath(0, 1),
                localStart: localOffset(0),
                localEnd: localOffset(1),
                sourceStart: sourceOffset(0),
                sourceEnd: sourceOffset(1),
            },
            {
                path: numericPath,
                localStart: localOffset(1),
                localEnd: localOffset(2),
                sourceStart: sourceOffset(1),
                sourceEnd: sourceOffset(2),
            },
            {
                path: stringPath,
                localStart: localOffset(0),
                localEnd: localOffset(1),
                sourceStart: sourceOffset(2),
                sourceEnd: sourceOffset(3),
            },
            {
                path: numericPath,
                localStart: localOffset(2),
                localEnd: localOffset(3),
                sourceStart: sourceOffset(3),
                sourceEnd: sourceOffset(4),
            },
        ]);

        expect(mapped.sourceMap.spans).toHaveLength(3);
        expect(mapped.sourceMap.spans[0]).toMatchObject({
            path: numericPath,
            localStart: localOffset(0),
            localEnd: localOffset(2),
            sourceStart: sourceOffset(0),
            sourceEnd: sourceOffset(2),
        });
        expect(mapped.sourceMap.sourceToLocal(sourceOffset(2))).toEqual({
            path: stringPath,
            offset: localOffset(0),
        });
        expect(mapped.sourceMap.sourceToLocal(sourceOffset(3))).toEqual({
            path: numericPath,
            offset: localOffset(2),
        });
    });

    it('concatenates more mapped nodes than the engine argument limit', () => {
        const nodeCount = 200_000;
        const path = statePath(0);
        const text = 'x'.repeat(nodeCount);
        const fragmented = new MappedText(
            text,
            [],
            Array.from({ length: nodeCount }, (_, index) => ({
                path,
                sourceStart: sourceOffset(index),
                sourceEnd: sourceOffset(index + 1),
            })),
        );

        const joined = MappedText.concat([fragmented]);

        expect(joined.sourceMap.nodes).toHaveLength(nodeCount);
        expect(joined.sourceMap.nodeRange(path)).toEqual({
            start: sourceOffset(0),
            end: sourceOffset(nodeCount),
        });
    }, 60_000);

    it('concatenates more mapped boundaries than the engine argument limit', () => {
        const boundaryCount = 200_000;
        const path = statePath(0, 'text');
        const text = 'x'.repeat(boundaryCount);
        const fragmented = new MappedText(
            text,
            [],
            [],
            Array.from({ length: boundaryCount }, (_, index) => ({
                path,
                localOffset: localOffset(index),
                sourceOffset: sourceOffset(index),
            })),
        );

        const joined = MappedText.concat([fragmented]);

        expect(joined.sourceMap.boundaries).toHaveLength(boundaryCount);
        expect(joined.sourceMap.localToSource(
            path,
            localOffset(boundaryCount - 1),
        )).toBe(sourceOffset(boundaryCount - 1));
    }, 60_000);

    it('slices mapped values by branded source offsets and rebases mappings', () => {
        const path = statePath(0, 'text');
        const joined = MappedText.concat([
            mappedChunk('alpha', path, 0),
            plainChunk(' | '),
            mappedChunk('beta', path, 5),
        ]);

        const sliced = joined.slice(sourceOffset(2), sourceOffset(10));

        expect(sliced.text).toBe('pha | be');
        expect(sliced.sourceMap.localToSource(path, localOffset(2)))
            .toBe(sourceOffset(0));
        expect(sliced.sourceMap.localToSource(path, localOffset(5)))
            .toBe(sourceOffset(6));
        expect(sliced.sourceMap.sourceToLocal(sourceOffset(7))).toEqual({
            path,
            offset: localOffset(6),
        });
        expect(sliced.sourceMap.rangeForPath(path)).toEqual({
            start: sourceOffset(0),
            end: sourceOffset(8),
        });
    });

    it('carries nested structural node ranges through concat and slice', () => {
        const parentPath = statePath(0);
        const childPath = statePath(0, 'children', 0);
        const child = mappedChunk('alpha', statePath(0, 'children', 0, 'text'), 0)
            .withNode(childPath);
        const document = MappedText.concat([
            plainChunk('> '),
            child,
            plainChunk('\n'),
        ]).withNode(parentPath);

        expect(document.sourceMap.nodeRange(parentPath)).toEqual({
            start: sourceOffset(0),
            end: sourceOffset(8),
        });
        expect(document.sourceMap.nodeRange(childPath)).toEqual({
            start: sourceOffset(2),
            end: sourceOffset(7),
        });

        const sliced = document.slice(sourceOffset(1), sourceOffset(6));
        expect(sliced.text).toBe(' alph');
        expect(sliced.sourceMap.nodeRange(parentPath)).toEqual({
            start: sourceOffset(0),
            end: sourceOffset(5),
        });
        expect(sliced.sourceMap.nodeRange(childPath)).toEqual({
            start: sourceOffset(1),
            end: sourceOffset(5),
        });
    });

    it('uses explicit leaf boundaries for empty text and generated escapes', () => {
        const emptyPath = statePath(0, 'text');
        const emptyWriter = new MappedTextWriter<TMarkdownStatePath>();
        emptyWriter.appendBoundary(emptyPath, localOffset(0));
        emptyWriter.appendPlain('\n');
        const empty = emptyWriter.build();

        expect(empty.sourceMap.localToSource(emptyPath, localOffset(0)))
            .toBe(sourceOffset(0));

        const tablePath = statePath(1, 'children', 1, 'children', 0, 'text');
        const escapedWriter = new MappedTextWriter<TMarkdownStatePath>();
        escapedWriter.appendMapped('a', tablePath, localOffset(0));
        // The logical caret before `|` belongs before its generated escape.
        escapedWriter.appendBoundary(tablePath, localOffset(1));
        escapedWriter.appendPlain('\\');
        escapedWriter.appendMapped('|b', tablePath, localOffset(1));
        const escaped = escapedWriter.build();

        expect(escaped.text).toBe('a\\|b');
        expect(escaped.sourceMap.localToSource(tablePath, localOffset(1)))
            .toBe(sourceOffset(1));
    });

    it('brands source/local offsets and independent path domains', () => {
        const state = statePath(0, 'text');
        const parser: TMarkedParserPath = markedParserPath(['paragraph', 0]);
        const writer = new MappedTextWriter<TMarkdownStatePath>();
        writer.appendMapped('text', state, localOffset(0));
        const mapped = writer.build();

        const invalidCallsMustNotCompile = () => {
            // @ts-expect-error — source offsets are not local leaf offsets.
            mapped.sourceMap.localToSource(state, sourceOffset(0));
            // @ts-expect-error — local offsets cannot select a source slice.
            mapped.slice(localOffset(0), sourceOffset(1));
            // @ts-expect-error — parser paths cannot address a state-path map.
            mapped.sourceMap.localToSource(parser, localOffset(0));
        };

        expect(mapped.text).toBe('text');
        expect(invalidCallsMustNotCompile).toBeTypeOf('function');
    });

    it('brands and validates local and source range domains', () => {
        const local = localRange(1, 2);
        const source = sourceRange(3, 4);
        const consumeLocal = (_range: TLocalRange) => undefined;
        const consumeSource = (_range: TSourceRange) => undefined;
        const invalidCallsMustNotCompile = () => {
            // @ts-expect-error — source ranges cannot enter local APIs.
            consumeLocal(source);
            // @ts-expect-error — local ranges cannot enter source APIs.
            consumeSource(local);
        };

        expect(local).toEqual({ start: 1, end: 2 });
        expect(source).toEqual({ start: 3, end: 4 });
        expect(() => localRange(2, 1)).toThrow(RangeError);
        expect(() => sourceRange(2, 1)).toThrow(RangeError);
        expect(invalidCallsMustNotCompile).toBeTypeOf('function');
    });
});

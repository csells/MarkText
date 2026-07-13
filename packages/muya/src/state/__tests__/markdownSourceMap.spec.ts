import type { TState } from '../types';
import { describe, expect, it } from 'vitest';
import { localOffset, sourceOffset } from '../../mappedText';
import {
    fromMarkdownSourceMap,
    markdownStatePath,
} from '../markdownSourceMap';
import StateToMarkdown from '../stateToMarkdown';

function leafAt(
    sourceMap: ReturnType<StateToMarkdown['generateWithSourceMap']>,
    path: Array<string | number>,
) {
    return sourceMap.leaves.find(leaf =>
        JSON.stringify(leaf.path) === JSON.stringify(path));
}

describe('stateToMarkdown.generateWithSourceMap', () => {
    it('emits the immutable branded mapping directly for production consumers', () => {
        const exporter = new StateToMarkdown();
        const mapped = exporter.generateMapped([
            { name: 'paragraph', text: 'alpha' },
        ]);
        const path = markdownStatePath([0, 'text']);

        expect(mapped.text).toBe('alpha\n');
        expect(mapped.sourceMap.localToSource(path, localOffset(2)))
            .toBe(sourceOffset(2));
        expect(Object.isFrozen(mapped.sourceMap.spans)).toBe(true);
        expect(Object.isFrozen(mapped.sourceMap.spans[0].path)).toBe(true);
        expect(exporter.generateWithSourceMap([
            { name: 'paragraph', text: 'alpha' },
        ]).markdown).toBe(mapped.text);
    });

    it('returns byte-identical Markdown while mapping top-level paragraph and heading text', () => {
        const states: TState[] = [
            { name: 'paragraph', text: 'alpha\nbeta' },
            { name: 'atx-heading', meta: { level: 2 }, text: '##   Title  ' },
            {
                name: 'setext-heading',
                meta: { level: 2, underline: '---' },
                text: '  Heading  ',
            },
        ];
        const exporter = new StateToMarkdown();

        const result = exporter.generateWithSourceMap(states);

        expect(result.markdown).toBe(exporter.generate(states));
        expect(result.markdown).toBe('alpha\nbeta\n\n## Title\n\nHeading\n---\n');
        expect(result.leaves.map(leaf => leaf.path)).toEqual([
            [0, 'text'],
            [1, 'text'],
            [2, 'text'],
        ]);
        expect(leafAt(result, [0, 'text'])?.pieces).toEqual([
            { localStart: 0, localEnd: 10, sourceStart: 0, sourceEnd: 10 },
        ]);
        expect(leafAt(result, [1, 'text'])?.pieces).toEqual([
            { localStart: 0, localEnd: 2, sourceStart: 12, sourceEnd: 14 },
            { localStart: 5, localEnd: 10, sourceStart: 15, sourceEnd: 20 },
        ]);
        expect(leafAt(result, [2, 'text'])?.pieces).toEqual([
            { localStart: 2, localEnd: 9, sourceStart: 22, sourceEnd: 29 },
        ]);
    });

    it('maps blockquote text through inserted prefixes using the live OT path', () => {
        const states: TState[] = [{
            name: 'block-quote',
            children: [{ name: 'paragraph', text: 'quoted\nline' }],
        }];
        const exporter = new StateToMarkdown();

        const result = exporter.generateWithSourceMap(states);

        expect(result.markdown).toBe(exporter.generate(states));
        expect(result.markdown).toBe('> quoted\n> line\n');
        expect(result.leaves).toEqual([{
            path: [0, 'children', 0, 'text'],
            pieces: [
                { localStart: 0, localEnd: 7, sourceStart: 2, sourceEnd: 9 },
                { localStart: 7, localEnd: 11, sourceStart: 11, sourceEnd: 15 },
            ],
        }]);
    });

    it('maps list-item text after stripping only the first generated content indent', () => {
        const states: TState[] = [{
            name: 'bullet-list',
            meta: { marker: '-', loose: false },
            children: [{
                name: 'list-item',
                children: [{ name: 'paragraph', text: 'item\nnext' }],
            }],
        }];
        const exporter = new StateToMarkdown();

        const result = exporter.generateWithSourceMap(states);

        expect(result.markdown).toBe(exporter.generate(states));
        expect(result.markdown).toBe('- item\n  next\n');
        expect(result.leaves).toEqual([{
            path: [0, 'children', 0, 'children', 0, 'text'],
            pieces: [
                { localStart: 0, localEnd: 5, sourceStart: 2, sourceEnd: 7 },
                { localStart: 5, localEnd: 9, sourceStart: 9, sourceEnd: 13 },
            ],
        }]);
    });

    it('keeps an empty supported leaf addressable even though it has no source pieces', () => {
        const result = new StateToMarkdown().generateWithSourceMap([
            { name: 'paragraph', text: '' },
        ]);

        expect(result.markdown).toBe('\n');
        expect(result.leaves).toEqual([{
            path: [0, 'text'],
            pieces: [],
        }]);
    });

    it('publishes root and nested state-node ranges in the canonical map', () => {
        const result = new StateToMarkdown().generateWithSourceMap([{
            name: 'block-quote',
            children: [{ name: 'paragraph', text: 'quoted' }],
        }]);
        const mapped = fromMarkdownSourceMap(result);

        expect(mapped.sourceMap.nodeRange(markdownStatePath([]))).toEqual({
            start: sourceOffset(0),
            end: sourceOffset(result.markdown.length),
        });
        expect(mapped.sourceMap.nodeRange(markdownStatePath([0]))).toEqual({
            start: sourceOffset(0),
            end: sourceOffset(result.markdown.length),
        });
        const child = mapped.sourceMap.nodeRange(
            markdownStatePath([0, 'children', 0]),
        );
        expect(child).not.toBeNull();
        expect(child!.start).toBeGreaterThanOrEqual(0);
        expect(child!.end).toBeLessThanOrEqual(result.markdown.length);
        expect(child!.start).toBeLessThan(child!.end);
    });

    it('maps an empty paragraph caret to its structural insertion boundary', () => {
        const result = new StateToMarkdown().generateWithSourceMap([
            { name: 'paragraph', text: '' },
        ]);
        const mapped = fromMarkdownSourceMap(result);

        expect(mapped.sourceMap.localToSource(
            markdownStatePath([0, 'text']),
            localOffset(0),
        ))
            .toBe(sourceOffset(0));
    });

    it('maps table-cell text while leaving generated padding and pipe escapes structural', () => {
        const states: TState[] = [{
            name: 'table',
            children: [
                {
                    name: 'table.row',
                    children: [{
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: '{++head++}',
                    }],
                },
                {
                    name: 'table.row',
                    children: [{
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: 'a|b',
                    }],
                },
            ],
        }];
        const exporter = new StateToMarkdown();
        const result = exporter.generateWithSourceMap(states);

        expect(result.markdown).toBe(exporter.generate(states));
        expect(result.markdown).toContain('| {++head++} |');
        expect(result.markdown).toContain('| a\\|b');
        for (const [path, text] of [
            [[0, 'children', 0, 'children', 0, 'text'], '{++head++}'],
            [[0, 'children', 1, 'children', 0, 'text'], 'a|b'],
        ] as const) {
            const leaf = leafAt(result, [...path]);
            expect(leaf).toBeDefined();
            for (const piece of leaf!.pieces) {
                expect(result.markdown.slice(piece.sourceStart, piece.sourceEnd))
                    .toBe(text.slice(piece.localStart, piece.localEnd));
            }
        }
    });

    it('maps a caret before an escaped table pipe before the generated backslash', () => {
        const path = [0, 'children', 1, 'children', 0, 'text'] as const;
        const result = new StateToMarkdown().generateWithSourceMap([{
            name: 'table',
            children: [
                {
                    name: 'table.row',
                    children: [{
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: 'head',
                    }],
                },
                {
                    name: 'table.row',
                    children: [{
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: 'a|b',
                    }],
                },
            ],
        }]);
        const mapped = fromMarkdownSourceMap(result);
        const escapeOffset = result.markdown.indexOf('\\|');
        const insertionOffset = mapped.sourceMap.localToSource(
            markdownStatePath(path),
            localOffset(1),
        );

        expect(escapeOffset).toBeGreaterThanOrEqual(0);
        expect(insertionOffset).toBe(sourceOffset(escapeOffset));
        const inserted = `${result.markdown.slice(0, insertionOffset!)
        }x${
            result.markdown.slice(insertionOffset!)}`;
        expect(inserted).toContain('ax\\|b');
        expect(inserted).not.toContain('a\\x|b');
    });
});

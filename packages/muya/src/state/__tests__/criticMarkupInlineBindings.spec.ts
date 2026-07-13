import { describe, expect, it } from 'vitest';
import { analyzeCriticMarkupMarkdownState } from '../../criticMarkup/markdownState';
import { snapshotCriticMarkupParserOptions } from '../../utils/marked/criticMarkupSourceContext';
import { MarkdownToState } from '../markdownToState';
import StateToMarkdown from '../stateToMarkdown';

const STATE_OPTIONS = {
    footnote: false,
    frontMatter: false,
    isGitlabCompatibilityEnabled: false,
    math: false,
    trimUnnecessaryCodeBlockEmptyLines: false,
} as const;

const NORMALIZED_STATE_OPTIONS = {
    listIndentation: 1,
    trimUnnecessaryCodeBlockEmptyLines: false,
    lex: snapshotCriticMarkupParserOptions({
        breaks: false,
        footnote: false,
        frontMatter: false,
        gfm: true,
        isGitlabCompatibilityEnabled: false,
        math: false,
        maxBlockNesting: 128,
        pedantic: false,
        superSubScript: true,
    }),
} as const;

function lower(source: string) {
    return new MarkdownToState(STATE_OPTIONS).generateWithMetadata(source);
}

describe('parser-native inline CriticMarkup state bindings', () => {
    it('binds a simple addition to its exact produced leaf segments', () => {
        const source = 'x {++same++} y\n';
        const lowered = lower(source);
        const item = lowered.criticMarkup?.items[0];
        if (!item)
            throw new TypeError('Fixture produced no CriticMarkup item.');

        expect(lowered.states).toMatchObject([{
            name: 'paragraph',
            text: source.trimEnd(),
        }]);
        expect(lowered.criticMarkupBindings.inline).toEqual([{
            path: [0, 'text'],
            itemId: item.id,
            criticType: 'addition',
            arm: 'content',
            role: 'only',
            localRange: { start: 2, end: 12 },
            sourceRange: { start: 2, end: 12 },
            segments: [
                {
                    kind: 'marker',
                    marker: 'open',
                    localRange: { start: 2, end: 5 },
                    sourceRange: { start: 2, end: 5 },
                },
                {
                    kind: 'content',
                    arm: 'content',
                    localRange: { start: 5, end: 9 },
                    sourceRange: { start: 5, end: 9 },
                },
                {
                    kind: 'marker',
                    marker: 'close',
                    localRange: { start: 9, end: 12 },
                    sourceRange: { start: 9, end: 12 },
                },
            ],
        }]);
    });

    it('keeps substitution arms as linked parser fragments', () => {
        const source = 'A {~~old~>new~~} Z\n';
        const lowered = lower(source);
        const item = lowered.criticMarkup?.items[0];
        if (!item)
            throw new TypeError('Fixture produced no CriticMarkup item.');

        expect(lowered.criticMarkupBindings.inline).toEqual([
            {
                path: [0, 'text'],
                itemId: item.id,
                criticType: 'substitution',
                arm: 'old',
                role: 'start',
                localRange: { start: 2, end: 10 },
                sourceRange: { start: 2, end: 10 },
                segments: [
                    {
                        kind: 'marker',
                        marker: 'open',
                        localRange: { start: 2, end: 5 },
                        sourceRange: { start: 2, end: 5 },
                    },
                    {
                        kind: 'content',
                        arm: 'old',
                        localRange: { start: 5, end: 8 },
                        sourceRange: { start: 5, end: 8 },
                    },
                    {
                        kind: 'marker',
                        marker: 'separator',
                        localRange: { start: 8, end: 10 },
                        sourceRange: { start: 8, end: 10 },
                    },
                ],
            },
            {
                path: [0, 'text'],
                itemId: item.id,
                criticType: 'substitution',
                arm: 'new',
                role: 'end',
                localRange: { start: 10, end: 16 },
                sourceRange: { start: 10, end: 16 },
                segments: [
                    {
                        kind: 'content',
                        arm: 'new',
                        localRange: { start: 10, end: 13 },
                        sourceRange: { start: 10, end: 13 },
                    },
                    {
                        kind: 'marker',
                        marker: 'close',
                        localRange: { start: 13, end: 16 },
                        sourceRange: { start: 13, end: 16 },
                    },
                ],
            },
        ]);
    });

    it('binds nested items from parser identity without flattening ownership', () => {
        const source = '{++outer {--inner--} tail++}\n';
        const lowered = lower(source);
        const items = lowered.criticMarkup?.items;
        if (!items || items.length !== 2)
            throw new TypeError('Fixture did not produce two CriticMarkup items.');
        const [outer, inner] = items;

        expect(lowered.criticMarkupBindings.inline).toEqual([
            {
                path: [0, 'text'],
                itemId: outer.id,
                criticType: 'addition',
                arm: 'content',
                role: 'only',
                localRange: { start: 0, end: 28 },
                sourceRange: { start: 0, end: 28 },
                segments: [
                    {
                        kind: 'marker',
                        marker: 'open',
                        localRange: { start: 0, end: 3 },
                        sourceRange: { start: 0, end: 3 },
                    },
                    {
                        kind: 'content',
                        arm: 'content',
                        localRange: { start: 3, end: 25 },
                        sourceRange: { start: 3, end: 25 },
                    },
                    {
                        kind: 'marker',
                        marker: 'close',
                        localRange: { start: 25, end: 28 },
                        sourceRange: { start: 25, end: 28 },
                    },
                ],
            },
            {
                path: [0, 'text'],
                itemId: inner.id,
                criticType: 'deletion',
                arm: 'content',
                role: 'only',
                localRange: { start: 9, end: 20 },
                sourceRange: { start: 9, end: 20 },
                segments: [
                    {
                        kind: 'marker',
                        marker: 'open',
                        localRange: { start: 9, end: 12 },
                        sourceRange: { start: 9, end: 12 },
                    },
                    {
                        kind: 'content',
                        arm: 'content',
                        localRange: { start: 12, end: 17 },
                        sourceRange: { start: 12, end: 17 },
                    },
                    {
                        kind: 'marker',
                        marker: 'close',
                        localRange: { start: 17, end: 20 },
                        sourceRange: { start: 17, end: 20 },
                    },
                ],
            },
        ]);
    });

    it('distinguishes identical repeated text solely by parser ranges', () => {
        const source = 'same {++same++} same {++same++} same\n';
        const lowered = lower(source);
        const items = lowered.criticMarkup?.items;
        if (!items || items.length !== 2)
            throw new TypeError('Fixture did not produce two CriticMarkup items.');

        expect(lowered.criticMarkupBindings.inline.map(binding => ({
            itemId: binding.itemId,
            localRange: binding.localRange,
            sourceRange: binding.sourceRange,
        }))).toEqual([
            {
                itemId: items[0].id,
                localRange: { start: 5, end: 15 },
                sourceRange: { start: 5, end: 15 },
            },
            {
                itemId: items[1].id,
                localRange: { start: 21, end: 31 },
                sourceRange: { start: 21, end: 31 },
            },
        ]);
    });

    it('shifts ATX inline bindings into the produced heading text path', () => {
        const source = '# x {++same++}\n';
        const lowered = lower(source);

        expect(lowered.states).toMatchObject([{
            name: 'atx-heading',
            text: '# x {++same++}',
        }]);
        expect(lowered.criticMarkupBindings.inline.map(binding => ({
            path: binding.path,
            localRange: binding.localRange,
            sourceRange: binding.sourceRange,
        }))).toEqual([{
            path: [0, 'text'],
            localRange: { start: 4, end: 14 },
            sourceRange: { start: 4, end: 14 },
        }]);
    });

    it('binds a GFM table cell to its produced nested leaf path', () => {
        const source = [
            '| A {++same++} | B |',
            '| --- | --- |',
            '',
        ].join('\n');
        const lowered = lower(source);

        const table = lowered.states[0];
        expect(table.name).toBe('table');
        if (table.name !== 'table')
            throw new TypeError('Fixture did not lower to a table.');
        expect(table.children[0].children[0]).toMatchObject({
            name: 'table.cell',
            text: 'A {++same++}',
        });
        expect(lowered.criticMarkupBindings.inline.map(binding => ({
            path: binding.path,
            localRange: binding.localRange,
            sourceRange: binding.sourceRange,
        }))).toEqual([{
            path: [0, 'children', 0, 'children', 0, 'text'],
            localRange: { start: 2, end: 12 },
            sourceRange: { start: 4, end: 14 },
        }]);
    });

    it('preserves piecewise binding segments across a table escape gap', () => {
        const source = [
            '| A {++x \\| y++} | B |',
            '| --- | --- |',
            '',
        ].join('\n');
        const lowered = lower(source);
        const [binding] = lowered.criticMarkupBindings.inline;
        if (!binding)
            throw new TypeError('Fixture produced no inline binding.');

        expect(binding).toMatchObject({
            path: [0, 'children', 0, 'children', 0, 'text'],
            localRange: { start: 2, end: 13 },
            sourceRange: { start: 4, end: 16 },
            segments: [
                {
                    kind: 'marker',
                    marker: 'open',
                    localRange: { start: 2, end: 5 },
                    sourceRange: { start: 4, end: 7 },
                },
                {
                    kind: 'content',
                    arm: 'content',
                    localRange: { start: 5, end: 7 },
                    sourceRange: { start: 7, end: 9 },
                },
                {
                    kind: 'content',
                    arm: 'content',
                    localRange: { start: 7, end: 10 },
                    sourceRange: { start: 10, end: 13 },
                },
                {
                    kind: 'marker',
                    marker: 'close',
                    localRange: { start: 10, end: 13 },
                    sourceRange: { start: 13, end: 16 },
                },
            ],
        });
        expect(binding.localRange.end - binding.localRange.start)
            .toBe(binding.sourceRange.end - binding.sourceRange.start - 1);
        expect(new StateToMarkdown({ listIndentation: 4 })
            .generate(lowered.states))
            .toBe(source);
    });

    it('keeps dense inline binding output linear in parser item count', () => {
        const itemCount = 128;
        const source = `${Array.from(
            { length: itemCount },
            () => '{++same++}',
        ).join(' ')}\n`;
        const lowered = lower(source);
        const bindings = lowered.criticMarkupBindings.inline;

        expect(bindings).toHaveLength(itemCount);
        expect(bindings.reduce(
            (count, binding) => count + binding.segments.length,
            0,
        )).toBe(itemCount * 3);
        expect(bindings.map(binding => binding.localRange.start))
            .toEqual(Array.from(
                { length: itemCount },
                (_, index) => index * 11,
            ));
        expect(new StateToMarkdown({ listIndentation: 4 })
            .generate(lowered.states))
            .toBe(source);
    });

    it('deep-freezes the revision graph and survives normalized reparsing', () => {
        const source = 'intro\r\nx {++same++} y\r\n';
        const canonicalSource = 'intro\nx {++same++} y\r\n';
        const normalized = analyzeCriticMarkupMarkdownState(
            source,
            NORMALIZED_STATE_OPTIONS,
        );
        const canonical = analyzeCriticMarkupMarkdownState(
            canonicalSource,
            NORMALIZED_STATE_OPTIONS,
        );
        const [binding] = normalized.bindings.inline;
        if (!binding)
            throw new TypeError('Fixture produced no inline binding.');

        expect(normalized.source).toBe(canonicalSource);
        expect(normalized.bindings).toEqual(canonical.bindings);
        expect(Object.isFrozen(normalized.bindings)).toBe(true);
        expect(Object.isFrozen(normalized.bindings.inline)).toBe(true);
        expect(Object.isFrozen(binding)).toBe(true);
        expect(Object.isFrozen(binding.path)).toBe(true);
        expect(Object.isFrozen(binding.localRange)).toBe(true);
        expect(Object.isFrozen(binding.sourceRange)).toBe(true);
        expect(Object.isFrozen(binding.segments)).toBe(true);
        for (const segment of binding.segments) {
            expect(Object.isFrozen(segment)).toBe(true);
            expect(Object.isFrozen(segment.localRange)).toBe(true);
            expect(Object.isFrozen(segment.sourceRange)).toBe(true);
        }
    });
});

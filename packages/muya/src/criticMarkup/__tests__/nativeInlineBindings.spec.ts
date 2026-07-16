import type {
    ICriticMarkupInlineStateBinding,
    ICriticMarkupStateBindingGraph,
} from '../../state/markdownToState';
import { describe, expect, it } from 'vitest';
import { markdownStatePath } from '../../state/markdownSourceMap';
import { MarkdownToState } from '../../state/markdownToState';
import StateToMarkdown from '../../state/stateToMarkdown';
import { CriticMarkupAnalysis } from '../analysis';
import { createCriticMarkupDocument } from '../document';
import { ExcludedRanges } from '../excludedRanges';

const LOWERER_OPTIONS = {
    footnote: false,
    frontMatter: false,
    isGitlabCompatibilityEnabled: false,
    math: false,
    trimUnnecessaryCodeBlockEmptyLines: false,
};

function fixtureFor(source: string) {
    const lowered = new MarkdownToState(LOWERER_OPTIONS)
        .generateWithMetadata(source);
    const mapped = new StateToMarkdown({ listIndentation: 4 })
        .generateMapped(lowered.states);
    if (mapped.text !== source)
        throw new TypeError('Native inline fixture did not round-trip exactly.');
    const analysis = CriticMarkupAnalysis.analyzeGrammar(
        mapped.text,
        ExcludedRanges.empty(mapped.text.length),
    );
    return {
        analysis,
        bindings: lowered.criticMarkupBindings,
        mapped,
    };
}

function documentFor(fixture: ReturnType<typeof fixtureFor>) {
    return createCriticMarkupDocument(
        fixture.analysis,
        fixture.mapped,
        undefined,
        undefined,
        fixture.bindings,
    );
}

function graphWithInline(
    graph: ICriticMarkupStateBindingGraph,
    inline: readonly ICriticMarkupInlineStateBinding[],
): ICriticMarkupStateBindingGraph {
    return Object.freeze({
        block: graph.block,
        inline: Object.freeze(inline),
    });
}

function onlyInlineBinding(fixture: ReturnType<typeof fixtureFor>) {
    const [binding] = fixture.bindings.inline;
    if (!binding || fixture.bindings.inline.length !== 1) {
        throw new TypeError(
            'Fixture did not produce exactly one native inline binding.',
        );
    }
    return binding;
}

describe('criticMarkupDocument native inline bindings', () => {
    it('rejects a native graph that omits a semantic item', () => {
        const { analysis, bindings, mapped } = fixtureFor('x {++same++} y\n');
        const emptyInlineGraph: ICriticMarkupStateBindingGraph = Object.freeze({
            block: bindings.block,
            inline: Object.freeze([]),
        });
        expect(() => createCriticMarkupDocument(
            analysis,
            mapped,
            undefined,
            undefined,
            emptyInlineGraph,
        )).toThrow('does not account for semantic item');
    });

    it('uses a simple parser-owned inline fragment directly', () => {
        const fixture = fixtureFor('x {++same++} y\n');
        const binding = onlyInlineBinding(fixture);
        const document = documentFor(fixture);

        expect(document.items[0].fragments).toEqual([{
            path: binding.path,
            role: 'only',
            localRange: binding.localRange,
            sourceRange: binding.sourceRange,
            segments: binding.segments,
        }]);
        expect(document.items[0].structuralFragments).toEqual([]);
    });

    it('groups linked substitution arms on one path into one document fragment', () => {
        const fixture = fixtureFor('A {~~old~>new~~} Z\n');
        const [oldBinding, newBinding] = fixture.bindings.inline;
        if (!oldBinding || !newBinding) {
            throw new TypeError(
                'Substitution fixture did not produce two inline bindings.',
            );
        }
        const document = documentFor(fixture);

        expect(fixture.bindings.inline.map(binding => ({
            arm: binding.arm,
            role: binding.role,
        }))).toEqual([
            { arm: 'old', role: 'start' },
            { arm: 'new', role: 'end' },
        ]);
        expect(document.items[0].fragments).toEqual([{
            path: oldBinding.path,
            role: 'only',
            localRange: {
                start: oldBinding.localRange.start,
                end: newBinding.localRange.end,
            },
            sourceRange: {
                start: oldBinding.sourceRange.start,
                end: newBinding.sourceRange.end,
            },
            segments: [
                ...oldBinding.segments,
                ...newBinding.segments,
            ],
        }]);
    });

    it('keeps nested parser item identities on their shared leaf path', () => {
        const fixture = fixtureFor('{++outer {--inner--} tail++}\n');
        const document = documentFor(fixture);
        const [outerBinding, innerBinding] = fixture.bindings.inline;
        if (!outerBinding || !innerBinding) {
            throw new TypeError('Nested fixture produced incomplete bindings.');
        }

        expect(document.items.map(item => ({
            id: item.id,
            parentId: item.parentId,
            path: item.fragments[0]?.path,
            sourceRange: item.fragments[0]?.sourceRange,
        }))).toEqual([
            {
                id: outerBinding.itemId,
                parentId: null,
                path: outerBinding.path,
                sourceRange: outerBinding.sourceRange,
            },
            {
                id: innerBinding.itemId,
                parentId: outerBinding.itemId,
                path: innerBinding.path,
                sourceRange: innerBinding.sourceRange,
            },
        ]);
    });

    it('distinguishes repeated identical syntax only by native coordinates', () => {
        const fixture = fixtureFor(
            'same {++same++} same {++same++} same\n',
        );
        const document = documentFor(fixture);

        expect(document.items.map(item => ({
            id: item.id,
            localRange: item.fragments[0]?.localRange,
            sourceRange: item.fragments[0]?.sourceRange,
        }))).toEqual(fixture.bindings.inline.map(binding => ({
            id: binding.itemId,
            localRange: binding.localRange,
            sourceRange: binding.sourceRange,
        })));
    });

    it('uses the exact table-cell leaf path and permits canonical mapping gaps', () => {
        const fixture = fixtureFor([
            '| A {++x\\|y++} | B |',
            '| --- | --- |',
            '',
        ].join('\n'));
        const binding = onlyInlineBinding(fixture);
        const document = documentFor(fixture);
        const [fragment] = document.items[0].fragments;

        expect(binding.path).toEqual([
            0,
            'children',
            0,
            'children',
            0,
            'text',
        ]);
        expect(
            binding.sourceRange.end - binding.sourceRange.start,
        ).toBeGreaterThan(
            binding.localRange.end - binding.localRange.start,
        );
        expect(fragment).toEqual({
            path: binding.path,
            role: 'only',
            localRange: binding.localRange,
            sourceRange: binding.sourceRange,
            segments: binding.segments,
        });
    });

    it('consumes parser-owned bindings across multiple Markdown blocks', () => {
        const fixture = fixtureFor('{++one\n\n# two++}\n');
        const document = documentFor(fixture);

        // A mixed item (inline-anchored, block-spanning) lowers entirely to
        // per-line inline fragments; markers stay literal in the text leaves
        // (shared-corpus row 'block-spanning-addition' pins this topology).
        expect(fixture.bindings.block).toEqual([]);
        expect(fixture.bindings.inline).toMatchObject([
            { path: [0, 'text'], role: 'start' },
            { path: [1, 'text'], role: 'end' },
        ]);
        expect(document.items[0]).toMatchObject({
            fragments: [
                { path: [0, 'text'], role: 'start' },
                { path: [1, 'text'], role: 'end' },
            ],
            structuralFragments: [],
        });
    });

    it('rejects stale item, type, arm, and role identity', () => {
        const fixture = fixtureFor('x {++same++} y\n');
        const binding = onlyInlineBinding(fixture);
        const create = (candidate: ICriticMarkupInlineStateBinding) =>
            documentFor({
                ...fixture,
                bindings: graphWithInline(fixture.bindings, [candidate]),
            });

        expect(() => create({
            ...binding,
            itemId: 'critic-missing',
        })).toThrow('unknown CriticMarkup item');

        const wrongType = { ...binding };
        Reflect.set(wrongType, 'criticType', 'deletion');
        expect(() => create(wrongType)).toThrow('has type deletion');

        const wrongArm = { ...binding };
        Reflect.set(wrongArm, 'arm', 'old');
        expect(() => create(wrongArm)).toThrow('invalid semantic arm');

        const wrongRole = { ...binding };
        Reflect.set(wrongRole, 'role', 'sideways');
        expect(() => create(wrongRole)).toThrow('invalid role');
    });

    it('rejects stale paths, ranges, and segment ordering', () => {
        const fixture = fixtureFor('x {++same++} y\n');
        const binding = onlyInlineBinding(fixture);
        const create = (candidate: ICriticMarkupInlineStateBinding) =>
            documentFor({
                ...fixture,
                bindings: graphWithInline(fixture.bindings, [candidate]),
            });

        expect(() => create({
            ...binding,
            path: markdownStatePath([99, 'text']),
        })).toThrow('no mapped text leaf');

        const shiftedLocal = {
            ...binding,
            localRange: {
                start: binding.localRange.start + 1,
                end: binding.localRange.end + 1,
            },
            segments: binding.segments.map(segment => ({
                ...segment,
                localRange: {
                    start: segment.localRange.start + 1,
                    end: segment.localRange.end + 1,
                },
            })),
        };
        expect(() => create(shiftedLocal))
            .toThrow('not an exact mapped leaf range');

        expect(() => create({
            ...binding,
            sourceRange: {
                start: binding.sourceRange.start,
                end: fixture.mapped.text.length + 1,
            },
        })).toThrow('invalid source range');

        expect(() => create({
            ...binding,
            segments: [...binding.segments].reverse(),
        })).toThrow('unordered segment envelopes');
    });
});

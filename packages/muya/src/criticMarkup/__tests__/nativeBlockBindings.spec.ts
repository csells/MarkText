import type {
    ICriticMarkupStateBindingGraph,
    TCriticMarkupBlockStateBinding,
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
        throw new TypeError('Native binding fixture did not round-trip exactly.');
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

function fixture() {
    return fixtureFor([
        '{~~| OLD |',
        '| --- |',
        '~>| NEW |',
        '| --- |',
        '~~}',
        '',
    ].join('\n'));
}

function immutableGraph(
    binding: TCriticMarkupBlockStateBinding,
): ICriticMarkupStateBindingGraph {
    return Object.freeze({
        block: Object.freeze([Object.freeze(binding)]),
        inline: Object.freeze([]),
    });
}

describe('criticMarkupDocument native block bindings', () => {
    it('uses parser-owned structural identity instead of reconstructing it', () => {
        const { analysis, bindings, mapped } = fixture();
        const document = createCriticMarkupDocument(
            analysis,
            mapped,
            undefined,
            undefined,
            bindings,
        );

        expect(bindings.block).toMatchObject([
            {
                kind: 'content',
                path: [0],
                criticType: 'substitution',
                arm: 'old',
                role: 'start',
            },
            {
                kind: 'content',
                path: [1],
                criticType: 'substitution',
                arm: 'new',
                role: 'end',
            },
        ]);
        expect(document.items[0].structuralFragments).toEqual(
            bindings.block.map((binding) => {
                if (binding.kind !== 'content') {
                    throw new TypeError(
                        'Fixture unexpectedly produced a boundary binding.',
                    );
                }
                return {
                    kind: 'content',
                    path: binding.path,
                    arm: binding.arm,
                    role: binding.role,
                    sourceRange: binding.sourceRange,
                };
            }),
        );
    });

    it('rejects bindings from a different item, path, or source revision', () => {
        const { analysis, bindings, mapped } = fixture();
        const [binding] = bindings.block;
        const create = (graph: ICriticMarkupStateBindingGraph) =>
            createCriticMarkupDocument(
                analysis,
                mapped,
                undefined,
                undefined,
                graph,
            );

        expect(() => create(immutableGraph({
            ...binding,
            itemId: 'critic-missing',
        }))).toThrow('unknown CriticMarkup item');
        expect(() => create(immutableGraph({
            ...binding,
            path: markdownStatePath([99]),
        }))).toThrow('no node in the mapped revision');
        expect(() => create(immutableGraph({
            ...binding,
            sourceRange: Object.freeze({
                start: binding.sourceRange.start,
                end: mapped.text.length + 1,
            }),
        }))).toThrow('outside the mapped revision');
    });

    it('uses the parser-owned edge and semantic offset for a boundary', () => {
        const { analysis, bindings, mapped } = fixtureFor('{++++}# heading\n');
        const [binding] = bindings.block;
        const document = createCriticMarkupDocument(
            analysis,
            mapped,
            undefined,
            undefined,
            bindings,
        );

        expect(binding).toMatchObject({
            kind: 'boundary',
            edge: 'before',
            sourceRange: { start: 0, end: 6 },
            localRange: { start: 3, end: 3 },
        });
        expect(document.items[0].structuralFragments).toEqual([{
            kind: 'boundary',
            path: binding.path,
            edge: 'before',
            sourceOffset: 3,
        }]);
    });
});

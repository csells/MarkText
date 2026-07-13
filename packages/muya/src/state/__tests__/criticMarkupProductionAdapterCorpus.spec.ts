import type { TCriticMarkupDocumentToken } from '../../criticMarkup/analysis';
import type { ICriticMarkupCorpusRow } from '../../criticMarkup/__tests__/sharedCorpus';
import type { TState } from '../types';
import { describe, expect, it } from 'vitest';
import { CRITIC_MARKUP_CORPUS } from '../../criticMarkup/__tests__/sharedCorpus';
import { analyzeCriticMarkupMarkdownState } from '../../criticMarkup/markdownState';
import { snapshotCriticMarkupParserOptions } from '../../utils/marked/criticMarkupSourceContext';
import StateToMarkdown from '../stateToMarkdown';

const SEMANTIC_CORPUS = CRITIC_MARKUP_CORPUS.filter(row =>
    row.expected.itemTypes.length > 0);

function productionAdapterOptions(
    options: ICriticMarkupCorpusRow['options'],
) {
    return {
        listIndentation: 1,
        trimUnnecessaryCodeBlockEmptyLines: false,
        lex: snapshotCriticMarkupParserOptions({
            breaks: false,
            footnote: options.footnote ?? false,
            frontMatter: options.frontMatter ?? true,
            gfm: true,
            isGitlabCompatibilityEnabled:
                options.isGitlabCompatibilityEnabled ?? true,
            math: options.math ?? true,
            maxBlockNesting: 128,
            pedantic: false,
            superSubScript: options.superSubScript ?? true,
        }),
    } as const;
}

function allStates(states: readonly TState[]): TState[] {
    const result: TState[] = [];
    const pending = [...states];
    while (pending.length) {
        const state = pending.shift()!;
        result.push(state);
        if ('children' in state)
            pending.unshift(...state.children as TState[]);
    }
    return result;
}

function orderedSemanticItems(
    roots: readonly TCriticMarkupDocumentToken[],
) {
    const result: Array<{ type: string; raw: string }> = [];
    const pending = [...roots];
    while (pending.length) {
        const item = pending.shift()!;
        result.push({ type: item.type, raw: item.raw });
        if (item.nested?.length)
            pending.unshift(...item.nested);
    }
    return result;
}

describe('CriticMarkup production Markdown-state adapter corpus', () => {
    it.each(SEMANTIC_CORPUS)(
        'keeps $id native through its declared serialization contract',
        (row) => {
            const options = productionAdapterOptions(row.options);
            const parsed = analyzeCriticMarkupMarkdownState(
                row.source,
                options,
            );
            const states = allStates(parsed.states);
            const serialized = new StateToMarkdown({
                listIndentation: options.listIndentation,
            }).generate(parsed.states);
            const expected = row.normalization.kind === 'exact'
                ? row.source
                : row.normalization.output;

            expect(states.some(state =>
                state.name === 'markdown-parser-residue')).toBe(false);
            expect(serialized).toBe(expected);
            expect(parsed.analysis).not.toBeNull();
            expect(parsed.analysis!.source).toBe(serialized);
            expect(orderedSemanticItems(parsed.analysis!.roots)).toEqual(
                row.expected.itemTypes.map((type, index) => ({
                    type,
                    raw: row.expected.itemRaw[index],
                })),
            );
            if (row.normalization.kind === 'known') {
                const canonical = analyzeCriticMarkupMarkdownState(
                    expected,
                    options,
                );
                expect(parsed.states).toEqual(canonical.states);
            }
        },
    );
});

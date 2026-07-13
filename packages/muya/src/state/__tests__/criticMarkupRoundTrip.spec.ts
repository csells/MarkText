import type { ICriticMarkupCorpusRow } from '../../criticMarkup/__tests__/sharedCorpus';
import { describe, expect, it } from 'vitest';
import { CRITIC_MARKUP_CORPUS } from '../../criticMarkup/__tests__/sharedCorpus';
import { MarkdownToState } from '../markdownToState';
import StateToMarkdown from '../stateToMarkdown';

function roundTrip(
    markdown: string,
    options: ICriticMarkupCorpusRow['options'] = {},
): string {
    const parserOptions = {
        footnote: options.footnote ?? false,
        math: options.math ?? false,
        isGitlabCompatibilityEnabled:
            options.isGitlabCompatibilityEnabled ?? false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: options.frontMatter ?? false,
        superSubScript: options.superSubScript ?? true,
    };
    const state = new MarkdownToState(parserOptions).generate(markdown);

    return new StateToMarkdown().generate(state);
}

describe('criticMarkup state round trip', () => {
    it('preserves all five pure forms byte-for-byte in leaf Markdown', () => {
        const source = 'A {++new++} {--old--} {~~old~>new~~} {==focus==}{>>note<<}.\n';

        expect(roundTrip(source)).toBe(source);
    });

    it('does not add IDs, author metadata, sentinels, or YAML endmatter', () => {
        const output = roundTrip('Review {++this++}.\n');

        expect(output).toBe('Review {++this++}.\n');
        expect(output).not.toMatch(/\{#|\bby=|\bat=|\u2060|^---$/m);
    });

    it('keeps CriticMarkup-looking source inside code untouched', () => {
        const source = 'Code: `{++literal++}`\n\n```md\n{--literal--}\n```\n';

        expect(roundTrip(source)).toBe(source);
    });

    it.each(CRITIC_MARKUP_CORPUS)(
        'preserves $id through repeated no-op serialization',
        (row) => {
            const first = roundTrip(row.source, row.options);
            const second = roundTrip(first, row.options);
            const expected = row.normalization.kind === 'exact'
                ? row.source
                : row.normalization.output;

            expect(first).toBe(expected);
            expect(second).toBe(expected);
        },
    );
});

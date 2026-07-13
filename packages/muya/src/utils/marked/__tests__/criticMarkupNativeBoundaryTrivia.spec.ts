import type { Token, Tokens } from 'marked';
import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../../../state/markdownToState';
import StateToMarkdown from '../../../state/stateToMarkdown';
import { analyzeMarkdownBlockSource } from '../lexBlock';

const OPTIONS = {
    criticMarkup: true,
    criticMarkupProjection: 'marked' as const,
    footnote: false,
    frontMatter: false,
    gfm: true,
    isGitlabCompatibilityEnabled: false,
    math: false,
    superSubScript: false,
};

function boundaryCarrier(
    source: string,
): Token & Tokens.CriticMarkupBoundaryCarrier {
    const parsed = analyzeMarkdownBlockSource(source, OPTIONS);
    expect(parsed.tokens.criticMarkup?.items).toHaveLength(1);
    expect(parsed.tokens.criticMarkupUnanchored).toEqual([]);
    expect(parsed.tokens.some(token => token.type.startsWith('critic_')))
        .toBe(false);
    const carrier = parsed.tokens.find(token => token.type === 'heading');
    expect(carrier).toBeDefined();
    return carrier as Token & Tokens.CriticMarkupBoundaryCarrier;
}

function expectNativeRoundTrip(source: string): void {
    const states = new MarkdownToState({
        footnote: false,
        frontMatter: false,
        isGitlabCompatibilityEnabled: false,
        math: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
    }).generate(source);
    expect(states.some(state => state.name === 'markdown-parser-residue'))
        .toBe(false);
    expect(new StateToMarkdown({ listIndentation: 4 }).generate(states))
        .toBe(source);
}

describe('native CriticMarkup zero-width boundary trivia', () => {
    it('keeps leading blank lines after a boundary before its native block', () => {
        const source = '{++++}\n\n# h\n';
        const carrier = boundaryCarrier(source);

        expect(carrier.criticMarkupBefore).toMatchObject([{
            edge: 'before',
            trivia: { raw: '\n\n' },
            markers: [
                { name: 'open', raw: '{++' },
                { name: 'close', raw: '++}' },
            ],
        }]);
        expectNativeRoundTrip(source);
    });

    it('does not move block trivia that precedes a before-boundary marker', () => {
        const source = '\n{++++}\n\n# h\n';
        const carrier = boundaryCarrier(source);

        expect(carrier.criticMarkupBefore).toMatchObject([{
            edge: 'before',
            trivia: { raw: '\n\n' },
        }]);
        expectNativeRoundTrip(source);
    });

    it('keeps trailing blank lines before a boundary after its native block', () => {
        const source = '# h\n\n{++++}';
        const carrier = boundaryCarrier(source);

        expect(carrier.criticMarkupAfter).toMatchObject([{
            edge: 'after',
            trivia: { raw: '\n\n' },
            markers: [
                { name: 'open', raw: '{++' },
                { name: 'close', raw: '++}' },
            ],
        }]);
        const states = new MarkdownToState({
            footnote: false,
            frontMatter: false,
            isGitlabCompatibilityEnabled: false,
            math: false,
            trimUnnecessaryCodeBlockEmptyLines: false,
        }).generate(source);
        expect(states[0].sourceTrivia).toMatchObject({
            criticAfterPrefix: '\n\n',
            terminalLineEnding: '',
        });
        expect(states[0].sourceTrivia?.blockSeparatorAfter).toBeUndefined();
        expectNativeRoundTrip(source);
    });

    it('keeps terminal trivia after an after-boundary marker', () => {
        const source = '# h\n\n{++++}\n';
        const carrier = boundaryCarrier(source);

        expect(carrier.criticMarkupAfter).toMatchObject([{
            edge: 'after',
            trivia: { raw: '\n\n' },
            followingTrivia: { raw: '\n' },
        }]);
        expectNativeRoundTrip(source);
    });
});

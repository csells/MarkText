import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';
import StateToMarkdown from '../stateToMarkdown';

const OPTIONS = {
    footnote: false,
    math: false,
    isGitlabCompatibilityEnabled: false,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: false,
};

function roundTrip(source: string): string {
    return new StateToMarkdown({ listIndentation: 1 }).generate(
        new MarkdownToState(OPTIONS).generate(source),
    );
}

describe('parser-owned block spacing', () => {
    it.each([
        '\n\n',
        '\n\nleading\n',
        'before\n\nafter\n',
        'before\n\n\nafter\n',
        'before\n   \nafter\n',
        '| a |\n| --- |\n\n',
        '> before\n>\n> after\n',
        '- before\n\n  after\n',
    ])('round-trips exact whitespace token bytes in %j', (source) => {
        expect(roundTrip(source)).toBe(source);
    });
});

import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';
import StateToMarkdown from '../stateToMarkdown';

const PARSER_OPTIONS = {
    footnote: false,
    math: false,
    isGitlabCompatibilityEnabled: false,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: false,
};

function roundTrip(source: string): string {
    const state = new MarkdownToState(PARSER_OPTIONS).generate(source);
    return new StateToMarkdown({ listIndentation: 1 }).generate(state);
}

describe('parser-owned terminal line ending', () => {
    it.each([
        '',
        'paragraph',
        'paragraph\n',
        'paragraph\r\n',
        '{++++}',
        '{++text++}',
        '{++text++}\r\n',
    ])('round-trips %j without manufacturing or normalizing its terminal EOL', (source) => {
        expect(roundTrip(source)).toBe(source);
    });
});

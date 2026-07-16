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

describe('list-final Critic boundary terminal EOL', () => {
    const CRITIC_OPTIONS = { ...OPTIONS, math: true };

    it.each([
        '- item\n{++++}\n',
        '- item\n\n{++++}\n',
    ])('round-trip of %j is a fixed point', (source) => {
        const once = new StateToMarkdown({ listIndentation: 1 }).generate(
            new MarkdownToState(CRITIC_OPTIONS).generate(source),
        );
        const twice = new StateToMarkdown({ listIndentation: 1 }).generate(
            new MarkdownToState(CRITIC_OPTIONS).generate(once),
        );
        // Byte-exactness is the goal; boundedness is the hard invariant —
        // repeated open/save must never grow the document.
        expect(twice).toBe(once);
        expect(once).toBe(source);
    });
});

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
        // Loose-list blank lines must keep their container's prefix: a bare
        // LF between quoted items would terminate the blockquote on reparse.
        '> - a\n>\n> - b\n',
        '> 1. a\n>\n> 1. b\n',
        '> > - a\n> >\n> > - b\n',
        '- a\n\n- b\n',
    ])('round-trips exact whitespace token bytes in %j', (source) => {
        expect(roundTrip(source)).toBe(source);
    });
});

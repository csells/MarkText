import type { TState } from '../types';
import { describe, expect, it } from 'vitest';
import {
    applyTerminalLineEnding,
    weaveCriticSourceTrivia,
} from '../criticMarkupSerialization';
import { markdownStatePath, plainMarkdown } from '../markdownSourceMap';
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

    it('leaves a terminal CRLF spelled by Critic suffix trivia intact', () => {
        const path = markdownStatePath([0]);
        const states: TState[] = [{
            name: 'paragraph',
            text: 'x',
            sourceTrivia: {
                criticAfter: [{
                    type: 'deletion',
                    marker: 'close',
                    raw: '--}',
                }],
                criticAfterSuffix: '\r\n',
                terminalLineEnding: '\r\n',
            },
        }];
        const woven = weaveCriticSourceTrivia(
            states,
            plainMarkdown('x\n').withNode(path),
        );

        expect(woven.text).toBe('x\n--}\r\n');
        expect(applyTerminalLineEnding(states, woven).text)
            .toBe(woven.text);
    });
});

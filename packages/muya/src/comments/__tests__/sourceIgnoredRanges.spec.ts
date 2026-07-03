import { describe, expect, it } from 'vitest';
import {
    buildCommentSourceIndex,
    createCommentSourceLineState,
    prepareCommentSourceLine,
    sourceCommentIgnoredIndexRanges,
    sourceIndexInsideRanges,
} from '../source';

// Characterization + equivalence suite for the source-mode block classifier.
// The batch `sourceCommentIgnoredIndexRanges` and the streaming
// `prepareCommentSourceLine` used to duplicate the fence/math/indent/html rules
// and had drifted (streaming wrongly ignored indented paragraph continuations).
// These lock the batch's per-line "ignored" decision across every construct and
// assert the streaming classifier agrees line-for-line on the same inputs
// (except front matter, where the streaming lexer is intentionally forgiving so
// live typing under an unclosed `---` does not grey out the whole document).

// True if the byte offset at the START of each line falls inside an ignored
// range — the property every consumer actually checks (marker/metadata at that
// offset is literal, not comment syntax).
function batchLineIgnored(markdown: string): boolean[] {
    const ranges = sourceCommentIgnoredIndexRanges(markdown);
    const result: boolean[] = [];
    let offset = 0;
    for (const line of markdown.split(/(?<=\n)/)) {
        if (line === '')
            break;
        // A line counts as "ignored" when its first non-newline content is
        // inside a block ignored range (inline-code ranges start mid-line).
        result.push(sourceIndexInsideRanges(offset, ranges));
        offset += line.length;
    }
    return result;
}

function streamLineIgnored(markdown: string): boolean[] {
    const state = createCommentSourceLineState();
    const result: boolean[] = [];
    for (const line of markdown.split(/(?<=\n)/)) {
        if (line === '')
            break;
        prepareCommentSourceLine(state, line.replace(/(?:\r\n|\n|\r)$/u, ''));
        result.push(state.ignoreLine);
    }
    return result;
}

describe('source-mode block classifier — batch behaviour', () => {
    const cases: Array<{ name: string; markdown: string; ignored: boolean[] }> = [
        {
            name: 'fenced code block',
            markdown: 'before\n```\ncode\n```\nafter\n',
            ignored: [false, true, true, true, false],
        },
        {
            name: 'tilde fence with language',
            markdown: '~~~js\ncode\n~~~\ntext\n',
            ignored: [true, true, true, false],
        },
        {
            name: 'unterminated fence runs to EOF',
            markdown: 'p\n```\nstill code\n',
            ignored: [false, true, true],
        },
        {
            name: 'math block',
            markdown: 'x\n$$\na=b\n$$\ny\n',
            ignored: [false, true, true, true, false],
        },
        {
            name: 'indented code after a blank line',
            markdown: 'para\n\n    code line\nafter\n',
            ignored: [false, false, true, false],
        },
        {
            name: 'indented paragraph continuation is NOT code',
            markdown: 'para line\n    lazy continuation\n',
            ignored: [false, false],
        },
        {
            name: 'single-line HTML block',
            markdown: 'a\n<div>x</div>\nb\n',
            ignored: [false, true, false],
        },
        {
            name: 'plain paragraphs are never ignored',
            markdown: 'one\ntwo\nthree\n',
            ignored: [false, false, false],
        },
    ];

    for (const { name, markdown, ignored } of cases) {
        it(`batch classifies: ${name}`, () => {
            expect(batchLineIgnored(markdown)).toEqual(ignored);
        });

        it(`streaming agrees with batch: ${name}`, () => {
            expect(streamLineIgnored(markdown)).toEqual(ignored);
        });
    }

    it('a comment marker inside indented code is ignored by the batch index', () => {
        const markdown = 'para\n\n    <!--MC:a-->x<!--MC:~a-->\n';
        expect(buildCommentSourceIndex(markdown).markers).toEqual([]);
    });

    it('a comment marker on an indented paragraph continuation is a real marker', () => {
        const markdown = 'para line\n    <!--MC:a-->x<!--MC:~a-->\n';
        expect(buildCommentSourceIndex(markdown).markers).toHaveLength(2);
    });
});

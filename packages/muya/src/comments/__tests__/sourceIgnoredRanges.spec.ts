import { describe, expect, it } from 'vitest';
import {
    buildCommentSourceIndex,
    sourceCommentIgnoredIndexRanges,
    sourceIndexInsideRanges,
} from '../source';

// Characterization suite for the source-mode block classifier. The batch
// `sourceCommentIgnoredIndexRanges` (from the real parser's block tokens) is
// the single authority for which lines are literal context; the CodeMirror
// overlay consumes it directly (no second streaming grammar). These lock the
// per-line "ignored" decision across every construct.

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
            name: 'plain paragraphs are never ignored',
            markdown: 'one\ntwo\nthree\n',
            ignored: [false, false, false],
        },
    ];

    for (const { name, markdown, ignored } of cases) {
        it(`batch classifies: ${name}`, () => {
            expect(batchLineIgnored(markdown)).toEqual(ignored);
        });
    }

    // The batch index follows the parser: a CommonMark type-6 HTML block
    // continues past its closing tag until a blank line, so the trailing
    // paragraph-looking line is literal text. The streaming adapter keeps the
    // single-line approximation for live decoration and is not asserted here.
    it('batch classifies: HTML block continues to the blank line (CommonMark type 6)', () => {
        expect(batchLineIgnored('a\n<div>x</div>\nb\n')).toEqual([false, true, true]);
        expect(batchLineIgnored('a\n<div>x</div>\n\nb\n')).toEqual([false, true, false, false]);
    });

    it('a comment marker inside indented code is ignored by the batch index', () => {
        const markdown = 'para\n\n    <!--MC:a-->x<!--MC:~a-->\n';
        expect(buildCommentSourceIndex(markdown).markers).toEqual([]);
    });

    it('a comment marker on an indented paragraph continuation is a real marker', () => {
        const markdown = 'para line\n    <!--MC:a-->x<!--MC:~a-->\n';
        expect(buildCommentSourceIndex(markdown).markers).toHaveLength(2);
    });
});

// Adversarial-review regression: the batch index must match the PARSER's
// front-matter view (getFrontMatterInfo), not the streaming classifier's
// forgiving one. A bare or unterminated leading `---` is a thematic break, not
// front matter, so comments on the following lines are real and must be seen.
describe('source index — front matter matches the parser, not the forgiving stream', () => {
    it('recognizes a comment after a bare leading --- (thematic break, not front matter)', () => {
        const md = '---\nintro <!--MC:a-->important<!--MC:~a-->\n\nBody.\n';
        expect(buildCommentSourceIndex(md).markers.map(m => m.id)).toEqual(['a', 'a']);
    });

    it('recognizes a metadata def under an unterminated leading --- (mid-edit)', () => {
        const md = '---\ntitle: Draft\n[MC:a]: data:text/plain,note\n';
        expect(buildCommentSourceIndex(md).metadataDefinitions.map(d => d.id)).toEqual(['a']);
    });

    it('still ignores markers INSIDE a valid terminated front-matter block', () => {
        const md = '---\ntitle: <!--MC:x-->y<!--MC:~x-->\n---\n\n<!--MC:b-->real<!--MC:~b-->\n';
        expect(buildCommentSourceIndex(md).markers.map(m => m.id)).toEqual(['b', 'b']);
    });
});

// Quality review ③: removeCommentSyntaxFromMarkdown and the source-mode
// discard handler both computed a comment's syntax ranges from the index by
// hand. Lock the shared computation.
describe('commentSyntaxRangesForId', () => {
    it('returns a comment id\'s marker + metadata ranges, descending, empty for others', async () => {
        const { commentSyntaxRangesForId, removeCommentSyntaxFromMarkdown } = await import('../source');
        const meta = 'data:text/plain,note';
        const md = `a <!--MC:x-->b<!--MC:~x--> c\n\n[MC:x]: ${meta}\n`;

        const ranges = commentSyntaxRangesForId(md, 'x');
        expect(ranges.length).toBeGreaterThanOrEqual(3); // open, close, metadata def
        // Descending by start so splicing left-to-right is stable.
        for (let i = 1; i < ranges.length; i += 1)
            expect(ranges[i - 1].start).toBeGreaterThanOrEqual(ranges[i].start);
        expect(commentSyntaxRangesForId(md, 'missing')).toEqual([]);

        // Splicing the ranges reproduces removeCommentSyntaxFromMarkdown.
        let spliced = md;
        for (const r of ranges)
            spliced = `${spliced.slice(0, r.start)}${spliced.slice(r.end)}`;
        expect(spliced).toBe(removeCommentSyntaxFromMarkdown(md, 'x'));
    });
});

// Discarding a comment must not leave the blank lines the metadata appendix
// introduced. removeCommentSyntaxFromMarkdown (and the source-mode discard that
// shares its per-id ranges) should restore the pre-comment bytes.
describe('removeCommentSyntaxFromMarkdown — no leftover blank lines', () => {
    it('restores the exact prose when discarding a comment whose def is at EOF', async () => {
        const { removeCommentSyntaxFromMarkdown } = await import('../source');
        const meta = 'data:text/plain,note';
        const md = `A <!--MC:a-->reviewed<!--MC:~a--> span.\n\n[MC:a]: ${meta}\n`;
        expect(removeCommentSyntaxFromMarkdown(md, 'a')).toBe('A reviewed span.\n');
    });

    it('keeps the blank separator for sibling definitions when removing one', async () => {
        const { removeCommentSyntaxFromMarkdown } = await import('../source');
        const md = 'c.\n\n[MC:a]: data:text/plain,A\n[MC:b]: data:text/plain,B\n';
        expect(removeCommentSyntaxFromMarkdown(md, 'a')).toBe('c.\n\n[MC:b]: data:text/plain,B\n');
        expect(removeCommentSyntaxFromMarkdown(md, 'b')).toBe('c.\n\n[MC:a]: data:text/plain,A\n');
    });
});

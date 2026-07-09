import * as json1 from 'ot-json1';
import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../../state/markdownToState';
import { commentModelView, extractCommentModel, transformCommentAnchors } from '../model';

// Pressing Enter to split a paragraph at or before a commented span must carry
// the comment with its text into the new block — NOT delete the thread. muya's
// enterHandler encodes a split as a suffix-delete of the block's text composed
// with an insert of a new block holding that exact suffix; the anchors sit in
// the deleted suffix, so without a split-rescue transformPosition collapses
// them onto the split point and the deletion policy drops the whole thread
// while the commented text survives in the new block (comment-anchors.md
// invariant 5: no silent loss).

function parse(markdown: string) {
    return new MarkdownToState({
        footnote: false,
        math: true,
        isGitlabCompatibilityEnabled: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: true,
    }).generate(markdown);
}

const DOC = [
    'Hello <!--MC:a-->reviewed<!--MC:~a--> world.',
    '',
    '[MC:a]: {"version":2,"status":"open"}',
    '',
].join('\n');

// The op enterHandler emits for a split at code-point `splitCp` of block 0:
// delete the tail of block0.text + insert a new paragraph holding that tail.
function splitOp(fullText: string, splitCp: number): json1.JSONOp {
    const tail = [...fullText].slice(splitCp).join('');
    return json1.type.compose(
        json1.editOp([0, 'text'], 'text-unicode', [splitCp, { d: [...tail].length }]),
        json1.insertOp([1], { name: 'paragraph', text: tail } as never),
    );
}

function applyOp(states: ReturnType<typeof parse>, op: json1.JSONOp) {
    return json1.type.apply(states as never, op) as unknown as ReturnType<typeof parse>;
}

describe('anchor transform — paragraph split rescue', () => {
    it('splitting BEFORE the comment carries the whole thread into the new block', () => {
        const { states, model } = extractCommentModel(parse(DOC));
        // Clean block0 text is "Hello reviewed world."; comment covers
        // "reviewed" at [6, 14). Split at cp 6 (right before the comment).
        const op = splitOp('Hello reviewed world.', 6);
        const nextStates = applyOp(states, op);
        const nextModel = transformCommentAnchors(model, op, states, nextStates);

        expect(nextModel.threads.has('a'), 'the thread must survive the split').toBe(true);
        expect(nextModel.anchors).toHaveLength(2);
        const view = commentModelView(nextModel, nextStates);
        expect(view.ranges).toHaveLength(1);
        expect(view.diagnostics).toEqual([]);
        // The comment now brackets "reviewed" wholly in the NEW block (index 1).
        expect(view.ranges[0].startPath[0]).toBe(1);
        expect(view.ranges[0].endPath[0]).toBe(1);
        expect(view.ranges[0].startOffset).toBe(0); // "reviewed" starts the new block
        expect(view.ranges[0].endOffset).toBe(8); // "reviewed".length
    });

    it('splitting INSIDE the comment keeps it, now spanning both blocks', () => {
        const { states, model } = extractCommentModel(parse(DOC));
        // Split at cp 9 (inside "reviewed", after "rev"): open stays in block0,
        // close follows the tail into block1.
        const op = splitOp('Hello reviewed world.', 9);
        const nextStates = applyOp(states, op);
        const nextModel = transformCommentAnchors(model, op, states, nextStates);

        expect(nextModel.threads.has('a'), 'the thread must survive the split').toBe(true);
        expect(nextModel.anchors).toHaveLength(2);
        const view = commentModelView(nextModel, nextStates);
        expect(view.ranges).toHaveLength(1);
        expect(view.diagnostics).toEqual([]);
        // Open stays in block 0 ("rev"); close follows the tail into block 1
        // ("iewed…") — the comment now spans the break.
        expect(view.ranges[0].startPath[0]).toBe(0);
        expect(view.ranges[0].endPath[0]).toBe(1);
    });
});

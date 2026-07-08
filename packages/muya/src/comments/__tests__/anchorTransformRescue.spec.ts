import * as json1 from 'ot-json1';
import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../../state/markdownToState';
import { commentModelView, extractCommentModel, transformCommentAnchors } from '../model';

// The replace-rescue policy (comment-anchors.md §Edit): a TRUE subtree
// replace (remove + insert at one path, e.g. paragraph→heading conversion)
// re-anchors into the replacement's text leaf with the offset clamped; a
// bare remove NEVER rescues — the sibling that shifts into the removed index
// is unrelated content, so deletion detaches.

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
    'second paragraph',
    '',
    '[MC:a]: {"version":2,"status":"open"}',
    '',
].join('\n');

function applyOp(states: ReturnType<typeof parse>, op: json1.JSONOp) {
    return json1.type.apply(
        states as never,
        op,
    ) as unknown as ReturnType<typeof parse>;
}

describe('anchor transform — replace rescue', () => {
    it('a true subtree replace re-anchors into the replacement leaf', () => {
        const { states, model } = extractCommentModel(parse(DOC));

        // Paragraph→heading conversion: replace the whole block state.
        const replacement = { name: 'atx-heading', meta: { level: 2 }, text: '## Hello reviewed world.' };
        const op = json1.replaceOp([0], states[0] as never, replacement as never);
        const nextStates = applyOp(states, op);
        const nextModel = transformCommentAnchors(model, op, states, nextStates);

        // Both anchors survived at the replaced path (offsets clamped into
        // the replacement's text), so the range is still paired.
        expect(nextModel.anchors).toHaveLength(2);
        for (const anchor of nextModel.anchors)
            expect(anchor.position[0]).toBe(0);
        const view = commentModelView(nextModel, nextStates);
        expect(view.ranges).toHaveLength(1);
        expect(view.diagnostics).toEqual([]);
    });

    it('a bare remove never rescues: the pair detaches instead of re-anchoring into the shifted-in sibling', () => {
        const { states, model } = extractCommentModel(parse(DOC));

        const op = json1.removeOp([0]);
        const nextStates = applyOp(states, op);
        const nextModel = transformCommentAnchors(model, op, states, nextStates);

        // 'second paragraph' shifted into index 0 — the anchors must NOT
        // land in it.
        expect(nextModel.anchors).toEqual([]);
        const view = commentModelView(nextModel, nextStates);
        expect(view.ranges).toEqual([]);
        expect(view.diagnostics).toContainEqual(expect.objectContaining({
            code: 'orphan-metadata',
            id: 'a',
        }));
    });
});

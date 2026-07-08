import { Buffer } from 'node:buffer';
import * as json1 from 'ot-json1';
import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../../state/markdownToState';
import ExportMarkdown from '../../state/stateToMarkdown';
import {
    commentModelResidue,
    extractCommentModel,
    materializeCommentModel,
    transformCommentAnchors,
} from '../model';

// Definition-line placement fidelity (comment-anchors.md invariant 2,
// editing-invariants.md §Round-trip): a definition block lives WHERE THE FILE
// PUT IT, not wherever serialization finds convenient. Extraction records
// each contiguous definition run's position; materialization re-emits it
// there; the position rides the same OT transform as comment anchors.

function parse(markdown: string) {
    return new MarkdownToState({
        footnote: false,
        math: true,
        isGitlabCompatibilityEnabled: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: true,
    }).generate(markdown);
}

const serialize = (states: unknown) => new ExportMarkdown().generate(states as never);

function roundTrip(markdown: string): string {
    const { states, model } = extractCommentModel(parse(markdown));
    return serialize(materializeCommentModel(states, model));
}

const HEAD_A = '[MC:a]: {"version":2,"status":"open"}';
const HEAD_B = '[MC:b]: {"version":2,"status":"open"}';

function v1DataUri(json: string): string {
    return `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
}

describe('definition placement — byte fidelity', () => {
    it('keeps a mid-document definition block at its position', () => {
        const markdown = [
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '',
            HEAD_A,
            '',
            'omega',
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe(markdown);
    });

    it('keeps the blank line between separate trailing definition blocks', () => {
        const markdown = [
            'text <!--MC:a-->x<!--MC:~a--> and <!--MC:b-->y<!--MC:~b-->.',
            '',
            HEAD_A,
            '',
            HEAD_B,
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe(markdown);
    });

    it('keeps a residue line at its position between thread blocks', () => {
        const duplicateHead = '[MC:a]: {"version":2,"status":"resolved"}';
        const markdown = [
            'text <!--MC:a-->x<!--MC:~a--> and <!--MC:b-->y<!--MC:~b-->.',
            '',
            HEAD_A,
            duplicateHead,
            HEAD_B,
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe(markdown);
        const { model } = extractCommentModel(parse(markdown));
        expect(commentModelResidue(model)).toEqual([duplicateHead]);
    });

    it('keeps definition blocks in separate document regions apart', () => {
        const markdown = [
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '',
            HEAD_A,
            '',
            'middle prose',
            '',
            'omega <!--MC:b-->y<!--MC:~b-->',
            '',
            HEAD_B,
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe(markdown);
    });

    it('upgrades a mid-document v1 head to v2 in place', () => {
        const v1Line = `[MC:a]: ${v1DataUri('{"version":1,"status":"open","replies":[]}')}`;
        const markdown = [
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '',
            v1Line,
            '',
            'omega',
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe([
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '',
            HEAD_A,
            '',
            'omega',
            '',
        ].join('\n'));
    });
});

describe('definition placement — runtime threads without a recorded position', () => {
    it('appends a runtime-created thread to the trailing appendix block contiguously', () => {
        const markdown = [
            'text <!--MC:a-->x<!--MC:~a-->',
            '',
            HEAD_A,
            '',
        ].join('\n');
        const { states, model } = extractCommentModel(parse(markdown));

        model.threads.set('n', { id: 'n', status: 'open', replies: [] });

        expect(serialize(materializeCommentModel(states, model))).toBe([
            'text <!--MC:a-->x<!--MC:~a-->',
            '',
            HEAD_A,
            '[MC:n]: {"version":2,"status":"open"}',
            '',
        ].join('\n'));
    });

    it('creates the appendix at the end when the document had no definitions', () => {
        const { states, model } = extractCommentModel(parse('just prose\n'));

        model.threads.set('n', { id: 'n', status: 'open', replies: [] });

        expect(serialize(materializeCommentModel(states, model))).toBe(
            'just prose\n\n[MC:n]: {"version":2,"status":"open"}\n',
        );
    });

    it('drops a removed thread\'s lines without leaving an empty block', () => {
        const markdown = [
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '',
            HEAD_A,
            '',
            'omega',
            '',
        ].join('\n');
        const { states, model } = extractCommentModel(parse(markdown));

        model.threads.delete('a');
        model.anchors = model.anchors.filter(anchor => anchor.id !== 'a');

        expect(serialize(materializeCommentModel(states, model))).toBe(
            'alpha x\n\nomega\n',
        );
    });
});

describe('definition placement — transform through document ops', () => {
    const DOC = [
        'alpha <!--MC:a-->x<!--MC:~a-->',
        '',
        HEAD_A,
        '',
        'omega',
        '',
    ].join('\n');

    it('an edit elsewhere leaves a mid-document definition block in place', () => {
        const { states, model } = extractCommentModel(parse(DOC));

        // Insert a new paragraph at the top: everything shifts down one.
        const op = json1.insertOp([0], { name: 'paragraph', text: 'intro' });
        const nextStates = json1.type.apply(
            states as never,
            op,
        ) as unknown as typeof states;
        const nextModel = transformCommentAnchors(model, op, states, nextStates);

        expect(serialize(materializeCommentModel(nextStates, nextModel))).toBe([
            'intro',
            '',
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '',
            HEAD_A,
            '',
            'omega',
            '',
        ].join('\n'));
    });

    it('deleting the block a run is attached to detaches it to the trailing appendix', () => {
        const { states, model } = extractCommentModel(parse(DOC));

        // Remove the 'omega' paragraph — the clean index the run points at.
        const op = json1.removeOp([1]);
        const nextStates = json1.type.apply(
            states as never,
            op,
        ) as unknown as typeof states;
        const nextModel = transformCommentAnchors(model, op, states, nextStates);

        expect(serialize(materializeCommentModel(nextStates, nextModel))).toBe([
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '',
            HEAD_A,
            '',
        ].join('\n'));
    });
});

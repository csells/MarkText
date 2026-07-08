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

describe('definition placement — canonical payload re-serialization on save', () => {
    // comment-format.md pinned property 1: decodable payloads re-serialize
    // in canonical form. Each non-canonical-but-decodable input normalizes
    // on the first save (the byte round-trip is deliberately NOT identical).
    it('compacts interior whitespace and reorders keys to the stable order', () => {
        const markdown = [
            'text <!--MC:a-->x<!--MC:~a-->',
            '',
            '[MC:a]: { "status": "open", "version": 2 }',
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe([
            'text <!--MC:a-->x<!--MC:~a-->',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '',
        ].join('\n'));
    });

    it('unescapes non-ASCII escapes and strips label indentation', () => {
        const markdown = [
            'text <!--MC:a-->x<!--MC:~a-->',
            '',
            '  [MC:a]: {"version":2,"status":"open"}',
            '  [MC:a.0]: {"author":"Ada","createdAt":"t","body":"caf\\u00e9"}',
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe([
            'text <!--MC:a-->x<!--MC:~a-->',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '[MC:a.0]: {"author":"Ada","createdAt":"t","body":"café"}',
            '',
        ].join('\n'));
    });
});

describe('definition placement — text-embedded runs sharing a leaf with markers', () => {
    // The definition tokenizer deliberately has no start hook, so a
    // definition line lazy-continues into the preceding paragraph: markers
    // and the definition run then live in ONE leaf, and materialization
    // must splice both without corrupting either.
    it('round-trips a definition line directly after commented prose (after-edge run)', () => {
        const markdown = 'A <!--MC:a-->x<!--MC:~a--> line.\n[MC:a]: {"version":2,"status":"open"}\n';

        expect(roundTrip(markdown)).toBe(markdown);
    });

    it('round-trips a definition line between commented prose lines (before-edge run)', () => {
        const markdown = [
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '[MC:a]: {"version":2,"status":"open"}',
            'zeta',
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe(markdown);
    });

    it('round-trips markers AFTER the embedded definition line in the same leaf', () => {
        const markdown = [
            'plain prose',
            '[MC:a]: {"version":2,"status":"open"}',
            'tail <!--MC:a-->x<!--MC:~a--> here',
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe(markdown);
    });
});

describe('definition placement — documented canonicalizations (round-trip normalizations)', () => {
    // editing-invariants.md §Round-trip names these exactly; each is pinned
    // through the runtime extraction→materialization chain so a regression
    // in run-item resolution or thread re-serialization cannot silently
    // change what a no-edit save rewrites.
    it('renormalizes duplicate/gapped reply indexes to 0..n-1', () => {
        const markdown = [
            'text <!--MC:a-->x<!--MC:~a-->',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '[MC:a.7]: {"author":"Ada","createdAt":"t","body":"first"}',
            '[MC:a.7]: {"author":"Bob","createdAt":"t","body":"second"}',
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe([
            'text <!--MC:a-->x<!--MC:~a-->',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '[MC:a.0]: {"author":"Ada","createdAt":"t","body":"first"}',
            '[MC:a.1]: {"author":"Bob","createdAt":"t","body":"second"}',
            '',
        ].join('\n'));
    });

    it('canonicalizes interleaved thread lines into contiguous head-first blocks', () => {
        const markdown = [
            'text <!--MC:a-->x<!--MC:~a--> and <!--MC:b-->y<!--MC:~b-->.',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '[MC:b]: {"version":2,"status":"open"}',
            '[MC:a.0]: {"author":"Ada","createdAt":"t","body":"on a"}',
            '[MC:b.0]: {"author":"Bob","createdAt":"t","body":"on b"}',
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe([
            'text <!--MC:a-->x<!--MC:~a--> and <!--MC:b-->y<!--MC:~b-->.',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '[MC:a.0]: {"author":"Ada","createdAt":"t","body":"on a"}',
            '[MC:b]: {"version":2,"status":"open"}',
            '[MC:b.0]: {"author":"Bob","createdAt":"t","body":"on b"}',
            '',
        ].join('\n'));
    });

    it('canonicalizes a thread\'s own separated lines into one block at the head\'s run', () => {
        const markdown = [
            'text <!--MC:a-->x<!--MC:~a-->',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '',
            'middle prose',
            '',
            '[MC:a.0]: {"author":"Ada","createdAt":"t","body":"far reply"}',
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe([
            'text <!--MC:a-->x<!--MC:~a-->',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '[MC:a.0]: {"author":"Ada","createdAt":"t","body":"far reply"}',
            '',
            'middle prose',
            '',
        ].join('\n'));
    });

    it('a document-leading definition gains the block separator before directly-following prose', () => {
        const markdown = [
            '[MC:a]: {"version":2,"status":"open"}',
            'prose <!--MC:a-->x<!--MC:~a--> here',
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe([
            '[MC:a]: {"version":2,"status":"open"}',
            '',
            'prose <!--MC:a-->x<!--MC:~a--> here',
            '',
        ].join('\n'));
    });

    it('re-emits a mid-document blockquote-wrapped definition as a plain paragraph in place', () => {
        const markdown = [
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '',
            '> [MC:a]: {"version":2,"status":"open"}',
            '',
            'omega',
            '',
        ].join('\n');

        expect(roundTrip(markdown)).toBe([
            'alpha <!--MC:a-->x<!--MC:~a-->',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '',
            'omega',
            '',
        ].join('\n'));
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

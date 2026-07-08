import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../../state/markdownToState';
import ExportMarkdown from '../../state/stateToMarkdown';
import { commentModelResidue, extractCommentModel, materializeCommentModel } from '../model';

// P3 stage 1 (specs/architecture/comment-anchors.md): at runtime comments
// live out-of-band as OT anchors into CLEAN text. Extraction strips every
// MC byte out of the state tree into the model; materialization is the
// exact inverse at serialization time. These specs pin the two passes and
// their round-trip against the wire format.

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

function collectTexts(states: unknown[]): string[] {
    const texts: string[] = [];
    const walk = (nodes: unknown[]) => {
        for (const node of nodes as Array<Record<string, unknown>>) {
            if (typeof node.text === 'string')
                texts.push(node.text);
            if (Array.isArray(node.children))
                walk(node.children);
        }
    };
    walk(states);
    return texts;
}

const HEAD = '[MC:a]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z"}';
const REPLY_0 = '[MC:a.0]: {"author":"Ada","createdAt":"2026-07-07T09:00:00.000Z","body":"First"}';

function v1DataUri(json: string): string {
    return `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
}

describe('extractCommentModel', () => {
    it('strips every MC byte from the state tree (no-MC-bytes invariant)', () => {
        const markdown = [
            'Hello <!--MC:a-->reviewed<!--MC:~a--> world.',
            '',
            HEAD,
            REPLY_0,
            '',
        ].join('\n');

        const { states, model } = extractCommentModel(parse(markdown));

        for (const text of collectTexts(states)) {
            expect(text).not.toContain('<!--MC:');
            expect(text).not.toMatch(/^ {0,3}\[MC:/u);
        }
        expect(model.threads.get('a')).toMatchObject({
            id: 'a',
            status: 'open',
            replies: [{ author: 'Ada', body: 'First' }],
        });
    });

    it('records anchors at clean-text offsets in state-path space', () => {
        const markdown = `Hello <!--MC:a-->reviewed<!--MC:~a--> world.\n\n${HEAD}\n`;

        const { states, model } = extractCommentModel(parse(markdown));

        expect((states[0] as { text: string }).text).toBe('Hello reviewed world.');
        expect(model.anchors).toEqual([
            { id: 'a', kind: 'open', position: [0, 'text', 'Hello '.length] },
            { id: 'a', kind: 'close', position: [0, 'text', 'Hello reviewed'.length] },
        ]);
    });

    it('anchors cross-block ranges in each leaf they touch', () => {
        const markdown = [
            'Alpha <!--MC:x-->tail.',
            '',
            '> Quoted <!--MC:~x-->rest.',
            '',
            '[MC:x]: {"version":2,"status":"open"}',
            '',
        ].join('\n');

        const { model } = extractCommentModel(parse(markdown));

        expect(model.anchors).toEqual([
            { id: 'x', kind: 'open', position: [0, 'text', 'Alpha '.length] },
            { id: 'x', kind: 'close', position: [1, 'children', 0, 'text', 'Quoted '.length] },
        ]);
    });

    it('keeps marker-shaped text in literal contexts as text, not anchors', () => {
        const markdown = [
            '```',
            '<!--MC:lit-->documentation<!--MC:~lit-->',
            '[MC:lit]: {"version":2,"status":"open"}',
            '```',
            '',
        ].join('\n');

        const { states, model } = extractCommentModel(parse(markdown));

        expect(model.anchors).toEqual([]);
        expect(model.threads.size).toBe(0);
        expect(collectTexts(states).join('\n')).toContain('<!--MC:lit-->');
    });

    it('decodes v1 heads with full fidelity', () => {
        const v1Line = `[MC:a]: ${v1DataUri(
            '{"version":1,"status":"resolved","replies":[{"author":"Ada","createdAt":"t","body":"note"}]}',
        )}`;
        const markdown = `Hello <!--MC:a-->x<!--MC:~a--> world.\n\n${v1Line}\n`;

        const { model } = extractCommentModel(parse(markdown));

        expect(model.threads.get('a')).toMatchObject({
            status: 'resolved',
            replies: [{ author: 'Ada', body: 'note' }],
        });
    });

    it('keeps undecodable and duplicate definition lines verbatim as residue', () => {
        const markdown = [
            'Hello <!--MC:a-->x<!--MC:~a--> world.',
            '',
            HEAD,
            HEAD,
            '[MC:a.0]: {not json',
            '[MC:ghost.0]: {"author":"A","createdAt":"t","body":"orphan"}',
            '',
        ].join('\n');

        const { model } = extractCommentModel(parse(markdown));

        expect(model.threads.size).toBe(1);
        expect(commentModelResidue(model)).toEqual([
            HEAD,
            '[MC:a.0]: {not json',
            '[MC:ghost.0]: {"author":"A","createdAt":"t","body":"orphan"}',
        ]);
    });

    it('keeps a metadata-only thread as a detached thread (no anchors)', () => {
        const markdown = `No markers here.\n\n${HEAD}\n${REPLY_0}\n`;

        const { model } = extractCommentModel(parse(markdown));

        expect(model.threads.get('a')).toBeDefined();
        expect(model.anchors).toEqual([]);
    });

    it('does not mutate its input states', () => {
        const states = parse(`Hello <!--MC:a-->x<!--MC:~a--> world.\n\n${HEAD}\n`);
        const before = JSON.stringify(states);

        extractCommentModel(states);

        expect(JSON.stringify(states)).toBe(before);
    });
});

describe('materializeCommentModel round-trip', () => {
    const CORPUS: Array<[string, string]> = [
        [
            'single block',
            `Hello <!--MC:a-->reviewed<!--MC:~a--> world.\n\n${HEAD}\n${REPLY_0}\n`,
        ],
        [
            'cross block',
            [
                'Alpha <!--MC:x-->tail.',
                '',
                'Beta <!--MC:~x-->rest.',
                '',
                '[MC:x]: {"version":2,"status":"open"}',
                '',
            ].join('\n'),
        ],
        [
            'overlapping ranges',
            [
                '<!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->',
                '',
                '[MC:a]: {"version":2,"status":"open"}',
                '[MC:b]: {"version":2,"status":"resolved"}',
                '',
            ].join('\n'),
        ],
        [
            'adjacent markers at one offset',
            [
                'A <!--MC:a--><!--MC:b-->x<!--MC:~b--><!--MC:~a--> z.',
                '',
                '[MC:a]: {"version":2,"status":"open"}',
                '[MC:b]: {"version":2,"status":"open"}',
                '',
            ].join('\n'),
        ],
        [
            'container nesting',
            [
                '> Quoted <!--MC:q-->text<!--MC:~q--> line.',
                '',
                '- Item <!--MC:l-->text<!--MC:~l--> here',
                '',
                '[MC:q]: {"version":2,"status":"open"}',
                '[MC:l]: {"version":2,"status":"open"}',
                '',
            ].join('\n'),
        ],
        [
            'astral text before markers',
            `😀😀 <!--MC:a-->reviewed<!--MC:~a--> 😀.\n\n${HEAD}\n`,
        ],
        [
            'detached metadata-only thread',
            `No markers here.\n\n${HEAD}\n${REPLY_0}\n`,
        ],
        [
            'residue lines preserved verbatim',
            [
                'Hello <!--MC:a-->x<!--MC:~a--> world.',
                '',
                HEAD,
                '[MC:a.0]: {not json',
                '',
            ].join('\n'),
        ],
    ];

    for (const [label, markdown] of CORPUS) {
        it(`round-trips ${label} byte-identically`, () => {
            expect(roundTrip(markdown)).toBe(markdown);
        });
    }

    it('serializes a mutated model as v2 (v1 upgrade happens at materialization)', () => {
        const v1Line = `[MC:a]: ${v1DataUri('{"version":1,"status":"open","replies":[]}')}`;
        const markdown = `Hello <!--MC:a-->x<!--MC:~a--> world.\n\n${v1Line}\n`;
        const { states, model } = extractCommentModel(parse(markdown));

        const thread = model.threads.get('a');
        if (!thread)
            throw new Error('thread missing');
        thread.status = 'resolved';

        const output = serialize(materializeCommentModel(states, model));
        expect(output).toContain('[MC:a]: {"version":2,"status":"resolved"}');
        expect(output).not.toContain('data:application/json;base64,');
    });
});

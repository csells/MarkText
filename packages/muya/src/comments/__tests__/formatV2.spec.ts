import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    appendCommentReplyMetadata,
    updateCommentMetadataInMarkdown,
} from '../edit';
import {
    decodeCommentHeadPayload,
    decodeCommentReplyPayload,
    encodeCommentHeadPayload,
    encodeCommentReplyPayload,
    serializeCommentThreadLines,
} from '../metadata';
import { parseMarkdownComments } from '../parse';
import { parseCommentReplyDefinition, serializeCommentReplyDefinition } from '../syntax';

// Wire format v2 (specs/architecture/comment-format.md): line-oriented thread
// metadata — one head line per thread, one line per reply — designed for
// git-mergeable diffs. These specs pin the grammar, the payload codecs, the
// parse semantics (positional reply attachment, derived updatedAt, the two
// reply diagnostics), v1 read-compat, and the single-line append property.

function v1DataUri(json: string): string {
    return `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
}

const HEAD = '[MC:cmt_1]: {"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z"}';
const REPLY_0 = '[MC:cmt_1.0]: {"author":"Ada","createdAt":"2026-07-07T09:00:00.000Z","body":"First line\\nsecond line"}';
const REPLY_1 = '[MC:cmt_1.1]: {"author":"Agent","createdAt":"2026-07-07T09:05:00.000Z","body":"Reply text"}';
const BODY_LINE = 'Hello <!--MC:cmt_1-->reviewed<!--MC:~cmt_1--> world.';

function v2Doc(...metadataLines: string[]): string {
    return [BODY_LINE, '', ...metadataLines, ''].join('\n');
}

describe('v2 line grammar', () => {
    it('parses a reply definition line into id, index, and payload', () => {
        expect(parseCommentReplyDefinition(REPLY_1)).toEqual({
            id: 'cmt_1',
            index: 1,
            payload: '{"author":"Agent","createdAt":"2026-07-07T09:05:00.000Z","body":"Reply text"}',
        });
    });

    it('allows up to three leading spaces, like every definition line', () => {
        expect(parseCommentReplyDefinition(`   ${REPLY_0}`)?.index).toBe(0);
        expect(parseCommentReplyDefinition(`    ${REPLY_0}`)).toBeNull();
    });

    it('does not parse head lines or non-numeric suffixes as replies', () => {
        expect(parseCommentReplyDefinition(HEAD)).toBeNull();
        expect(parseCommentReplyDefinition('[MC:cmt_1.x]: {}')).toBeNull();
        expect(parseCommentReplyDefinition('[MC:.0]: {}')).toBeNull();
    });

    it('serializes a reply definition line', () => {
        expect(serializeCommentReplyDefinition('cmt_1', 1, '{"author":"A","createdAt":"t","body":"b"}'))
            .toBe('[MC:cmt_1.1]: {"author":"A","createdAt":"t","body":"b"}');
    });
});

describe('v2 payload codecs', () => {
    it('encodes the head payload with stable key order and no replies key', () => {
        const payload = encodeCommentHeadPayload({
            display: { pinned: true },
            updatedAt: '2026-07-07T10:00:00.000Z',
            createdAt: '2026-07-07T09:00:00.000Z',
            authors: ['Ada'],
            status: 'open',
            replies: [{ author: 'Ada', createdAt: 't', body: 'ignored on head' }],
        });

        expect(payload).toBe(
            '{"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z","updatedAt":"2026-07-07T10:00:00.000Z","display":{"pinned":true}}',
        );
    });

    it('encodes the reply payload with stable key order and escaped newlines', () => {
        expect(encodeCommentReplyPayload({
            body: 'line one\nline two',
            createdAt: '2026-07-07T09:05:00.000Z',
            author: 'Agent',
        })).toBe('{"author":"Agent","createdAt":"2026-07-07T09:05:00.000Z","body":"line one\\nline two"}');
    });

    it('decodes a v2 head payload', () => {
        const head = decodeCommentHeadPayload(
            '{"version":2,"status":"resolved","createdAt":"2026-07-07T09:00:00.000Z"}',
        );
        expect(head).toEqual({
            status: 'resolved',
            createdAt: '2026-07-07T09:00:00.000Z',
            replies: [],
        });
    });

    it('decodes a v1 data-URI payload including its embedded replies', () => {
        const head = decodeCommentHeadPayload(v1DataUri(
            '{"version":1,"status":"open","authors":["Ada"],"replies":[{"author":"Ada","createdAt":"t1","body":"note"}]}',
        ));
        expect(head).toEqual({
            status: 'open',
            authors: ['Ada'],
            replies: [{ author: 'Ada', createdAt: 't1', body: 'note' }],
        });
    });

    it('rejects a v2 head payload carrying replies', () => {
        expect(() => decodeCommentHeadPayload('{"version":2,"status":"open","replies":[]}'))
            .toThrow(/replies/i);
    });

    it('rejects head payloads whose wire version does not match their encoding', () => {
        expect(() => decodeCommentHeadPayload('{"version":1,"status":"open"}')).toThrow(/version/i);
        expect(() => decodeCommentHeadPayload(v1DataUri('{"version":2,"status":"open","replies":[]}')))
            .toThrow(/version/i);
        expect(() => decodeCommentHeadPayload('not json')).toThrow();
    });

    it('decodes a reply payload strictly', () => {
        expect(decodeCommentReplyPayload('{"author":"A","createdAt":"t","body":"b"}'))
            .toEqual({ author: 'A', createdAt: 't', body: 'b' });
        expect(() => decodeCommentReplyPayload('{"author":"A","createdAt":"t"}')).toThrow();
        expect(() => decodeCommentReplyPayload('{"author":"A","createdAt":"t","body":"b","anchorOffset":3}'))
            .toThrow(/anchor/i);
    });

    it('serializes a thread as one head line plus one line per reply with normalized indexes', () => {
        expect(serializeCommentThreadLines('cmt_1', {
            status: 'open',
            authors: ['Ada'],
            createdAt: '2026-07-07T09:00:00.000Z',
            replies: [
                { author: 'Ada', createdAt: '2026-07-07T09:00:00.000Z', body: 'First line\nsecond line' },
                { author: 'Agent', createdAt: '2026-07-07T09:05:00.000Z', body: 'Reply text' },
            ],
        })).toEqual([HEAD, REPLY_0, REPLY_1]);
    });
});

describe('v2 parse semantics', () => {
    it('attaches reply lines to their thread ordered by document position', () => {
        const parsed = parseMarkdownComments(v2Doc(HEAD, REPLY_0, REPLY_1));
        expect(parsed.diagnostics).toEqual([]);
        expect(parsed.threads).toHaveLength(1);
        expect(parsed.threads[0].replies.map(reply => reply.body)).toEqual([
            'First line\nsecond line',
            'Reply text',
        ]);
    });

    it('treats reply indexes as positional hints: gaps and duplicates still parse in order', () => {
        const gapped = REPLY_1.replace('[MC:cmt_1.1]', '[MC:cmt_1.7]');
        const duplicated = REPLY_1.replace('"Reply text"', '"Third"');
        const parsed = parseMarkdownComments(v2Doc(HEAD, gapped, duplicated, REPLY_0.replace('[MC:cmt_1.0]', '[MC:cmt_1.7]')));
        expect(parsed.diagnostics).toEqual([]);
        expect(parsed.threads[0].replies.map(reply => reply.body)).toEqual([
            'Reply text',
            'Third',
            'First line\nsecond line',
        ]);
    });

    it('parses interleaved reply lines and heads in any order', () => {
        const headB = '[MC:b]: {"version":2,"status":"open"}';
        const replyB = '[MC:b.0]: {"author":"B","createdAt":"t","body":"b reply"}';
        const doc = [
            'One <!--MC:cmt_1-->x<!--MC:~cmt_1--> two <!--MC:b-->y<!--MC:~b--> three.',
            '',
            REPLY_0,
            headB,
            HEAD,
            replyB,
            '',
        ].join('\n');
        const parsed = parseMarkdownComments(doc);
        expect(parsed.diagnostics).toEqual([]);
        expect(parsed.threads.find(thread => thread.id === 'cmt_1')?.replies.map(reply => reply.body))
            .toEqual(['First line\nsecond line']);
        expect(parsed.threads.find(thread => thread.id === 'b')?.replies.map(reply => reply.body))
            .toEqual(['b reply']);
    });

    it('derives the thread updatedAt from the newest of head and replies', () => {
        const parsed = parseMarkdownComments(v2Doc(HEAD, REPLY_0, REPLY_1));
        expect(parsed.threads[0].updatedAt).toBe('2026-07-07T09:05:00.000Z');

        const headWithNewerUpdate = HEAD.replace(
            '"createdAt":"2026-07-07T09:00:00.000Z"',
            '"createdAt":"2026-07-07T09:00:00.000Z","updatedAt":"2026-07-07T11:00:00.000Z"',
        );
        const reparsed = parseMarkdownComments(v2Doc(headWithNewerUpdate, REPLY_0, REPLY_1));
        expect(reparsed.threads[0].updatedAt).toBe('2026-07-07T11:00:00.000Z');
    });

    it('derives thread authors from head authors plus reply authors', () => {
        const parsed = parseMarkdownComments(v2Doc(
            HEAD,
            REPLY_0,
            '[MC:cmt_1.1]: {"author":"Zoe","createdAt":"2026-07-07T09:05:00.000Z","body":"hi"}',
        ));
        expect(parsed.threads[0].authors).toEqual(['Ada', 'Zoe']);
    });

    it('reports a reply line without a head as orphan-reply', () => {
        const parsed = parseMarkdownComments(v2Doc('[MC:ghost.0]: {"author":"A","createdAt":"t","body":"b"}', HEAD));
        expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
            code: 'orphan-reply',
            id: 'ghost',
        }));
    });

    it('reports a malformed reply payload as invalid-reply and keeps the rest of the thread', () => {
        const parsed = parseMarkdownComments(v2Doc(HEAD, '[MC:cmt_1.0]: {not json', REPLY_1));
        expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
            code: 'invalid-reply',
            id: 'cmt_1',
        }));
        expect(parsed.threads[0].replies.map(reply => reply.body)).toEqual(['Reply text']);
    });

    it('decodes a v1 document identically to its v2 equivalent', () => {
        const v1Line = `[MC:cmt_1]: ${v1DataUri(
            '{"version":1,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z","replies":['
            + '{"author":"Ada","createdAt":"2026-07-07T09:00:00.000Z","body":"First line\\nsecond line"},'
            + '{"author":"Agent","createdAt":"2026-07-07T09:05:00.000Z","body":"Reply text"}]}',
        )}`;
        const fromV1 = parseMarkdownComments(v2Doc(v1Line));
        const fromV2 = parseMarkdownComments(v2Doc(HEAD, REPLY_0, REPLY_1));
        expect(fromV1.diagnostics).toEqual([]);
        expect(fromV1.threads).toEqual(fromV2.threads);
    });

    it('flags a v1 and a v2 head for the same id as duplicate-metadata', () => {
        const v1Line = `[MC:cmt_1]: ${v1DataUri('{"version":1,"status":"open","replies":[]}')}`;
        const parsed = parseMarkdownComments(v2Doc(HEAD, v1Line));
        expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
            code: 'duplicate-metadata',
            id: 'cmt_1',
        }));
    });
});

describe('v2 mutation line discipline', () => {
    const REPLY_2 = '[MC:cmt_1.2]: {"author":"Zoe","createdAt":"2026-07-07T09:10:00.000Z","body":"Appended"}';

    it('appending a reply adds exactly one line and rewrites nothing else', () => {
        const doc = v2Doc(HEAD, REPLY_0, REPLY_1);
        const next = updateCommentMetadataInMarkdown(doc, 'cmt_1', metadata =>
            appendCommentReplyMetadata(metadata, {
                author: 'Zoe',
                body: 'Appended',
                createdAt: '2026-07-07T09:10:00.000Z',
            }));

        expect(next).toBe(v2Doc(HEAD, REPLY_0, REPLY_1, REPLY_2));
    });

    // The pinned property's parenthetical: "(plus a trailing newline if
    // absent)". Appending to an unterminated file terminates it, so the
    // NEXT append no longer churns the last line in diff terms.
    it('appending to a file without a final newline adds the reply line and terminates the file', () => {
        const doc = [BODY_LINE, '', HEAD, REPLY_0].join('\n');
        const appended = '[MC:cmt_1.1]: {"author":"Zoe","createdAt":"2026-07-07T09:10:00.000Z","body":"Appended"}';

        const next = updateCommentMetadataInMarkdown(doc, 'cmt_1', metadata =>
            appendCommentReplyMetadata(metadata, {
                author: 'Zoe',
                body: 'Appended',
                createdAt: '2026-07-07T09:10:00.000Z',
            }));

        expect(next).toBe(`${doc}\n${appended}\n`);
    });

    it('a status change rewrites exactly the head line', () => {
        const doc = v2Doc(HEAD, REPLY_0, REPLY_1);
        const next = updateCommentMetadataInMarkdown(doc, 'cmt_1', metadata => ({
            ...metadata,
            status: 'resolved',
        }));

        expect(next).toBe(v2Doc(HEAD.replace('"status":"open"', '"status":"resolved"'), REPLY_0, REPLY_1));
    });

    it('editing one reply rewrites exactly that reply line', () => {
        const doc = v2Doc(HEAD, REPLY_0, REPLY_1);
        const next = updateCommentMetadataInMarkdown(doc, 'cmt_1', metadata => ({
            ...metadata,
            replies: metadata.replies.map((reply, index) =>
                index === 1 ? { ...reply, body: 'Reply text (edited)' } : reply),
        }));

        expect(next).toBe(v2Doc(HEAD, REPLY_0, REPLY_1.replace('"Reply text"', '"Reply text (edited)"')));
    });

    it('removing a reply deletes its line', () => {
        const doc = v2Doc(HEAD, REPLY_0, REPLY_1);
        const next = updateCommentMetadataInMarkdown(doc, 'cmt_1', metadata => ({
            ...metadata,
            replies: metadata.replies.slice(0, 1),
        }));

        expect(next).toBe(v2Doc(HEAD, REPLY_0));
    });

    // Mutation locates the definition through the analyzer, so it must accept
    // the same analysis options a differently-configured editor parses with:
    // a footnote-context definition is invisible to the default lex (the
    // indented line reads as code) but mutable when footnote parsing is on.
    it('honors analysis options: a footnote-context definition is found and rewritten', () => {
        const doc = [
            'A <!--MC:cmt_1-->reviewed<!--MC:~cmt_1--> line.',
            '',
            '[^note]: footnote text',
            '    [MC:cmt_1]: {"version":2,"status":"open"}',
            '',
        ].join('\n');

        expect(updateCommentMetadataInMarkdown(doc, 'cmt_1', metadata => ({
            ...metadata,
            status: 'resolved',
        }))).toBeNull();

        const next = updateCommentMetadataInMarkdown(doc, 'cmt_1', metadata => ({
            ...metadata,
            status: 'resolved',
        }), { footnote: true });

        expect(next).toBe(doc.replace('"status":"open"', '"status":"resolved"'));
    });

    it('mutating a v1 thread rewrites it as v2 lines with identical decoded content', () => {
        const v1Line = `[MC:cmt_1]: ${v1DataUri(
            '{"version":1,"status":"open","authors":["Ada"],"createdAt":"2026-07-07T09:00:00.000Z","replies":['
            + '{"author":"Ada","createdAt":"2026-07-07T09:00:00.000Z","body":"First line\\nsecond line"}]}',
        )}`;
        const next = updateCommentMetadataInMarkdown(v2Doc(v1Line), 'cmt_1', metadata =>
            appendCommentReplyMetadata(metadata, {
                author: 'Agent',
                body: 'Reply text',
                createdAt: '2026-07-07T09:05:00.000Z',
            }));

        expect(next).toBe(v2Doc(HEAD, REPLY_0, REPLY_1));
    });

    it('appending a reply never touches head updatedAt (it is derived at read)', () => {
        const appended = appendCommentReplyMetadata(
            {
                status: 'open',
                createdAt: '2026-07-07T09:00:00.000Z',
                replies: [],
            },
            { author: 'Zoe', body: 'hi', createdAt: '2026-07-07T09:10:00.000Z' },
        );
        expect(appended.updatedAt).toBeUndefined();
    });
});

import type { TState } from '../types';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    COMMENT_METADATA_DATA_URI_PREFIX,
    decodeCommentMetadata,
    encodeCommentMetadata,
    parseMarkdownComments,
    updateCommentMetadataInMarkdown,
    validateCommentGraph,
} from '../../comments';
import { MarkdownToState } from '../markdownToState';
import ExportMarkdown from '../stateToMarkdown';

function metadata(data: Record<string, unknown>) {
    return `data:application/json;base64,${Buffer.from(JSON.stringify(data)).toString('base64')}`;
}

function roundTrip(markdown: string) {
    const states = new MarkdownToState({
        footnote: false,
        math: false,
        isGitlabCompatibilityEnabled: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: false,
    }).generate(markdown);

    return new ExportMarkdown().generate(states);
}

describe('markdown comments - state round-trip', () => {
    it('keeps markdown comment source files text-reviewable', () => {
        const source = readFileSync(join(process.cwd(), 'src/state/markdownToState.ts'), 'utf8');

        expect(source).not.toContain('\0');
    });

    it('preserves inline range markers and metadata definitions', () => {
        const meta = metadata({
            version: 1,
            status: 'open',
            authors: ['Ada'],
            createdAt: '2026-06-30T12:00:00.000Z',
            updatedAt: '2026-06-30T12:00:00.000Z',
            replies: [],
        });
        const markdown = `A <!--MC:cmt_1-->reviewed span<!--MC:~cmt_1-->.\n\n[MC:cmt_1]: ${meta}\n`;

        const output = roundTrip(markdown);

        expect(output).toContain('<!--MC:cmt_1-->reviewed span<!--MC:~cmt_1-->');
        expect(output).toContain(`[MC:cmt_1]: ${meta}`);
    });

    it('derives ranges from editable Markdown blocks without losing serializer bytes', () => {
        const ids = [
            'heading',
            'paragraph',
            'blockquote',
            'bullet',
            'ordered',
            'task',
            'emphasis',
            'strong',
            'link',
            'table',
        ];
        const markdown = [
            '# <!--MC:heading-->Heading<!--MC:~heading-->',
            '',
            'A <!--MC:paragraph-->paragraph<!--MC:~paragraph--> line.',
            '',
            '> A <!--MC:blockquote-->quoted<!--MC:~blockquote--> line.',
            '',
            '- A <!--MC:bullet-->bullet<!--MC:~bullet--> item',
            '1. An <!--MC:ordered-->ordered<!--MC:~ordered--> item',
            '- [ ] A <!--MC:task-->task<!--MC:~task--> item',
            '',
            'Inline *<!--MC:emphasis-->emphasis<!--MC:~emphasis-->* and **<!--MC:strong-->strong<!--MC:~strong-->**.',
            '',
            '[<!--MC:link-->linked<!--MC:~link--> text](https://example.com)',
            '',
            '| Column |',
            '| --- |',
            '| <!--MC:table-->cell<!--MC:~table--> |',
            '',
            ...ids.map(id => `[MC:${id}]: ${metadata({ version: 1, status: 'open', replies: [] })}`),
            '',
        ].join('\n');

        const output = roundTrip(markdown);
        const result = parseMarkdownComments(markdown);

        expect(result.diagnostics).toEqual([]);
        expect(result.threads.map(thread => thread.id)).toEqual(ids);
        for (const id of ids) {
            expect(result.ranges.some(range => range.id === id)).toBe(true);
            expect(output).toContain(`<!--MC:${id}-->`);
            expect(output).toContain(`<!--MC:~${id}-->`);
            expect(output).toContain(`[MC:${id}]:`);
        }
    });

    it('derives overlapping ranges from paired explicit close IDs', () => {
        const markdown = [
            '<!--MC:a-->alpha <!--MC:b-->beta<!--MC:~a--> gamma<!--MC:~b-->',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            `[MC:b]: ${metadata({ version: 1, status: 'resolved', replies: [] })}`,
            '',
        ].join('\n');

        const result = parseMarkdownComments(markdown);

        expect(result.diagnostics).toEqual([]);
        expect(result.ranges.map(r => [r.id, r.startOffset, r.endOffset])).toEqual([
            ['a', 11, 32],
            ['b', 28, 50],
        ]);
        expect(result.threads.map(t => [t.id, t.status])).toEqual([
            ['a', 'open'],
            ['b', 'resolved'],
        ]);
    });

    it('derives comments from UTF-8 BOM and CRLF Markdown input', () => {
        const markdown = [
            '\uFEFFA <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\r\n');

        const result = parseMarkdownComments(markdown);

        expect(result.diagnostics).toEqual([]);
        expect(result.ranges).toEqual([
            expect.objectContaining({
                id: 'a',
            }),
        ]);
        expect(result.threads).toEqual([
            expect.objectContaining({
                id: 'a',
                status: 'open',
            }),
        ]);
    });

    it('imports line-start MC marker prose as editable paragraph text', () => {
        const states = new MarkdownToState().generate('<!--MC:a-->alpha<!--MC:~a-->\n');

        expect(states).toEqual([
            {
                name: 'paragraph',
                text: '<!--MC:a-->alpha<!--MC:~a-->',
            },
        ]);
    });

    it('preserves standalone marker boundary lines as editable paragraphs', () => {
        const meta = metadata({ version: 1, status: 'open', replies: [] });
        const markdown = [
            '<!--MC:a-->',
            '',
            'reviewed paragraph',
            '',
            '<!--MC:~a-->',
            '',
            `[MC:a]: ${meta}`,
            '',
        ].join('\n');

        const states = new MarkdownToState().generate(markdown);
        const output = roundTrip(markdown);
        const result = parseMarkdownComments(markdown);

        expect(states.slice(0, 3)).toEqual([
            {
                name: 'paragraph',
                text: '<!--MC:a-->',
            },
            {
                name: 'paragraph',
                text: 'reviewed paragraph',
            },
            {
                name: 'paragraph',
                text: '<!--MC:~a-->',
            },
        ]);
        expect(output).toContain(`<!--MC:a-->\n\nreviewed paragraph\n\n<!--MC:~a-->\n\n[MC:a]: ${meta}`);
        expect(result.diagnostics).toEqual([]);
        expect(result.ranges).toEqual([
            expect.objectContaining({
                id: 'a',
                startOffset: '<!--MC:a-->'.length,
                endOffset: 0,
            }),
        ]);
    });

    it('keeps true raw HTML blocks raw when MC markers comment on HTML', () => {
        const states = new MarkdownToState().generate('<!--MC:a--><div>raw</div><!--MC:~a-->\n');

        expect(states).toEqual([
            {
                name: 'html-block',
                text: '<!--MC:a--><div>raw</div><!--MC:~a-->',
            },
        ]);
    });

    it('does not derive review ranges from true raw HTML blocks', () => {
        const markdown = [
            '<!--MC:a--><div>raw</div><!--MC:~a-->',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');

        const result = parseMarkdownComments(markdown);

        expect(result.ranges).toEqual([]);
        expect(result.threads).toEqual([]);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                code: 'orphan-metadata',
                id: 'a',
            }),
        ]);
    });

    it('does not treat markers inside fenced code as comment ranges', () => {
        const markdown = '```md\n<!--MC:cmt_1-->literal<!--MC:~cmt_1-->\n```\n';
        const result = parseMarkdownComments(markdown);

        expect(result.ranges).toEqual([]);
        expect(result.diagnostics).toEqual([]);
    });

    it('does not treat metadata definitions inside fenced code as live metadata', () => {
        const markdown = [
            '```md',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '```',
            '',
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
        ].join('\n');
        const result = parseMarkdownComments(markdown);

        expect(result.threads).toEqual([]);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                code: 'missing-metadata',
                id: 'a',
            }),
        ]);
    });

    it.each([
        ['front matter', ['---', '[MC:a]: __META__', '---']],
        ['math blocks', ['$$', '[MC:a]: __META__', '$$']],
        ['raw HTML blocks', ['<div>', '[MC:a]: __META__', '</div>']],
        ['indented code blocks', ['    [MC:a]: __META__']],
    ])('does not treat metadata definitions inside %s as live metadata', (_label, wrapper) => {
        const meta = metadata({ version: 1, status: 'open', replies: [] });
        const markdown = [
            ...wrapper.map(line => line.replace('__META__', meta)),
            '',
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
        ].join('\n');
        const result = parseMarkdownComments(markdown);

        expect(result.threads).toEqual([]);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                code: 'missing-metadata',
                id: 'a',
            }),
        ]);
    });

    it('keeps metadata live after an unclosed front matter-looking opener', () => {
        const markdown = [
            '---',
            'not actually closed front matter',
            '',
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');
        const result = parseMarkdownComments(markdown);

        expect(result.diagnostics).toEqual([]);
        expect(result.threads).toEqual([
            expect.objectContaining({
                id: 'a',
                status: 'open',
            }),
        ]);
    });

    it('does not treat marker-looking text inside inline code as a comment range', () => {
        const markdown = '`<!--MC:cmt_1-->literal<!--MC:~cmt_1-->`\n';
        const output = roundTrip(markdown);
        const result = parseMarkdownComments(markdown);

        expect(output).toContain('`<!--MC:cmt_1-->literal<!--MC:~cmt_1-->`');
        expect(result.ranges).toEqual([]);
        expect(result.diagnostics).toEqual([]);
    });

    it('reports malformed structures without dropping source bytes', () => {
        const markdown = [
            'Text <!--MC:a-->open only and <!--MC:~missing-->orphan close.',
            '',
            `[MC:orphan]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');

        const output = roundTrip(markdown);
        const result = parseMarkdownComments(markdown);

        expect(output).toContain('<!--MC:a-->open only');
        expect(output).toContain('<!--MC:~missing-->orphan close');
        expect(result.diagnostics.map(d => d.code)).toEqual([
            'orphan-close-marker',
            'unclosed-open-marker',
            'orphan-metadata',
        ]);
    });

    it('reports a duplicate marker id when a second complete range reuses it', () => {
        const markdown = [
            '<!--MC:a-->first<!--MC:~a--> and <!--MC:a-->second<!--MC:~a-->',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');

        const result = parseMarkdownComments(markdown);

        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                code: 'duplicate-open-marker',
                id: 'a',
            }),
        ]);
    });

    it('reports duplicate metadata even when the first definition is malformed', () => {
        const markdown = [
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            `[MC:a]: ${metadata({})}`,
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');

        const output = roundTrip(markdown);
        const result = parseMarkdownComments(markdown);

        expect(output.match(/\[MC:a\]:/gu)).toHaveLength(2);
        expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
            'invalid-metadata',
            'duplicate-metadata',
        ]);
    });

    it('rejects metadata fields outside the portable thread schema', () => {
        const markdown = [
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            `[MC:a]: ${metadata({
                version: 1,
                status: 'open',
                workflow: { externalId: 'jira-1' },
                replies: [],
            })}`,
            '',
        ].join('\n');
        const result = parseMarkdownComments(markdown);

        expect(result.threads).toEqual([]);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                code: 'invalid-metadata',
                id: 'a',
            }),
            expect.objectContaining({
                code: 'missing-metadata',
                id: 'a',
            }),
        ]);
    });

    it('rejects alternate anchor metadata even when the key is not an exact forbidden-key match', () => {
        const markdown = [
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            `[MC:a]: ${metadata({
                version: 1,
                status: 'open',
                display: {
                    label: 'Design review',
                },
                alternateAnchorText: 'reviewed',
                replies: [],
            })}`,
            '',
        ].join('\n');
        const result = parseMarkdownComments(markdown);

        expect(result.threads).toEqual([]);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                code: 'invalid-metadata',
                id: 'a',
            }),
            expect.objectContaining({
                code: 'missing-metadata',
                id: 'a',
            }),
        ]);
    });

    it('allows optional display metadata while rejecting anchor-like display data', () => {
        const valid = parseMarkdownComments([
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            `[MC:a]: ${metadata({
                version: 1,
                status: 'open',
                display: {
                    color: 'amber',
                    label: 'Design review',
                },
                replies: [],
            })}`,
            '',
        ].join('\n'));
        const invalid = parseMarkdownComments([
            'A <!--MC:b-->reviewed<!--MC:~b--> line.',
            '',
            `[MC:b]: ${metadata({
                version: 1,
                status: 'open',
                display: {
                    anchorOffset: 4,
                },
                replies: [],
            })}`,
            '',
        ].join('\n'));

        expect(valid.diagnostics).toEqual([]);
        expect(valid.threads[0]).toMatchObject({
            id: 'a',
            display: {
                color: 'amber',
                label: 'Design review',
            },
        });
        expect(invalid.threads).toEqual([]);
        expect(invalid.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
            'invalid-metadata',
            'missing-metadata',
        ]);
    });

    it('reports invalid metadata even when a valid duplicate definition appears first', () => {
        const markdown = [
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            `[MC:a]: ${COMMENT_METADATA_DATA_URI_PREFIX}not-base64-json`,
            '',
        ].join('\n');

        const result = parseMarkdownComments(markdown);

        expect(result.threads).toEqual([
            expect.objectContaining({
                id: 'a',
                status: 'open',
            }),
        ]);
        expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
            'duplicate-metadata',
            'invalid-metadata',
        ]);
    });

    it('reports non-data MC reference definitions as invalid duplicate metadata', () => {
        const markdown = [
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            '[MC:a]: https://example.com/not-comment-metadata',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');

        const output = roundTrip(markdown);
        const result = parseMarkdownComments(markdown);

        expect(output.match(/\[MC:a\]:/gu)).toHaveLength(2);
        expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
            'invalid-metadata',
            'duplicate-metadata',
        ]);
    });

    it('reports empty metadata data URIs as malformed metadata', () => {
        const markdown = [
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            `[MC:a]: ${COMMENT_METADATA_DATA_URI_PREFIX}`,
            '',
        ].join('\n');

        const output = roundTrip(markdown);
        const result = parseMarkdownComments(markdown);

        expect(output).toContain(`[MC:a]: ${COMMENT_METADATA_DATA_URI_PREFIX}`);
        expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
            'invalid-metadata',
            'missing-metadata',
        ]);
    });

    it('reports malformed MC markers that look like comment anchors', () => {
        const markdown = 'A <!--MC:bad.id-->reviewed<!--MC:~bad.id--> line.\n';
        const result = parseMarkdownComments(markdown);

        expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
            'malformed-marker',
            'malformed-marker',
        ]);
        expect(result.ranges).toEqual([]);
    });

    it('reports duplicate close markers separately from orphan closes', () => {
        const markdown = [
            '<!--MC:a-->reviewed<!--MC:~a--><!--MC:~a-->',
            '',
            `[MC:a]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');

        const result = parseMarkdownComments(markdown);

        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                code: 'duplicate-close-marker',
                id: 'a',
            }),
        ]);
    });

    it('scans every inline-capable leaf text state while keeping non-prose leaves excluded', () => {
        const states: TState[] = [
            {
                name: 'paragraph',
                text: 'A <!--MC:legacy-->legacy leaf<!--MC:~legacy--> range.',
            },
            {
                name: 'link-reference-definition',
                text: `[MC:legacy]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            },
            {
                name: 'code-block',
                meta: { type: 'fenced', lang: 'md' },
                text: '<!--MC:code-->literal<!--MC:~code-->',
            },
            {
                name: 'html-block',
                text: '<!--MC:html-->literal<!--MC:~html-->',
            },
        ];

        const result = parseMarkdownComments(states);

        expect(result.diagnostics).toEqual([]);
        expect(result.threads.map(thread => thread.id)).toEqual(['legacy']);
        expect(result.ranges.map(range => range.id)).toEqual(['legacy']);
    });

    it('recognizes metadata definitions embedded in folded multi-line state text', () => {
        const states: TState[] = [
            {
                name: 'paragraph',
                text: [
                    'A <!--MC:folded-->folded leaf<!--MC:~folded--> range.',
                    `[MC:folded]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
                    'trailing prose',
                ].join('\n'),
            },
        ];

        const result = parseMarkdownComments(states);

        expect(result.diagnostics).toEqual([]);
        expect(result.threads).toEqual([
            expect.objectContaining({
                id: 'folded',
                status: 'open',
            }),
        ]);
    });

    it('exports a graph validator with the same diagnostics as parsing', () => {
        const markdown = [
            'Text <!--MC:a-->open only and <!--MC:~missing-->orphan close.',
            '',
            `[MC:orphan]: ${metadata({ version: 1, status: 'open', replies: [] })}`,
            '',
        ].join('\n');

        expect(validateCommentGraph(markdown)).toEqual(parseMarkdownComments(markdown).diagnostics);
    });
});

describe('markdown comments - metadata codec', () => {
    it('round-trips metadata with stable encoded JSON', () => {
        const encoded = encodeCommentMetadata({
            version: 1,
            status: 'open',
            authors: ['Ada'],
            createdAt: '2026-06-30T12:00:00.000Z',
            updatedAt: '2026-06-30T12:00:00.000Z',
            replies: [
                {
                    author: 'Grace',
                    createdAt: '2026-06-30T13:00:00.000Z',
                    body: 'Please clarify this.',
                },
            ],
        });

        expect(decodeCommentMetadata(encoded)).toEqual({
            version: 1,
            status: 'open',
            authors: ['Ada'],
            createdAt: '2026-06-30T12:00:00.000Z',
            updatedAt: '2026-06-30T12:00:00.000Z',
            replies: [
                {
                    author: 'Grace',
                    createdAt: '2026-06-30T13:00:00.000Z',
                    body: 'Please clarify this.',
                },
            ],
        });
    });

    it('preserves optional display metadata fields', () => {
        const encoded = encodeCommentMetadata({
            version: 1,
            status: 'open',
            display: {
                color: 'amber',
                label: 'Design review',
            },
            replies: [],
        });

        expect(decodeCommentMetadata(encoded)).toMatchObject({
            version: 1,
            status: 'open',
            display: {
                color: 'amber',
                label: 'Design review',
            },
            replies: [],
        });
    });

    it('rejects nested anchor or repair coordinates in display metadata', () => {
        expect(() =>
            encodeCommentMetadata({
                version: 1,
                status: 'open',
                display: {
                    label: 'Design review',
                    startOffset: 12,
                },
                replies: [],
            } as never),
        ).toThrow(/startOffset/);
    });

    it('canonicalizes nested display metadata key order', () => {
        const first = encodeCommentMetadata({
            version: 1,
            status: 'open',
            display: {
                label: 'Design review',
                color: 'amber',
            },
            replies: [],
        });
        const second = encodeCommentMetadata({
            version: 1,
            status: 'open',
            display: {
                color: 'amber',
                label: 'Design review',
            },
            replies: [],
        });

        expect(first).toBe(second);
        expect(decodeCommentMetadata(first)).toMatchObject({
            display: {
                color: 'amber',
                label: 'Design review',
            },
        });
    });

    it('rejects non-display extension fields', () => {
        expect(() =>
            encodeCommentMetadata({
                version: 1,
                status: 'open',
                z: 1,
                replies: [],
            } as never),
        ).toThrow(/portable thread schema/);
    });

    it('uses ordinal display key ordering for stable metadata encoding', () => {
        const encoded = encodeCommentMetadata({
            version: 1,
            status: 'open',
            display: {
                z: 1,
                ä: 2,
                a: 3,
            },
            replies: [],
        });
        const json = Buffer.from(
            encoded.slice(COMMENT_METADATA_DATA_URI_PREFIX.length),
            'base64',
        ).toString('utf8');

        expect(json).toBe('{"version":1,"status":"open","display":{"a":3,"z":1,"ä":2},"replies":[]}');
    });

    it('preserves display fields on replies', () => {
        const encoded = encodeCommentMetadata({
            version: 1,
            status: 'open',
            replies: [
                {
                    author: 'Ada',
                    createdAt: '2026-06-30T12:00:00.000Z',
                    body: 'First note.',
                    display: {
                        color: 'amber',
                    },
                },
            ],
        });

        expect(decodeCommentMetadata(encoded).replies[0]).toMatchObject({
            author: 'Ada',
            createdAt: '2026-06-30T12:00:00.000Z',
            body: 'First note.',
            display: {
                color: 'amber',
            },
        });
    });
});

describe('metadata definition round-trip stability', () => {
    const uri = () => metadata({ version: 1, status: 'open', replies: [] });

    it('does not duplicate an embedded metadata definition across repeated saves', () => {
        let current = `some prose line\n[MC:a]: ${uri()}\nmore prose\n`;
        for (let i = 0; i < 3; i += 1)
            current = roundTrip(current);

        expect((current.match(/\[MC:a\]:/gu) ?? []).length).toBe(1);
    });

    it('does not duplicate a metadata definition indented inside a list item', () => {
        let current = `- item\n\n  [MC:a]: ${uri()}\n`;
        for (let i = 0; i < 3; i += 1)
            current = roundTrip(current);

        expect((current.match(/\[MC:a\]:/gu) ?? []).length).toBe(1);
    });

    it('does not duplicate a marker-adjacent definition with no blank line', () => {
        let current = `A <!--MC:a-->reviewed<!--MC:~a--> line.\n[MC:a]: ${uri()}\n`;
        for (let i = 0; i < 3; i += 1)
            current = roundTrip(current);

        expect((current.match(/\[MC:a\]:/gu) ?? []).length).toBe(1);
    });
});

describe('metadata source edits', () => {
    const uri = () => metadata({ version: 1, status: 'open', replies: [] });

    it('updates the exact source metadata line without normalizing unrelated bytes', () => {
        const first = uri();
        const second = uri();
        const markdown = [
            '\uFEFFTitle\r',
            `A <!--MC:a-->reviewed<!--MC:~a--> line.\r\n`,
            `[MC:other]: ${first}  \n`,
            `[MC:a]: ${second}\t`,
        ].join('');

        const next = updateCommentMetadataInMarkdown(markdown, 'a', current => ({
            ...current,
            status: 'resolved',
        }));

        expect(next).not.toBeNull();
        expect(next).toMatch(/^\uFEFFTitle\rA/u);
        expect(next).toContain(`[MC:other]: ${first}  \n`);
        expect(next).toMatch(/\[MC:a\]: data:application\/json;base64,\S+\t$/u);
        expect(parseMarkdownComments(next!).threads[0]).toMatchObject({
            id: 'a',
            status: 'resolved',
        });
    });
});

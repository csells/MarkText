import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    decodeCommentMetadata,
    encodeCommentMetadata,
    parseMarkdownComments,
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

    it('imports line-start MC marker prose as editable paragraph text', () => {
        const states = new MarkdownToState().generate('<!--MC:a-->alpha<!--MC:~a-->\n');

        expect(states).toEqual([
            {
                name: 'paragraph',
                text: '<!--MC:a-->alpha<!--MC:~a-->',
            },
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

    it('does not treat markers inside fenced code as comment ranges', () => {
        const markdown = '```md\n<!--MC:cmt_1-->literal<!--MC:~cmt_1-->\n```\n';
        const result = parseMarkdownComments(markdown);

        expect(result.ranges).toEqual([]);
        expect(result.diagnostics).toEqual([]);
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
});

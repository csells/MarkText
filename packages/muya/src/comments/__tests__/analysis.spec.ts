import { describe, expect, it } from 'vitest';
import { analyzeMarkdownComments } from '../analyze';

const META = 'data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119';

describe('analyzeMarkdownComments', () => {
    // Definition lines are wire metadata: marker-shaped text inside a legal
    // JSON body must never create ranges or diagnostics — including in the
    // CONVENTIONAL contiguous head+reply layout, which tokenizes as one
    // multi-line state.
    it('does not scan definition-line payloads for markers in a contiguous head+reply run', () => {
        const markdown = [
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            '[MC:a]: {"version":2,"status":"open"}',
            '[MC:a.0]: {"author":"Ada","createdAt":"t","body":"see <!--MC:b-->this<!--MC:~b--> marker"}',
            '',
        ].join('\n');

        const { comments } = analyzeMarkdownComments(markdown);

        expect(comments.ranges.map(range => range.id)).toEqual(['a']);
        expect(comments.diagnostics).toEqual([]);
        expect(comments.threads[0]?.replies[0]?.body).toContain('<!--MC:b-->');
    });

    it('links parsed comment ranges to source offsets and syntax nodes', () => {
        const markdown = `A <!--MC:a-->reviewed<!--MC:~a--> span.\n\n[MC:a]: ${META}\n`;

        const analysis = analyzeMarkdownComments(markdown);

        expect(analysis.comments.diagnostics).toEqual([]);
        expect(analysis.ids).toEqual(new Set(['a']));
        expect(analysis.sourceIndex.commentRanges).toEqual([
            {
                id: 'a',
                start: markdown.indexOf('reviewed'),
                end: markdown.indexOf('reviewed') + 'reviewed'.length,
            },
        ]);
        expect(analysis.sourceMaps.ranges).toEqual([
            expect.objectContaining({
                id: 'a',
                range: expect.objectContaining({
                    id: 'a',
                    preview: 'reviewed',
                }),
                sourceRange: analysis.sourceIndex.commentRanges[0],
                openMarker: expect.objectContaining({
                    id: 'a',
                    kind: 'open',
                    start: markdown.indexOf('<!--MC:a-->'),
                }),
                closeMarker: expect.objectContaining({
                    id: 'a',
                    kind: 'close',
                    start: markdown.indexOf('<!--MC:~a-->'),
                }),
                metadataDefinition: expect.objectContaining({
                    id: 'a',
                    start: markdown.indexOf('[MC:a]:'),
                }),
                syntaxRemovalRanges: expect.any(Array),
            }),
        ]);
        let stripped = markdown;
        for (const range of analysis.sourceMaps.ranges[0].syntaxRemovalRanges)
            stripped = `${stripped.slice(0, range.start)}${stripped.slice(range.end)}`;
        expect(stripped).toBe('A reviewed span.\n');
    });

    it('links diagnostics to real source syntax without using marker-looking literals', () => {
        const markdown = [
            'Example `<!--MC:a-->literal<!--MC:~a-->` marker text.',
            '',
            `[MC:a]: ${META}`,
            '',
        ].join('\n');

        const analysis = analyzeMarkdownComments(markdown);

        expect(analysis.comments.diagnostics).toEqual([
            expect.objectContaining({
                code: 'orphan-metadata',
                id: 'a',
            }),
        ]);
        expect(analysis.sourceMaps.diagnostics).toEqual([
            expect.objectContaining({
                id: 'a',
                diagnostic: expect.objectContaining({ code: 'orphan-metadata' }),
                syntaxRange: expect.objectContaining({
                    start: markdown.indexOf('[MC:a]:'),
                    end: markdown.indexOf('[MC:a]:') + `[MC:a]: ${META}`.length,
                }),
            }),
        ]);
    });
});

import { describe, expect, it } from 'vitest';
import {
    buildCommentSourceIndex,
    buildSourceLineDecorations,
    collectSourceCommentIds,
} from '../source';

describe('comment source index', () => {
    it('finds live marker and metadata syntax while ignoring fenced code', () => {
        const markdown = [
            'Text <!--MC:a-->reviewed<!--MC:~a-->',
            '',
            '```md',
            '<!--MC:code-->literal<!--MC:~code-->',
            '[MC:code]: data:application/json;base64,ignored',
            '```',
            '',
            '[MC:a]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119',
            '',
        ].join('\n');

        const index = buildCommentSourceIndex(markdown);

        expect(index.markers.map(marker => `${marker.kind}:${marker.id}`)).toEqual(['open:a', 'close:a']);
        expect(index.metadataDefinitions.map(definition => definition.id)).toEqual(['a']);
        expect(collectSourceCommentIds(markdown)).toEqual(new Set(['a']));
    });

    it('ignores markers in inline code but still finds prose markers on the same line', () => {
        const markdown = '`<!--MC:code-->literal<!--MC:~code-->` and <!--MC:a-->text<!--MC:~a-->';

        expect(buildCommentSourceIndex(markdown).commentRanges).toEqual([
            {
                id: 'a',
                start: markdown.indexOf('text'),
                end: markdown.indexOf('<!--MC:~a-->'),
            },
        ]);
    });

    it('keeps comments live after an unclosed front matter-looking opener', () => {
        const markdown = [
            '---',
            'not actually closed front matter',
            '',
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
            '',
            '[MC:a]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119',
            '',
        ].join('\n');

        const index = buildCommentSourceIndex(markdown);

        expect(index.markers.map(marker => marker.id)).toEqual(['a', 'a']);
        expect(index.metadataDefinitions.map(definition => definition.id)).toEqual(['a']);
    });

    it.each([
        {
            label: 'semicolon JSON',
            markdown: [
                ';;;',
                '{"review":"<!--MC:json-->ignored<!--MC:~json-->"}',
                '[MC:json]: data:application/json;base64,ignored',
                ';;;',
                '',
                'A <!--MC:a-->reviewed<!--MC:~a--> line.',
                '',
                '[MC:a]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119',
                '',
            ].join('\n'),
        },
        {
            label: 'brace JSON',
            markdown: [
                '{',
                '"review": "<!--MC:json-->ignored<!--MC:~json-->"',
                '[MC:json]: data:application/json;base64,ignored',
                '}',
                '',
                'A <!--MC:a-->reviewed<!--MC:~a--> line.',
                '',
                '[MC:a]: data:application/json;base64,eyJ2ZXJzaW9uIjoxLCJzdGF0dXMiOiJvcGVuIiwicmVwbGllcyI6W119',
                '',
            ].join('\n'),
        },
    ])('ignores markers and metadata inside $label front matter', ({ markdown }) => {
        const index = buildCommentSourceIndex(markdown);

        expect(index.markers.map(marker => marker.id)).toEqual(['a', 'a']);
        expect(index.metadataDefinitions.map(definition => definition.id)).toEqual(['a']);
        expect(collectSourceCommentIds(markdown)).toEqual(new Set(['a']));
    });

    it('decorates a marker on the line after an unterminated leading --- (mid-edit)', () => {
        // A bare unterminated `---` is not front matter to the parser, so a
        // marker on a later line is live and the batch decorations mark it.
        const markdown = [
            '---',
            'not actually closed front matter',
            '',
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
        ].join('\n');
        const decorations = buildSourceLineDecorations(markdown);

        expect(decorations[3].ignored).toBe(false);
        expect(decorations[3].spans.some(span => span.token === 'marker')).toBe(true);
    });

    it('does not decorate markers inside a valid terminated front-matter block', () => {
        const markdown = [
            '---',
            'title: <!--MC:fm-->x<!--MC:~fm-->',
            '---',
            '',
            'A <!--MC:a-->reviewed<!--MC:~a--> line.',
        ].join('\n');
        const decorations = buildSourceLineDecorations(markdown);

        // The front-matter line is ignored context; the prose marker is live.
        expect(decorations[1].ignored).toBe(true);
        expect(decorations[4].spans.some(span => span.token === 'marker')).toBe(true);
    });

    it('ignores MC-looking markers inside true raw HTML blocks', () => {
        const markdown = '<!--MC:a--><div>raw</div><!--MC:~a-->\n';

        expect(buildCommentSourceIndex(markdown).commentRanges).toEqual([]);
        expect(collectSourceCommentIds(markdown)).toEqual(new Set());
    });
});

import { describe, expect, it } from 'vitest';
import {
    buildCommentSourceIndex,
    collectSourceCommentIds,
    createCommentSourceLineState,
    prepareCommentSourceLine,
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

    it('lets source decoration recover after an unclosed front matter-looking opener', () => {
        const state = createCommentSourceLineState();

        prepareCommentSourceLine(state, '---');
        expect(state.ignoreLine).toBe(true);
        prepareCommentSourceLine(state, 'not actually closed front matter');
        expect(state.ignoreLine).toBe(true);
        prepareCommentSourceLine(state, '');
        prepareCommentSourceLine(state, 'A <!--MC:a-->reviewed<!--MC:~a--> line.');

        expect(state.ignoreLine).toBe(false);
    });

    it.each([
        [';;;', ';;;'],
        ['{', '}'],
    ])('lets source decoration skip %s front matter', (open, close) => {
        const state = createCommentSourceLineState();

        prepareCommentSourceLine(state, open);
        expect(state.ignoreLine).toBe(true);
        prepareCommentSourceLine(state, '<!--MC:json-->ignored<!--MC:~json-->');
        expect(state.ignoreLine).toBe(true);
        prepareCommentSourceLine(state, close);
        expect(state.ignoreLine).toBe(true);
        prepareCommentSourceLine(state, 'A <!--MC:a-->reviewed<!--MC:~a--> line.');

        expect(state.ignoreLine).toBe(false);
    });

    it('ignores MC-looking markers inside true raw HTML blocks', () => {
        const markdown = '<!--MC:a--><div>raw</div><!--MC:~a-->\n';

        expect(buildCommentSourceIndex(markdown).commentRanges).toEqual([]);
        expect(collectSourceCommentIds(markdown)).toEqual(new Set());
    });
});

describe('isUnsafeCommentMarkerTextEdit — document-wide counterpart check', () => {
    it('consults the supplied document kinds for a counterpart in another block', async () => {
        const { isUnsafeCommentMarkerTextEdit } = await import('../source');
        const text = 'alpha <!--MC:a-->beta';

        // In-block scan alone: no close marker in this text, so the edit
        // looks safe — the historical hole that orphaned cross-block ranges.
        expect(isUnsafeCommentMarkerTextEdit(text, 0, text.length)).toBe(false);

        // With document-wide kinds the close marker elsewhere makes the same
        // edit unsafe.
        const documentKinds = new Map([['a', new Set<'open' | 'close'>(['open', 'close'])]]);
        expect(isUnsafeCommentMarkerTextEdit(text, 0, text.length, () => documentKinds)).toBe(true);

        // A genuinely orphaned marker (no counterpart anywhere) stays safe to
        // delete.
        const orphanKinds = new Map([['a', new Set<'open' | 'close'>(['open'])]]);
        expect(isUnsafeCommentMarkerTextEdit(text, 0, text.length, () => orphanKinds)).toBe(false);
    });

    it('does not invoke the document-kinds thunk when no marker is covered', async () => {
        const { isUnsafeCommentMarkerTextEdit } = await import('../source');
        let called = false;
        expect(isUnsafeCommentMarkerTextEdit('plain text', 0, 5, () => {
            called = true;
            return new Map();
        })).toBe(false);
        expect(called).toBe(false);
    });
});

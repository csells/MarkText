import type { ICriticMarkupCorpusRow } from '../../criticMarkup/__tests__/sharedCorpus';
import { describe, expect, it } from 'vitest';
import { CRITIC_MARKUP_CORPUS } from '../../criticMarkup/__tests__/sharedCorpus';
import { MarkdownToState } from '../markdownToState';
import StateToMarkdown from '../stateToMarkdown';

function roundTrip(
    markdown: string,
    options: ICriticMarkupCorpusRow['options'] = {},
): string {
    const parserOptions = {
        footnote: options.footnote ?? false,
        math: options.math ?? false,
        isGitlabCompatibilityEnabled:
            options.isGitlabCompatibilityEnabled ?? false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: options.frontMatter ?? false,
        superSubScript: options.superSubScript ?? true,
    };
    const state = new MarkdownToState(parserOptions).generate(markdown);

    return new StateToMarkdown().generate(state);
}

describe('criticMarkup state round trip', () => {
    it('preserves all five pure forms byte-for-byte in leaf Markdown', () => {
        const source = 'A {++new++} {--old--} {~~old~>new~~} {==focus==}{>>note<<}.\n';

        expect(roundTrip(source)).toBe(source);
    });

    it('does not add IDs, author metadata, sentinels, or YAML endmatter', () => {
        const output = roundTrip('Review {++this++}.\n');

        expect(output).toBe('Review {++this++}.\n');
        expect(output).not.toMatch(/\{#|\bby=|\bat=|\u2060|^---$/m);
    });

    it('keeps CriticMarkup-looking source inside code untouched', () => {
        const source = 'Code: `{++literal++}`\n\n```md\n{--literal--}\n```\n';

        expect(roundTrip(source)).toBe(source);
    });

    it.each([
        {
            source: '{=={--# head\n--}==}{>>c<<}\n',
            expected: '{=={--# head\n--}==}{>>c<<}\n',
        },
        {
            source: '{=={--  - item\n--}==}{>>c<<}\n',
            expected: '{=={--  - item\n--}==}{>>c<<}\n',
        },
        {
            source: '{=={--# head\r\n--}==}{>>c<<}\r\n',
            expected: '{=={--# head\n--}==}{>>c<<}\r\n',
        },
        {
            source: '{=={--  - item\r\n--}==}{>>c<<}\r\n',
            expected: '{=={--  - item\n--}==}{>>c<<}\r\n',
        },
        {
            source: '{--# head\r\n--}\r\n',
            expected: '{--# head\n--}\r\n',
        },
        {
            source: '{++\r\n# head\r\n++}\r\n',
            expected: '{++\r\n# head\n++}\r\n',
        },
        {
            source: '{++  \n# head\n++}\n',
            expected: '{++  \n# head\n++}\n',
        },
        {
            source: '{++\t\r\n# head\r\n++}\r\n',
            expected: '{++\t\r\n# head\n++}\r\n',
        },
        {
            source: '{=={>># head\n<<}==}{>>outer<<}\n',
            expected: '{=={>># head\n<<}==}{>>outer<<}\n',
        },
        {
            source: '{=={>>{--# head\n--}<<}==}{>>outer<<}\n',
            expected: '{=={>>{--# head\n--}<<}==}{>>outer<<}\n',
        },
    ])(
        'keeps a nested structural comment anchor adjacent: $source',
        ({ source, expected }) => {
            const first = roundTrip(source);

            expect(first).toBe(expected);
            expect(roundTrip(first)).toBe(expected);
        },
    );

    it.each([
        'prefix {=={--# head\n--}==}{>>c<<}\n',
        '{=={>>x {--# head\n--}<<}==}{>>outer<<}\n',
    ])(
        'keeps nested structural-looking content inline in an inline envelope: %j',
        (source) => {
            const first = roundTrip(source);

            expect(first).toBe(source);
            expect(roundTrip(first)).toBe(source);
        },
    );

    it('keeps structural state after a parser-hidden comment', () => {
        const source = '{>>- hidden parent<<}\n{--continued\n# head\n--}\n';
        const first = roundTrip(source);

        expect(first).toBe(source);
        expect(roundTrip(first)).toBe(source);
    });

    it.each([
        '{--- word note--}\n',
        '{--- word note--}\n\n- charlie note\n- text charlie\n',
        '{++ - one foxtrot\necho\n\n\n++} echo charlie\n',
        '{>>\n- two draft\n\n\n<<} alpha echo\n',
    ])(
        'keeps a native structural close at its physical source boundary: %j',
        (source) => {
            const first = roundTrip(source);

            expect(first).toBe(source);
            expect(roundTrip(first)).toBe(source);
        },
    );

    it('preserves blank-line ownership across adjacent structural closes and openers', () => {
        const source = [
            '{--',
            '- first',
            '',
            '--}',
            '',
            '{==',
            '',
            '',
            '- second',
            '',
            '',
            '==} tail',
            '',
        ].join('\n');
        const first = roundTrip(source);

        expect(first).toBe(source);
        expect(roundTrip(first)).toBe(source);
    });

    it.each([
        '{--# head--}{>>multi\nline<<} trailing\n',
        '- parent\n{>>hidden\n\ncomment<<}{--continued\n# head\n--}\n',
    ])(
        'preserves projected line context across a multiline hidden comment: %j',
        (source) => {
            const first = roundTrip(source);

            expect(first).toBe(source);
            expect(roundTrip(first)).toBe(source);
        },
    );

    it.each([
        '{>>note<<}{--# head\n--}\n',
        '{--# head--}{>>note<<}\n',
        '{>>multi\nline<<}{--# head\n--}\n',
        '{--# head--}{>>multi\nline<<}\n',
    ])(
        'preserves a structural item at a hidden-comment boundary: %j',
        (source) => {
            const first = roundTrip(source);

            expect(first).toBe(source);
            expect(roundTrip(first)).toBe(source);
        },
    );

    it.each([
        '{=={--# head\n--}==}{>><<}\n',
        '{=={--  - item\n--}==}{>>c<<} trailing\n',
    ])(
        'preserves a structural nested anchor at an adjacent-comment boundary: %j',
        (source) => {
            const first = roundTrip(source);

            expect(first).toBe(source);
            expect(roundTrip(first)).toBe(source);
        },
    );

    it.each([
        ['heading', '# head\n', 'plain'],
        ['heading', '# head\n', ' plain'],
        ['heading', '# head\n', '{>>d<<}'],
        ['heading', '# head\n', ' {>>d<<}'],
        ['list', '  - item\n', 'plain'],
        ['list', '  - item\n', ' plain'],
        ['list', '  - item\n', '{>>d<<}'],
        ['list', '  - item\n', ' {>>d<<}'],
        ['blockquote', '> quote\n', 'plain'],
        ['blockquote', '> quote\n', ' plain'],
        ['blockquote', '> quote\n', '{>>d<<}'],
        ['blockquote', '> quote\n', ' {>>d<<}'],
    ])(
        'preserves a nested %s anchor before semantic tail %j',
        (_kind, body, tail) => {
            const source = `{=={--${body}--}==}{>>c<<}${tail}\n`;
            const first = roundTrip(source);

            expect(first).toBe(source);
            expect(roundTrip(first)).toBe(source);
        },
    );

    it.each(CRITIC_MARKUP_CORPUS)(
        'preserves $id through repeated no-op serialization',
        (row) => {
            const first = roundTrip(row.source, row.options);
            const second = roundTrip(first, row.options);
            const expected = row.normalization.kind === 'exact'
                ? row.source
                : row.normalization.output;

            expect(first).toBe(expected);
            expect(second).toBe(expected);
        },
    );
});

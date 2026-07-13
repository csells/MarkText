import { describe, expect, it } from 'vitest';
import { projectCriticMarkupMarkdown } from '../../utils/marked/criticMarkupDocument';
import { scanCriticMarkup } from '../parser';
import { projectCriticMarkupSource } from '../project';

describe('criticMarkup compatibility corpus', () => {
    it.each([
        ['addition', '{++new++}', '', 'new'],
        ['deletion', '{--old--}', 'old', ''],
        ['substitution', '{~~old~>new~~}', 'old', 'new'],
        ['highlight', '{==focus==}', 'focus', 'focus'],
        ['comment', '{>>note<<}', '', ''],
    ] as const)(
        'pins the canonical %s projections',
        (type, source, original, revised) => {
            expect(scanCriticMarkup(source)).toMatchObject([{ type }]);
            expect(projectCriticMarkupSource(source, 'original')).toBe(original);
            expect(projectCriticMarkupSource(source, 'revised')).toBe(revised);
        },
    );

    it('keeps adjacent highlight and comment as two flat items', () => {
        const source = '{==anchor==}{>>comment<<}';

        expect(scanCriticMarkup(source).map(token => token.type))
            .toEqual(['highlight', 'comment']);
    });

    it('keeps empty forms semantic while they are being authored', () => {
        expect(scanCriticMarkup('{++++} {----} {~~~>new~~} {~~old~>~~}')
            .map(token => token.type))
            .toEqual(['addition', 'deletion', 'substitution', 'substitution']);
    });

    it('uses Markdown escaping for openers and delimiter-like payload text', () => {
        const source = String.raw`\{++literal++} {++a\++}b++}`;

        expect(scanCriticMarkup(source)).toMatchObject([{
            type: 'addition',
            content: String.raw`a\++}b`,
        }]);
    });

    it('recovers a complete item after malformed syntax', () => {
        const source = '{++unfinished before {--complete--}';

        expect(scanCriticMarkup(source)).toMatchObject([{
            type: 'deletion',
            content: 'complete',
        }]);
    });

    it('projects one semantic item across Markdown block boundaries', () => {
        const source = 'before {++one\n\n# two++} after\n';

        expect(projectCriticMarkupMarkdown(source, 'original'))
            .toBe('before  after\n');
        expect(projectCriticMarkupMarkdown(source, 'revised'))
            .toBe('before one\n\n# two after\n');
    });

    it.each([
        ['inline code', '`{++literal++}`'],
        ['fenced code', '```md\n{++literal++}\n```\n'],
        ['indented code', '    {++literal++}\n'],
        ['raw HTML', '<div>\n{++literal++}\n</div>\n'],
        ['link destination', '[x](https://example.test/{++literal++})'],
    ])('lets the Markdown AST keep CriticMarkup literal in %s', (_name, source) => {
        expect(projectCriticMarkupMarkdown(source, 'revised')).toBe(source);
    });

    it('recurses through balanced nested items deterministically', () => {
        const source = '{++outer {--inner--} tail++}';
        const [outer] = scanCriticMarkup(source);

        expect(outer).toMatchObject({
            type: 'addition',
            nested: [{ type: 'deletion', content: 'inner' }],
        });
        expect(projectCriticMarkupSource(source, 'original')).toBe('');
        expect(projectCriticMarkupSource(source, 'revised'))
            .toBe('outer  tail');
    });
});

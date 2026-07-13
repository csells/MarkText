import { describe, expect, it } from 'vitest';
import { ExcludedRanges } from '../excludedRanges';
import { parseCriticMarkupAt } from '../parser';
import {
    projectCriticMarkupSource,
    projectCriticMarkupToken,
    resolveCriticMarkupToken,
} from '../project';

const TOKENS = [
    '{++new++}',
    '{--old--}',
    '{~~old~>new~~}',
    '{==focus==}',
    '{>>note<<}',
].map((source) => {
    const token = parseCriticMarkupAt(source, 0);
    if (!token)
        throw new TypeError(`Expected a CriticMarkup token for ${source}.`);

    return token;
});

describe('criticMarkup projections', () => {
    it('preserves every construct in the marked-up projection', () => {
        expect(TOKENS.map(token => projectCriticMarkupToken(token, 'marked')))
            .toEqual(TOKENS.map(token => token.raw));
    });

    it('produces the original projection', () => {
        expect(TOKENS.map(token => projectCriticMarkupToken(token, 'original')))
            .toEqual(['', 'old', 'old', 'focus', '']);
    });

    it('produces the revised projection', () => {
        expect(TOKENS.map(token => projectCriticMarkupToken(token, 'revised')))
            .toEqual(['new', '', 'new', 'focus', '']);
    });

    it('maps accept to revised and reject to original', () => {
        const substitution = TOKENS[2];

        expect(resolveCriticMarkupToken(substitution, 'accept')).toBe('new');
        expect(resolveCriticMarkupToken(substitution, 'reject')).toBe('old');
    });

    it('projects nested review items recursively', () => {
        const source = '{++outer {--inner--} tail++}';

        expect(projectCriticMarkupSource(source, 'original')).toBe('');
        expect(projectCriticMarkupSource(source, 'revised'))
            .toBe('outer  tail');
    });

    it('projects a review item across a Markdown block boundary', () => {
        const source = 'first{++\n\n++}second';

        expect(projectCriticMarkupSource(source, 'original'))
            .toBe('firstsecond');
        expect(projectCriticMarkupSource(source, 'revised'))
            .toBe('first\n\nsecond');
    });

    it('leaves CriticMarkup-looking text in code contexts literal', () => {
        const source = [
            '`{++inline++}`',
            '',
            '~~~md',
            '{--fenced--}',
            '~~~',
        ].join('\n');

        expect(projectCriticMarkupSource(
            source,
            'revised',
            ExcludedRanges.from(source.length, [{
                start: 0,
                end: source.length,
            }]),
        )).toBe(source);
    });

    it('decodes only escapes owned by the projected token grammar', () => {
        const source = String.raw`{++keep \~> and --\} but decode ++\}++}`;
        const token = parseCriticMarkupAt(source, 0)!;

        expect(projectCriticMarkupToken(token, 'revised'))
            .toBe(String.raw`keep \~> and --\} but decode ++}`);
    });
});

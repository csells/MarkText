import { describe, expect, it } from 'vitest';
import { parseCriticMarkupAt } from '../parser';
import { projectCriticMarkupToken } from '../project';
import {
    createCriticMarkup,
    resolveCriticMarkupAt,
} from '../transform';

describe('criticMarkup authoring transforms', () => {
    it.each([
        [{ type: 'addition', content: 'new' }, '{++new++}'],
        [{ type: 'deletion', content: 'old' }, '{--old--}'],
        [{ type: 'highlight', content: 'focus' }, '{==focus==}'],
        [{ type: 'comment', content: 'note' }, '{>>note<<}'],
        [
            { type: 'substitution', oldContent: 'old', newContent: 'new' },
            '{~~old~>new~~}',
        ],
    ] as const)('creates $type syntax from semantic input', (input, expected) => {
        expect(createCriticMarkup(input)).toBe(expected);
    });

    it('allows empty payloads for transient editor operations', () => {
        expect(createCriticMarkup({ type: 'addition', content: '' }))
            .toBe('{++++}');
        expect(createCriticMarkup({
            type: 'substitution',
            oldContent: 'old',
            newContent: '',
        })).toBe('{~~old~>~~}');
    });

    it.each([
        [
            { type: 'addition', content: 'literal {++ opener and ++} closer' } as const,
            String.raw`{++literal \{++ opener and ++\} closer++}`,
        ],
        [
            { type: 'comment', content: 'literal <<} closer' } as const,
            String.raw`{>>literal <<\} closer<<}`,
        ],
        [
            {
                type: 'substitution',
                oldContent: 'old ~> divider ~~}',
                newContent: 'new {-- marker ~~}',
            } as const,
            String.raw`{~~old \~> divider ~~\}~>new \{-- marker ~~\}~~}`,
        ],
    ])('escapes payload delimiters so authored $type remains one token', (input, expected) => {
        const source = createCriticMarkup(input);

        expect(source).toBe(expected);
        expect(parseCriticMarkupAt(source, 0)).toMatchObject({
            type: input.type,
            raw: source,
            range: { start: 0, end: source.length },
        });
    });

    it.each([
        {
            draft: {
                type: 'addition',
                content: String.raw`{++|\{++|\\{++|++}|++\}|++\\}|--\}|\++}`,
            } as const,
            projection: 'revised' as const,
        },
        {
            draft: {
                type: 'deletion',
                content: String.raw`{--|\{--|\\{--|--}|--\}|--\\}|++\}`,
            } as const,
            projection: 'original' as const,
        },
        {
            draft: {
                type: 'highlight',
                content: String.raw`{==|\{==|\\{==|==}|==\}|==\\}|<<\}`,
            } as const,
            projection: 'revised' as const,
        },
        {
            draft: {
                type: 'comment',
                content: String.raw`{>>|\{>>|\\{>>|<<}|<<\}|<<\\}|~~\}`,
            } as const,
            projection: 'marked' as const,
        },
    ])('round-trips zero/odd/even payload slashes for $draft.type', ({
        draft,
        projection,
    }) => {
        const source = createCriticMarkup(draft);
        const token = parseCriticMarkupAt(source, 0)!;

        expect(projectCriticMarkupToken(token, projection))
            .toBe(projection === 'marked' ? source : draft.content);
    });

    it('round-trips substitution separator and close escapes by arm', () => {
        const draft = {
            type: 'substitution' as const,
            oldContent: String.raw`~>|\~>|\\~>|~~}|~~\}|~~\\}|++\}`,
            newContent: String.raw`~>|\~>|\\~>|~~}|~~\}|~~\\}|--\}`,
        };
        const source = createCriticMarkup(draft);
        const token = parseCriticMarkupAt(source, 0)!;

        expect(projectCriticMarkupToken(token, 'original'))
            .toBe(draft.oldContent);
        expect(projectCriticMarkupToken(token, 'revised'))
            .toBe(draft.newContent);
    });
});

describe('criticMarkup resolution transforms', () => {
    it.each([
        ['accept', 'Before new after'],
        ['reject', 'Before old after'],
    ] as const)('resolves exactly one substitution with %s', (decision, expected) => {
        expect(resolveCriticMarkupAt(
            'Before {~~old~>new~~} after',
            7,
            decision,
        )).toBe(expected);
    });

    it('does not alter adjacent review items', () => {
        expect(resolveCriticMarkupAt(
            '{++first++}{--second--}',
            0,
            'accept',
        )).toBe('first{--second--}');
    });

    it('fails loudly when the requested offset is not a review item', () => {
        expect(() => resolveCriticMarkupAt('plain text', 0, 'accept'))
            .toThrow(TypeError);
    });
});

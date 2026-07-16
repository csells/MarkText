import type {
    ICriticMarkupSourceEdit,
    ICriticMarkupTrackContext,
} from '../trackChanges';
import { describe, expect, it } from 'vitest';
import { sourceRange } from '../../mappedText';
import { plainMarkdown } from '../../state/markdownSourceMap';
import { parseCriticMarkupContextDocument } from '../../utils/marked/criticMarkupDocument';
import { CriticMarkupAnalysis } from '../analysis';
import { createCriticMarkupDocument } from '../document';
import { scanCriticMarkup } from '../parser';
import { projectCriticMarkupTokens } from '../project';
import { trackCriticMarkupEdits } from '../trackChanges';
import { markdownTrackContext } from './markdownTrackContext';

function grammarDocument(source: string) {
    const mapped = plainMarkdown(source);
    return createCriticMarkupDocument(
        CriticMarkupAnalysis.analyzeGrammar(source),
        mapped,
        undefined,
        undefined,
        'grammar',
    );
}

function track(
    before: string,
    after: string,
    edits: readonly ICriticMarkupSourceEdit[],
) {
    return trackCriticMarkupEdits(
        before,
        after,
        edits,
        markdownTrackContext(before, after),
    );
}

describe('criticMarkup track-changes transform', () => {
    it('requires complete canonical parser context at its runtime boundary', () => {
        const source = 'ab';
        const proposed = 'acb';
        const edit = {
            oldRange: sourceRange(1, 1),
            inserted: 'c',
        };
        const complete = markdownTrackContext(source, proposed);
        const incomplete: Array<{
            name: string;
            context?: Partial<ICriticMarkupTrackContext>;
        }> = [
            { name: 'omitted context' },
            { name: 'empty context', context: {} },
            {
                name: 'missing before document',
                context: {
                    proposedDocument: complete.proposedDocument,
                    createDocument: complete.createDocument,
                },
            },
            {
                name: 'missing proposed document',
                context: {
                    beforeDocument: complete.beforeDocument,
                    createDocument: complete.createDocument,
                },
            },
            {
                name: 'missing document factory',
                context: {
                    beforeDocument: complete.beforeDocument,
                    proposedDocument: complete.proposedDocument,
                },
            },
        ];
        const invokeUnsafe = (
            context?: Partial<ICriticMarkupTrackContext>,
        ) => (trackCriticMarkupEdits as unknown as (
            before: string,
            after: string,
            edits: ReadonlyArray<typeof edit>,
            context?: Partial<ICriticMarkupTrackContext>,
        ) => unknown)(source, proposed, [edit], context);

        for (const fixture of incomplete) {
            expect(
                () => invokeUnsafe(fixture.context),
                fixture.name,
            ).toThrow(/requires canonical before, proposed, and factory documents/i);
        }
    });

    it('rejects mismatched parser profiles and incomplete context coverage', () => {
        const before = 'ab';
        const proposed = 'acb';
        const edits = [{
            oldRange: sourceRange(1, 1),
            inserted: 'c',
        }];
        const document = (source: string, math: boolean) =>
            parseCriticMarkupContextDocument(plainMarkdown(source), { math });

        expect(() => trackCriticMarkupEdits(before, proposed, edits, {
            beforeDocument: document(before, true),
            proposedDocument: document(proposed, false),
            createDocument: source => document(source, true),
        })).toThrow(/different parser profile/);

        expect(() => trackCriticMarkupEdits(before, proposed, edits, {
            beforeDocument: grammarDocument(before),
            proposedDocument: document(proposed, true),
            createDocument: source => document(source, true),
        })).toThrow(/context coverage/);
    });

    it('makes canonical parser context mandatory in the TypeScript contract', () => {
        const missingContextMustNotCompile = () => {
            // @ts-expect-error -- Track Changes must never infer Markdown context.
            return trackCriticMarkupEdits('ab', 'acb', [{
                oldRange: sourceRange(1, 1),
                inserted: 'c',
            }]);
        };

        expect(missingContextMustNotCompile).toBeTypeOf('function');
    });

    it.each([
        ['ab', 'acb', { oldRange: sourceRange(1, 1), inserted: 'c' }, 'a{++c++}b', 5],
        ['abc', 'ac', { oldRange: sourceRange(1, 2), inserted: '' }, 'a{--b--}c', 8],
        ['abc', 'axc', { oldRange: sourceRange(1, 2), inserted: 'x' }, 'a{~~b~>x~~}c', 8],
    ])('turns one browser edit into pure review syntax', (
        before,
        after,
        edit,
        expected,
        caret,
    ) => {
        expect(track(before, after, [edit])).toMatchObject({
            text: expected,
            selectionStart: caret,
            selectionEnd: caret,
        });
    });

    it('coalesces continued typing inside a pending addition', () => {
        expect(track('a{++b++}', 'a{++bc++}', [{
            oldRange: sourceRange(5, 5),
            inserted: 'c',
        }])).toMatchObject({
            text: 'a{++bc++}',
            selectionStart: 6,
            selectionEnd: 6,
        });
    });

    it('edits the revised arm of a pending substitution without nesting', () => {
        expect(track(
            '{~~old~>new~~}',
            '{~~old~>news~~}',
            [{ oldRange: sourceRange(11, 11), inserted: 's' }],
        )).toMatchObject({
            text: '{~~old~>news~~}',
            selectionStart: 12,
            selectionEnd: 12,
        });
    });

    it('validates nested items once from roots instead of double-projecting them', () => {
        const before = '{==a {~~old~>new~~} z==}';
        const insertion = before.indexOf('new') + 'new'.length;
        const after = `${before.slice(0, insertion)}s${before.slice(insertion)}`;
        const tracked = track(before, after, [{
            oldRange: sourceRange(insertion, insertion),
            inserted: 's',
        }]);

        expect(tracked?.text).toBe(after);
        const roots = scanCriticMarkup(tracked!.text);
        expect(projectCriticMarkupTokens(tracked!.text, 'original', roots))
            .toBe('a old z');
        expect(projectCriticMarkupTokens(tracked!.text, 'revised', roots))
            .toBe('a news z');
    });

    it('fails closed when an edit damages review delimiters', () => {
        expect(track('{++new++}', '{+new++}', [{
            oldRange: sourceRange(2, 3),
            inserted: '',
        }])).toBeNull();
    });

    it('uses the grammar serializer for delimiter-like inserted payloads', () => {
        const tracked = track('ab', 'a++}b', [{
            oldRange: sourceRange(1, 1),
            inserted: '++}',
        }]);

        expect(tracked?.text).toBe(String.raw`a{++++\}++}b`);
        const document = grammarDocument(tracked!.text);
        expect(document.project('original')).toBe('ab');
        expect(document.project('revised')).toBe('a++}b');
    });

    it('preserves literal payload slashes inside parser-owned code context', () => {
        const inserted = '`++\\}`';
        const before = 'ab';
        const after = `a${inserted}b`;
        const tracked = track(before, after, [{
            oldRange: sourceRange(1, 1),
            inserted,
        }]);

        expect(tracked).not.toBeNull();
        expect(markdownTrackContext(
            tracked!.text,
            tracked!.text,
        ).beforeDocument.project('revised')).toBe(after);
    });

    it('preserves an explicitly authored replacement span', () => {
        expect(track('teh', 'the', [{
            oldRange: sourceRange(0, 3),
            inserted: 'the',
        }])).toMatchObject({
            text: '{~~teh~>the~~}',
            selectionStart: 11,
            selectionEnd: 11,
        });
    });

    it('fails closed when an explicit edit does not produce the proposal', () => {
        expect(track('teh', 'the', [{
            oldRange: sourceRange(1, 3),
            inserted: 'xx',
        }])).toBeNull();
    });

    it('fails closed when parser context marks the edit as literal', () => {
        const before = '`ab`';
        const proposed = '`acb`';

        expect(track(before, proposed, [{
            oldRange: sourceRange(2, 2),
            inserted: 'c',
        }])).toBeNull();
    });
});

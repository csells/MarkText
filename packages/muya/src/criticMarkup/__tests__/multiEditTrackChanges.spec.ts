import type { ICriticMarkupSourceEdit } from '../trackChanges';
import { describe, expect, it } from 'vitest';
import { sourceRange } from '../../mappedText';
import { scanCriticMarkup } from '../parser';
import { projectCriticMarkupTokens } from '../project';
import { trackCriticMarkupEdits } from '../trackChanges';
import { markdownTrackContext } from './markdownTrackContext';

type ISourceEdit = ICriticMarkupSourceEdit;

function replacementEdits(
    source: string,
    needle: string,
    replacement: string,
): ISourceEdit[] {
    const edits: ISourceEdit[] = [];
    for (let start = source.indexOf(needle); start !== -1;) {
        edits.push({
            oldRange: sourceRange(start, start + needle.length),
            inserted: replacement,
        });
        start = source.indexOf(needle, start + needle.length);
    }

    return edits;
}

function applySourceEdits(
    source: string,
    edits: readonly ISourceEdit[],
): string {
    return [...edits]
        .sort((left, right) => right.oldRange.start - left.oldRange.start)
        .reduce((result, edit) =>
            result.slice(0, edit.oldRange.start)
            + edit.inserted
            + result.slice(edit.oldRange.end), source);
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

function expectExactProjections(
    tracked: string,
    before: string,
    after: string,
): void {
    const tokens = scanCriticMarkup(tracked);
    expect(projectCriticMarkupTokens(tracked, 'original', tokens)).toBe(before);
    expect(projectCriticMarkupTokens(tracked, 'revised', tokens)).toBe(after);
}

describe('multi-source CriticMarkup Track Changes transform', () => {
    it('tracks disjoint replacements without sweeping untouched Markdown', () => {
        const before
            = 'before foo **untouched** foo after\n\n# foo heading\n';
        const after
            = 'before bar **untouched** bar after\n\n# bar heading\n';
        const edits = replacementEdits(before, 'foo', 'bar');

        expect(applySourceEdits(before, edits)).toBe(after);
        const tracked = track(before, after, edits);

        expect(tracked?.text).toBe(
            'before {~~foo~>bar~~} **untouched** {~~foo~>bar~~} after\n'
            + '\n# {~~foo~>bar~~} heading\n',
        );
        expect(scanCriticMarkup(tracked!.text)).toHaveLength(3);
        expectExactProjections(tracked!.text, before, after);
    });

    it('keeps a block-spanning edit and a later leaf edit independent', () => {
        const before = 'ab\n\ncd\n\nxy\n';
        const firstEnd = before.indexOf('d');
        const secondStart = before.indexOf('xy');
        const edits: ISourceEdit[] = [
            {
                oldRange: sourceRange(1, firstEnd),
                inserted: 'X',
            },
            {
                oldRange: sourceRange(secondStart, secondStart + 1),
                inserted: 'z',
            },
        ];
        const after = applySourceEdits(before, edits);

        expect(after).toBe('aXd\n\nzy\n');
        const tracked = track(before, after, edits);

        expect(tracked?.text).toBe(
            'a{~~b\n\nc~>X~~}d\n\n{~~x~>z~~}y\n',
        );
        expect(scanCriticMarkup(tracked!.text)).toHaveLength(2);
        expectExactProjections(tracked!.text, before, after);
    });

    it('treats explicit source ranges as UTF-16 offsets around emoji and combining text', () => {
        const before = '😀 teh and e\u0301';
        const wordStart = before.indexOf('teh');
        const accentStart = before.indexOf('\u0301');
        const edits: ISourceEdit[] = [
            {
                oldRange: sourceRange(wordStart, wordStart + 3),
                inserted: 'the',
            },
            {
                oldRange: sourceRange(accentStart, accentStart + 1),
                inserted: '',
            },
        ];
        const after = '😀 the and e';

        expect(applySourceEdits(before, edits)).toBe(after);
        const tracked = track(before, after, edits);

        expect(tracked?.text).toBe('😀 {~~teh~>the~~} and e{--\u0301--}');
        expectExactProjections(tracked!.text, before, after);
    });

    it('rejects the whole batch when the supplied edits do not explain the proposal', () => {
        const before = 'foo KEEP foo';
        const after = 'bar CHANGED bar';
        const edits = replacementEdits(before, 'foo', 'bar');

        expect(applySourceEdits(before, edits)).toBe('bar KEEP bar');
        expect(track(before, after, edits)).toBeNull();
    });

    it('rejects overlapping source edits instead of choosing an application order', () => {
        const before = 'abcdef';
        const after = 'aXYf';
        const edits: ISourceEdit[] = [
            {
                oldRange: sourceRange(1, 4),
                inserted: 'X',
            },
            {
                oldRange: sourceRange(3, 5),
                inserted: 'Y',
            },
        ];

        expect(track(before, after, edits)).toBeNull();
    });

    it('rejects the whole batch when any exact edit intersects a literal range', () => {
        const before = '`foo` and foo';
        const after = '`bar` and bar';
        const edits = replacementEdits(before, 'foo', 'bar');

        expect(track(before, after, edits)).toBeNull();
    });
});

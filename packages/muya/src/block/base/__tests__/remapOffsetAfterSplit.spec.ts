import { describe, expect, it } from 'vitest';
import { remapOffsetAfterSplit } from '../format';

// Converting a soft-wrapped paragraph line to a thematic break / ATX heading /
// block quote splits the preceding lines off into their own paragraph and may
// strip a leading marker (`> ` for a quote). The caret must move by BOTH the
// preceding lines it no longer sits after AND the stripped marker. The three
// conversions had each hand-rolled part of this: thematic/atx subtracted the
// preceding lines but not a marker; block quote subtracted the marker but not
// the preceding lines — so typing `> ` on a non-first soft-wrapped line put
// the caret past the end of the (short) quote content. This pins the one
// correct remap all three now share.

describe('remapOffsetAfterSplit', () => {
    it('subtracts BOTH the preceding split-off lines and the stripped marker (block quote)', () => {
        // "ab\n> cd", caret at offset 5 (on `c`): preceding line ['ab'] (len 2
        // + newline = 3), marker `> ` (2). c is at offset 0 of the quote `cd`.
        expect(remapOffsetAfterSplit(5, ['ab'], 2)).toBe(0);
    });

    it('with no preceding lines subtracts only the marker (quote at the first line)', () => {
        // "> cd", caret at 2 (on `c`): no preceding line, marker 2.
        expect(remapOffsetAfterSplit(2, [], 2)).toBe(0);
    });

    it('with no marker subtracts only the preceding lines (thematic break / ATX heading)', () => {
        // "ab\n---", caret at 5: preceding ['ab'] (3), no marker → 5 - 3 = 2.
        expect(remapOffsetAfterSplit(5, ['ab'])).toBe(2);
    });

    it('sums multiple preceding lines with their newlines', () => {
        // preceding ['ab','cd'] → (2+1)+(2+1) = 6; 8 - 6 = 2.
        expect(remapOffsetAfterSplit(8, ['ab', 'cd'])).toBe(2);
    });

    it('clamps to 0 rather than returning a negative offset', () => {
        expect(remapOffsetAfterSplit(1, ['abcde'], 2)).toBe(0);
    });
});

import { describe, expect, it } from 'vitest';
import { removalOrphansCommentMarker } from '../markerScan';

describe('removalOrphansCommentMarker', () => {
    it('orphans when a removed open marker has a surviving close', () => {
        expect(removalOrphansCommentMarker(
            ['cell text <!--MC:a--> here'],
            ['closing <!--MC:~a--> elsewhere'],
        )).toBe(true);
    });

    it('orphans when a removed close marker has a surviving open', () => {
        expect(removalOrphansCommentMarker(
            ['<!--MC:~a-->'],
            ['<!--MC:a-->'],
        )).toBe(true);
    });

    it('is safe when both endpoints are in the removed set', () => {
        expect(removalOrphansCommentMarker(
            ['<!--MC:a-->reviewed<!--MC:~a-->'],
            ['unrelated text'],
        )).toBe(false);
    });

    it('is safe when the removed set has no markers', () => {
        expect(removalOrphansCommentMarker(['plain'], ['<!--MC:a-->x<!--MC:~a-->'])).toBe(false);
    });

    it('is safe when the surviving counterpart is only a code-fence literal (caller pre-filters)', () => {
        // The caller passes only scannable surviving texts; a fence literal is
        // excluded upstream, so it never reaches here as a counterpart.
        expect(removalOrphansCommentMarker(['<!--MC:a-->'], [])).toBe(false);
    });
});

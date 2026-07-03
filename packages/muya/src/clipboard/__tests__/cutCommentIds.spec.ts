import { describe, expect, it } from 'vitest';
import { commentIdsInText } from '../cut';

// Quality review ①: the cut guards must use ONE definition of "a comment
// marker" — the real inline tokenizer, which ignores marker-shaped text inside
// inline-code/inline-math spans. The regex version counted those, so a cut's
// selected-marker set disagreed with its document-marker set (built via the
// tokenizer), and metadata cleanup could fire for a non-comment.
describe('commentIdsInText — tokenizer, not raw regex', () => {
    it('returns only real comment ids, ignoring marker text inside inline code', () => {
        expect(commentIdsInText('`<!--MC:a-->` real <!--MC:b-->')).toEqual(['b']);
    });

    it('ignores a marker inside an inline-math span', () => {
        expect(commentIdsInText('$<!--MC:x-->$ and <!--MC:y-->')).toEqual(['y']);
    });

    it('still returns genuine markers', () => {
        expect(commentIdsInText('a <!--MC:c1-->b<!--MC:~c1--> d').sort()).toEqual(['c1']);
    });
});

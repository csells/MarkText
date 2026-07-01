import { describe, expect, it } from 'vitest';
import {
    commentMarkerRegExpForId,
    parseCommentMarker,
    serializeCommentMarker,
    serializeCommentMetadataDefinition,
} from '../syntax';

describe('comment wire-format serializers', () => {
    it('serializes open and close markers in the canonical byte form', () => {
        expect(serializeCommentMarker('cmt_1')).toBe('<!--MC:cmt_1-->');
        expect(serializeCommentMarker('cmt_1', 'open')).toBe('<!--MC:cmt_1-->');
        expect(serializeCommentMarker('cmt_1', 'close')).toBe('<!--MC:~cmt_1-->');
    });

    it('round-trips through parseCommentMarker', () => {
        for (const kind of ['open', 'close'] as const) {
            const marker = serializeCommentMarker('id-42', kind);
            expect(parseCommentMarker(marker)).toEqual({ raw: marker, id: 'id-42', kind });
        }
    });

    it('serializes the metadata definition line', () => {
        expect(serializeCommentMetadataDefinition('cmt_1', 'data:application/json;base64,AAAA'))
            .toBe('[MC:cmt_1]: data:application/json;base64,AAAA');
    });

    it('builds an id-scoped regexp matching both markers of that id only', () => {
        const markdown = '<!--MC:a-->x<!--MC:~a--> <!--MC:b-->y<!--MC:~b-->';
        const matches = markdown.match(commentMarkerRegExpForId('a'));
        expect(matches).toEqual(['<!--MC:a-->', '<!--MC:~a-->']);
    });

    it('escapes regexp metacharacters in the id when building the id-scoped regexp', () => {
        expect(commentMarkerRegExpForId('a.b').source).toContain('a\\.b');
    });
});

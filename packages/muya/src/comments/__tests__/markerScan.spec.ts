import { describe, expect, it } from 'vitest';
import {
    createCommentSearchText,
    stripCommentSyntaxForClipboard,
} from '../markerScan';

describe('tokenizer-backed comment marker text projection', () => {
    it('hides real markers from search while preserving marker-looking inline code', () => {
        const text = 'A <!--MC:real-->visible<!--MC:~real--> `<!--MC:code-->literal<!--MC:~code-->` tail';

        expect(createCommentSearchText(text).text)
            .toBe('A visible `<!--MC:code-->literal<!--MC:~code-->` tail');
    });

    it('maps search result offsets back to raw text around real markers only', () => {
        const text = 'A <!--MC:real-->visible<!--MC:~real--> tail';
        const search = createCommentSearchText(text);
        const visibleIndex = search.text.indexOf('tail');

        expect(text.slice(search.rawIndexBySearchIndex[visibleIndex])).toBe('tail');
    });

    it('strips real markers from clipboard text while preserving marker-looking inline code', () => {
        const text = 'A <!--MC:real-->visible<!--MC:~real--> `<!--MC:code-->literal<!--MC:~code-->` tail';

        expect(stripCommentSyntaxForClipboard(text))
            .toBe('A visible `<!--MC:code-->literal<!--MC:~code-->` tail');
    });
});

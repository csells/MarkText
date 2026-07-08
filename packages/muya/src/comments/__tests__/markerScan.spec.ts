import { describe, expect, it } from 'vitest';
import {
    realCommentMarkersInText,
    stripRealCommentMarkersFromText,
} from '../markerScan';

// The marker scan backs load-time extraction and the file-level analyzer's
// previews. It uses the real inline tokenizer, so marker-looking bytes inside
// inline code are literal text, never markers.
describe('tokenizer-backed comment marker scan', () => {
    it('finds real markers but not marker-looking inline code', () => {
        const text = 'A <!--MC:real-->visible<!--MC:~real--> `<!--MC:code-->literal<!--MC:~code-->` tail';

        expect(realCommentMarkersInText(text).map(marker => `${marker.kind}:${marker.id}`))
            .toEqual(['open:real', 'close:real']);
    });

    it('strips real markers from analyzer previews while preserving marker-looking inline code', () => {
        const text = 'A <!--MC:real-->visible<!--MC:~real--> `<!--MC:code-->literal<!--MC:~code-->` tail';

        expect(stripRealCommentMarkersFromText(text))
            .toBe('A visible `<!--MC:code-->literal<!--MC:~code-->` tail');
    });
});

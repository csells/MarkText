import type { IMarkedSourceView } from '../markedSourceView';
import { describe, expect, it } from 'vitest';
import { localOffset, SourceMap, sourceOffset } from '../../../mappedText';
import {
    concatViews,
    markedParserPath,
} from '../markedSourceView';

describe('marked source-view scale', () => {
    it('concatenates more mapped spans than the engine argument limit', () => {
        const spanCount = 200_000;
        const text = 'x'.repeat(spanCount);
        const path = markedParserPath(['fragmented']);
        const view: IMarkedSourceView = {
            text,
            sourceMap: new SourceMap(Array.from(
                { length: spanCount },
                (_, index) => ({
                    path,
                    localStart: localOffset(index),
                    localEnd: localOffset(index + 1),
                    sourceStart: sourceOffset(index),
                    sourceEnd: sourceOffset(index + 1),
                }),
            )),
        };

        const joined = concatViews([view]);

        expect(joined.text).toBe(text);
        expect(joined.sourceMap.spans).toHaveLength(1);
        expect(joined.sourceMap.localToSource(
            markedParserPath(['marked-parser-view']),
            localOffset(spanCount - 1),
        )).toBe(sourceOffset(spanCount - 1));
    }, 60_000);
});

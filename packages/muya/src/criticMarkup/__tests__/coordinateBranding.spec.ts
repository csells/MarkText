import type { TLocalRange, TSourceRange } from '../../mappedText';
import type { TMarkdownStatePath } from '../../state/markdownSourceMap';
import type {
    CriticMarkupDocument,
    ICriticMarkupDocumentItem,
    TCriticMarkupDocumentToken,
} from '../document';
import type { ICriticMarkupRange, TCriticMarkupToken } from '../parser';
import { describe, expect, it } from 'vitest';
import {
    localOffset,
    localRange,
    sourceOffset,
    sourceRange,
} from '../../mappedText';
import { markdownStatePath } from '../../state/markdownSourceMap';

describe('criticMarkup document coordinate brands', () => {
    it('keeps local and source ranges out of the wrong APIs', () => {
        const path: TMarkdownStatePath = markdownStatePath([0, 'text']);
        const local: TLocalRange = localRange(0, 1);
        const source: TSourceRange = sourceRange(0, 1);
        const compileTimeContract = (document: CriticMarkupDocument) => {
            document.itemAt(path, localOffset(0));
            document.itemContaining(path, local);
            document.itemIntersectingSourceRange(source);
            document.itemsContainedBySourceRange(source);
            document.projectSourceRange(source, 'revised');
            document.projectLocalRange(path, local, 'revised');
            document.itemStartingAtSourceOffset(sourceOffset(0));

            // @ts-expect-error — a source offset cannot query a local path.
            document.itemAt(path, sourceOffset(0));
            // @ts-expect-error — a source range cannot query a local path.
            document.itemContaining(path, source);
            // @ts-expect-error — a local range cannot query source items.
            document.itemIntersectingSourceRange(local);
            // @ts-expect-error — a local range cannot select source bytes.
            document.projectSourceRange(local, 'revised');
            // @ts-expect-error — a source range cannot select local bytes.
            document.projectLocalRange(path, source, 'revised');
            // @ts-expect-error — a local offset cannot query source starts.
            document.itemStartingAtSourceOffset(localOffset(0));
        };

        expect(compileTimeContract).toBeTypeOf('function');
    });

    it('brands every token range exposed by the semantic document boundary', () => {
        const compileTimeContract = (
            document: CriticMarkupDocument,
            item: ICriticMarkupDocumentItem,
            semantic: TCriticMarkupDocumentToken,
            grammar: TCriticMarkupToken,
            grammarRange: ICriticMarkupRange,
        ) => {
            const itemRange: TSourceRange = item.syntax.range;
            const rootRange: TSourceRange = document.roots[0].range;
            const nestedRange: TSourceRange | undefined
                = semantic.nested?.[0].range;

            // @ts-expect-error — grammar coordinates cannot escape as source coordinates.
            const leakedGrammarRange: TSourceRange = grammar.range;
            // @ts-expect-error — an arbitrary unbranded grammar range is not semantic source.
            const leakedRawRange: TSourceRange = grammarRange;

            return { itemRange, rootRange, nestedRange, leakedGrammarRange, leakedRawRange };
        };

        expect(compileTimeContract).toBeTypeOf('function');
    });
});

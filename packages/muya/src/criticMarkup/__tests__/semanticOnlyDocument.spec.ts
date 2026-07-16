import { describe, expect, it } from 'vitest';
import { localOffset, localRange, sourceOffset } from '../../mappedText';
import {
    markdownStatePath,
    plainMarkdown,
} from '../../state/markdownSourceMap';
import {
    parseCriticMarkupDocument,
    projectCriticMarkupMarkdown,
} from '../../utils/marked/criticMarkupDocument';
import { CriticMarkupAnalysis } from '../analysis';
import { createCriticMarkupDocument } from '../document';

const SOURCE = 'x {++same++} y {--old--} z\n';

function semanticOnlyDocument() {
    return createCriticMarkupDocument(
        CriticMarkupAnalysis.analyzeGrammar(SOURCE),
        plainMarkdown(SOURCE),
        undefined,
        undefined,
        'semantic-only',
    );
}

describe('semantic-only CriticMarkup documents', () => {
    it('serves the complete semantic and projection surface', () => {
        const document = semanticOnlyDocument();

        expect(document.items).toHaveLength(2);
        expect(document.items.every(item =>
            item.fragments.length === 0
            && item.structuralFragments.length === 0)).toBe(true);
        expect(document.itemById(document.items[0].id)).toBe(document.items[0]);
        expect(document.childrenOf(null)).toHaveLength(2);
        expect(document.project('marked')).toBe(SOURCE);
        expect(document.project('original')).toBe('x  y old z\n');
        expect(document.project('revised')).toBe('x same y  z\n');
        expect(document.markdown).toBe(SOURCE);
        expect(document.itemIntersectingSourceRange(
            document.items[0].syntax.range,
        )).toBe(document.items[0]);
    });

    it('refuses every fragment, path, and authoring API without bindings', () => {
        const document = semanticOnlyDocument();
        const path = markdownStatePath([0, 'text']);

        const refused = [
            () => document.fragmentsForPath(path),
            () => document.pathsWithFragments(),
            () => document.structuralFragmentsForPath(path),
            () => document.pathsWithStructuralFragments(),
            () => document.itemAt(path, localOffset(3)),
            () => document.itemContaining(path, localRange(3, 5)),
            () => document.sourceOffsetAt(path, localOffset(3)),
            () => document.localPositionAt(sourceOffset(3)),
            () => document.sourceRangeForLocalRange(path, localRange(3, 5)),
            () => document.sourceRangeForLocalEndpoints(
                { path, offset: localOffset(3) },
                { path, offset: localOffset(5) },
            ),
            () => document.projectLocalRange(path, localRange(3, 5), 'marked'),
        ];
        for (const call of refused)
            expect(call).toThrowError(/semantic-only|native bindings/i);
    });

    it('keeps grammar-scan parser documents semantic-only', () => {
        const document = parseCriticMarkupDocument(plainMarkdown(SOURCE));

        expect(document.items).toHaveLength(2);
        expect(() => document.pathsWithFragments())
            .toThrowError(/semantic-only|native bindings/i);
    });

    it('still projects Markdown without constructing fragment topology', () => {
        expect(projectCriticMarkupMarkdown(SOURCE, 'original'))
            .toBe('x  y old z\n');
        expect(projectCriticMarkupMarkdown(SOURCE, 'revised'))
            .toBe('x same y  z\n');
    });

    it('constructs an exact empty binding graph for openerless sources', () => {
        const source = 'plain text with no critic opener\n';
        const document = parseCriticMarkupDocument(plainMarkdown(source));

        expect(document.items).toEqual([]);
        // An empty graph is exact for zero items, so bound APIs stay usable
        // for authoring context lookups over openerless revisions.
        expect(document.pathsWithFragments()).toEqual([]);
        expect(document.itemAt(
            markdownStatePath([0, 'text']),
            localOffset(2),
        )).toBeNull();
    });
});

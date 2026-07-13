import type { TTrackedMarkdown } from '../../state/markdownSourceMap';
import type { IMarkdownSourceMap } from '../../state/stateToMarkdown';
import type { TCriticMarkupToken } from '../parser';
import { describe, expect, it } from 'vitest';
import { localOffset, localRange } from '../../mappedText';
import {
    fromMarkdownSourceMap,
    markdownStatePath,
} from '../../state/markdownSourceMap';
import { CriticMarkupAnalysis } from '../analysis';
import { createCriticMarkupDocument as createDocumentFromAnalysis } from '../document';
import { scanCriticMarkup } from '../parser';
import { projectCriticMarkupTokens } from '../project';

const DEEP_NESTING = 12_000;
const PAYLOAD = 'payload';
const PATH = markdownStatePath([0, 'text']);

function createCriticMarkupDocument(source: TTrackedMarkdown) {
    return createDocumentFromAnalysis(
        CriticMarkupAnalysis.analyzeGrammar(source.text),
        source,
    );
}

function deeplyNestedAddition(depth = DEEP_NESTING): string {
    return `${'{++'.repeat(depth)}${PAYLOAD}${'++}'.repeat(depth)}`;
}

function identitySourceMap(markdown: string): IMarkdownSourceMap {
    return {
        markdown,
        leaves: [{
            path: PATH,
            pieces: [{
                localStart: 0,
                localEnd: markdown.length,
                sourceStart: 0,
                sourceEnd: markdown.length,
            }],
        }],
    };
}

function nestingDepth(roots: readonly TCriticMarkupToken[]): number {
    let depth = 0;
    let token = roots[0];

    while (token) {
        depth++;
        const nested = token.nested ?? [];
        if (nested.length > 1) {
            throw new TypeError(
                `Expected one nested item at depth ${depth}, got ${nested.length}.`,
            );
        }
        token = nested[0];
    }

    return depth;
}

describe('criticMarkup deep-nesting resource contract', () => {
    it('scans and projects 12,000 balanced levels without recursive stack use', () => {
        const source = deeplyNestedAddition();
        const roots = scanCriticMarkup(source);

        expect(roots).toHaveLength(1);
        expect(nestingDepth(roots)).toBe(DEEP_NESTING);
        expect(projectCriticMarkupTokens(source, 'revised', roots))
            .toBe(PAYLOAD);
    });

    it('flattens and addresses 12,000 document levels without recursive stack use', () => {
        const source = deeplyNestedAddition();
        const document = createCriticMarkupDocument(
            fromMarkdownSourceMap(identitySourceMap(source)),
        );
        const innermost = document.items.at(-1)!;
        const payloadStart = DEEP_NESTING * 3;

        expect(document.items).toHaveLength(DEEP_NESTING);
        expect(document.items[0]).toMatchObject({
            parentId: null,
            depth: 0,
        });
        expect(innermost.depth).toBe(DEEP_NESTING - 1);
        expect(document.itemById(innermost.id)).toBe(innermost);
        expect(document.itemAt(PATH, localOffset(payloadStart))).toBe(innermost);
        expect(document.itemContaining(
            PATH,
            localRange(payloadStart, payloadStart + PAYLOAD.length),
        )).toBe(innermost);
    });
});

import type { TTrackedMarkdown } from '../../state/markdownSourceMap';
import type { IMarkdownSourceMap } from '../../state/stateToMarkdown';
import type { ICriticMarkupRenderContentSegment } from '../renderPlan';
import { describe, expect, it } from 'vitest';
import { localRange } from '../../mappedText';
import {
    fromMarkdownSourceMap,
    markdownStatePath,
} from '../../state/markdownSourceMap';
import { CriticMarkupAnalysis } from '../analysis';
import { createCriticMarkupDocument as createDocumentFromAnalysis } from '../document';
import {
    buildCriticMarkupRenderPlan,

} from '../renderPlan';
import { CRITIC_MARKUP_RENDER_DEPTH_LIMIT } from '../renderPolicy';

const PATH = markdownStatePath([0, 'text']);

function createCriticMarkupDocument(source: TTrackedMarkdown) {
    return createDocumentFromAnalysis(
        CriticMarkupAnalysis.analyzeGrammar(source.text),
        source,
        undefined,
        undefined,
        'grammar',
    );
}

function documentFor(source: string) {
    const sourceMap: IMarkdownSourceMap = {
        markdown: source,
        leaves: [{
            path: [...PATH],
            pieces: [{
                localStart: 0,
                localEnd: source.length,
                sourceStart: 0,
                sourceEnd: source.length,
            }],
        }],
    };
    return createCriticMarkupDocument(fromMarkdownSourceMap(sourceMap));
}

function contentSegments(segments: ReturnType<
    typeof buildCriticMarkupRenderPlan
>['roots']['nodes'][number]['segments']) {
    return segments.filter(
        (segment): segment is ICriticMarkupRenderContentSegment =>
            segment.kind === 'content',
    );
}

describe('canonical CriticMarkup render plan', () => {
    it('assigns nested items to exactly one substitution arm', () => {
        const source = '{~~old {++left++}~>new {--right--}~~}';
        const document = documentFor(source);
        const plan = buildCriticMarkupRenderPlan(
            document.fragmentsForPath(PATH),
        );
        const root = plan.roots.nodes[0];
        const byArm = new Map(contentSegments(root.segments).map(segment => [
            segment.arm,
            segment.children.nodes.map(node => node.input.item.syntax.type),
        ]));

        expect(byArm.get('old')).toEqual(['addition']);
        expect(byArm.get('new')).toEqual(['deletion']);
        expect(plan.postorder.map(node => node.input.item.syntax.type)).toEqual([
            'deletion',
            'addition',
            'substitution',
        ]);
        expect(Object.isFrozen(plan.roots.nodes)).toBe(true);
        expect(Object.isFrozen(root.segments)).toBe(true);
    });

    it('fails loudly for overlapping siblings instead of choosing one', () => {
        const document = documentFor('{++a++}{--b--}');
        const inputs = document.fragmentsForPath(PATH);
        const second = inputs[1];
        const overlapping = [
            inputs[0],
            {
                ...second,
                fragment: {
                    ...second.fragment,
                    localRange: localRange(
                        inputs[0].fragment.localRange.end - 1,
                        second.fragment.localRange.end,
                    ),
                },
            },
        ];

        expect(() => buildCriticMarkupRenderPlan(overlapping))
            .toThrow(/sibling fragments overlap/i);
    });

    it('fails loudly when a child crosses semantic arms', () => {
        const document = documentFor('{~~old {++left++}~>new~~}');
        const [parent, child] = document.fragmentsForPath(PATH);
        const separator = parent.fragment.segments.find(segment =>
            segment.kind === 'marker' && segment.marker === 'separator');
        if (!separator)
            throw new TypeError('Test substitution has no separator.');

        expect(() => buildCriticMarkupRenderPlan([
            parent,
            {
                ...child,
                fragment: {
                    ...child.fragment,
                    localRange: localRange(
                        child.fragment.localRange.start,
                        separator.localRange.end + 1,
                    ),
                },
            },
        ])).toThrow(/belongs to 0 semantic arms/i);
    });

    it('keeps the first over-budget level literal and suppresses deeper nodes', () => {
        const depth = CRITIC_MARKUP_RENDER_DEPTH_LIMIT + 8;
        const source = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`;
        const document = documentFor(source);
        const plan = buildCriticMarkupRenderPlan(
            document.fragmentsForPath(PATH),
        );

        expect(plan.postorder).toHaveLength(
            CRITIC_MARKUP_RENDER_DEPTH_LIMIT + 1,
        );
        expect(plan.postorder[0].presentation).toBe('literal-depth-limit');
        expect(plan.postorder[0].segments).toEqual([]);
        expect(plan.postorder[0].diagnostic?.depth)
            .toBe(CRITIC_MARKUP_RENDER_DEPTH_LIMIT);
        expect(plan.postorder.at(-1)?.input.item.depth).toBe(0);
    });
});

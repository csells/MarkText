import type {
    ICriticMarkupStateBindingGraph,
} from '../state/markdownToState';
import type { TState } from '../state/types';
import type {
    TCriticMarkupParserOptions,
} from '../utils/marked/criticMarkupSourceContext';
import type {
    CriticMarkupAnalysis,
    TCriticMarkupDocumentToken,
} from './analysis';
import { MarkdownToState } from '../state/markdownToState';
import StateToMarkdown from '../state/stateToMarkdown';

export interface ICriticMarkupMarkdownStateOptions {
    readonly listIndentation: number | string;
    readonly trimUnnecessaryCodeBlockEmptyLines: boolean;
    readonly lex: TCriticMarkupParserOptions;
}

export interface ICriticMarkupMarkdownStateResult {
    /** Exact Markdown revision produced by serializing `states`. */
    readonly source: string;
    readonly states: TState[];
    readonly analysis: CriticMarkupAnalysis | null;
    readonly bindings: ICriticMarkupStateBindingGraph;
}

function parseNativeState(
    markdown: string,
    options: ICriticMarkupMarkdownStateOptions,
): ReturnType<MarkdownToState['generateWithMetadata']> {
    return new MarkdownToState({
        footnote: options.lex.footnote,
        math: options.lex.math,
        isGitlabCompatibilityEnabled:
            options.lex.isGitlabCompatibilityEnabled,
        trimUnnecessaryCodeBlockEmptyLines:
            options.trimUnnecessaryCodeBlockEmptyLines,
        frontMatter: options.lex.frontMatter,
        superSubScript: options.lex.superSubScript,
    }).generateWithMetadata(markdown);
}

/**
 * Compare two parser revisions across documented Markdown normalization.
 * Item payloads alone are insufficient: a gapless highlight followed by a
 * comment is the Review model's anchored-comment relation, so normalization
 * must preserve that source adjacency as well as the semantic item forest.
 */
export function hasSameCriticMarkupNormalizationSemantics(
    beforeAnalysis: CriticMarkupAnalysis,
    afterAnalysis: CriticMarkupAnalysis,
    canonicalize: (raw: string) => string | null,
): boolean {
    const before = beforeAnalysis.roots;
    const after = afterAnalysis.roots;
    const pending: Array<readonly [
        readonly TCriticMarkupDocumentToken[],
        readonly TCriticMarkupDocumentToken[],
    ]> = [[before, after]];
    const hasSameCanonicalMarkdown = (
        beforeRaw: string,
        afterRaw: string,
    ): boolean => {
        if (beforeRaw === afterRaw)
            return true;
        const beforeCanonical = canonicalize(beforeRaw);
        return beforeCanonical !== null
            && beforeCanonical === canonicalize(afterRaw);
    };
    const armPayloads = (
        item: TCriticMarkupDocumentToken,
    ): readonly string[] => item.type === 'substitution'
        ? [item.oldContent, item.newContent]
        : [item.content];

    for (const projection of ['original', 'revised'] as const) {
        const beforeProjection = beforeAnalysis.project(projection);
        const afterProjection = afterAnalysis.project(projection);
        if (!hasSameCanonicalMarkdown(beforeProjection, afterProjection)) {
            return false;
        }
    }

    while (pending.length) {
        const [beforeSiblings, afterSiblings] = pending.pop()!;
        if (beforeSiblings.length !== afterSiblings.length)
            return false;

        for (let index = 0; index < beforeSiblings.length; index++) {
            const beforeItem = beforeSiblings[index];
            const afterItem = afterSiblings[index];
            if (beforeItem.type !== afterItem.type)
                return false;
            const beforePrevious = beforeSiblings[index - 1];
            const afterPrevious = afterSiblings[index - 1];
            const beforeIsGaplessAnchorComment = beforeItem.type === 'comment'
                && beforePrevious?.type === 'highlight'
                && beforePrevious.range.end === beforeItem.range.start;
            const afterIsGaplessAnchorComment = afterItem.type === 'comment'
                && afterPrevious?.type === 'highlight'
                && afterPrevious.range.end === afterItem.range.start;
            if (
                beforeIsGaplessAnchorComment
                !== afterIsGaplessAnchorComment
            ) {
                return false;
            }
            const beforeArms = armPayloads(beforeItem);
            const afterArms = armPayloads(afterItem);
            for (let arm = 0; arm < beforeArms.length; arm++) {
                // Original/Revised projections are assembled from these
                // payloads, not from the containing Critic delimiter source.
                // Prove each corresponding projection arm independently so
                // whole-item canonicalization cannot conceal changed text.
                if (!hasSameCanonicalMarkdown(
                    beforeArms[arm],
                    afterArms[arm],
                )) {
                    return false;
                }
            }
            if (!hasSameCanonicalMarkdown(beforeItem.raw, afterItem.raw)) {
                // Documented serializer normalization may rewrite bytes
                // INSIDE an arm (for example collapsing ATX heading padding).
                // The change is semantic-preserving exactly when both raws
                // reach the same canonical Markdown form.
                return false;
            }

            pending.push([
                beforeItem.nested ?? [],
                afterItem.nested ?? [],
            ]);
        }
    }

    return true;
}

/**
 * Parse canonical Markdown through Marked's native CriticMarkup token graph.
 *
 * Native fragments and boundary attachments are the sole topology and marker
 * authority. Ordinary Markdown serialization may perform its documented
 * normalization, but only while a same-profile reparse proves that the
 * ordered CriticMarkup semantic forest and exact item syntax survived. A
 * semantic mismatch is an internal parser/state invariant failure, not a
 * Critic-specific residue case. Do not hide it or synthesize an alternative
 * AST by concatenating projection arms.
 */
export function analyzeCriticMarkupMarkdownState(
    markdown: string,
    options: ICriticMarkupMarkdownStateOptions,
): ICriticMarkupMarkdownStateResult {
    const parsed = parseNativeState(markdown, options);
    const native = parsed.states;
    const mapped = new StateToMarkdown({
        listIndentation: options.listIndentation,
    }).generateMapped(native);
    const originalAnalysis = parsed.criticMarkupAnalysis;
    if (!parsed.criticMarkup?.roots.length || mapped.text === markdown) {
        return Object.freeze({
            source: mapped.text,
            states: native,
            analysis: originalAnalysis,
            bindings: parsed.criticMarkupBindings,
        });
    }

    const normalized = parseNativeState(mapped.text, options);
    const normalizedAnalysis = normalized.criticMarkupAnalysis;
    const canonicalize = (raw: string): string | null => {
        try {
            return new StateToMarkdown({
                listIndentation: options.listIndentation,
            }).generate(parseNativeState(raw, options).states);
        }
        catch {
            // An item raw that cannot stand alone has no canonical form;
            // the caller treats that as a semantic mismatch and fails closed.
            return null;
        }
    };
    const hasStableSemantics = originalAnalysis === null
        ? normalizedAnalysis === null
        : normalizedAnalysis !== null
            && hasSameCriticMarkupNormalizationSemantics(
                originalAnalysis,
                normalizedAnalysis,
                canonicalize,
            );
    if (hasStableSemantics) {
        const normalizedMarkdown = new StateToMarkdown({
            listIndentation: options.listIndentation,
        }).generate(normalized.states);
        if (normalizedMarkdown !== mapped.text) {
            throw new TypeError(
                'Native Markdown normalization did not reach a stable state revision.',
            );
        }
        return Object.freeze({
            source: normalizedMarkdown,
            states: normalized.states,
            analysis: normalizedAnalysis,
            bindings: normalized.criticMarkupBindings,
        });
    }

    throw new TypeError(
        'Native CriticMarkup lowering changed the parsed CriticMarkup semantic forest.',
    );
}

export function parseCriticMarkupMarkdownState(
    markdown: string,
    options: ICriticMarkupMarkdownStateOptions,
): TState[] {
    return analyzeCriticMarkupMarkdownState(markdown, options).states;
}

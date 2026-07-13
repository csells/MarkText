import type { TState } from '../state/types';
import type {
    CriticMarkupAnalysis,
    TCriticMarkupDocumentToken,
} from './analysis';
import type {
    TCriticMarkupParserOptions,
} from '../utils/marked/criticMarkupSourceContext';
import type {
    ICriticMarkupStateBindingGraph,
} from '../state/markdownToState';
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

function hasSameCriticMarkupSemantics(
    before: readonly TCriticMarkupDocumentToken[],
    after: readonly TCriticMarkupDocumentToken[],
): boolean {
    const pending: Array<readonly [
        readonly TCriticMarkupDocumentToken[],
        readonly TCriticMarkupDocumentToken[],
    ]> = [[before, after]];

    while (pending.length) {
        const [beforeSiblings, afterSiblings] = pending.pop()!;
        if (beforeSiblings.length !== afterSiblings.length)
            return false;

        for (let index = 0; index < beforeSiblings.length; index++) {
            const beforeItem = beforeSiblings[index];
            const afterItem = afterSiblings[index];
            if (
                beforeItem.type !== afterItem.type
                || beforeItem.raw !== afterItem.raw
            ) {
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
    const hasStableSemantics = originalAnalysis === null
        ? normalizedAnalysis === null
        : normalizedAnalysis !== null
            && hasSameCriticMarkupSemantics(
                originalAnalysis.roots,
                normalizedAnalysis.roots,
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

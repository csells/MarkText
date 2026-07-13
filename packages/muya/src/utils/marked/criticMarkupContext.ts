/**
 * CriticMarkup's Markdown-context boundary is the source-located Marked tree.
 * Keep this compatibility module intentionally thin: location, traversal, and
 * literal ownership all live in `locatedMarkdown`, and consumers share that
 * one immutable analysis rather than reconstructing token positions.
 */
export type {
    ICriticMarkupContextAnalysis,
    ICriticMarkupInlineLeaf,
    ICriticMarkupLocatedInlineToken,
    ICriticMarkupPlainTextProjection,
    TMarkedParserPath,
} from './locatedMarkdown';
export {
    analyzeCriticMarkupContext,
    markedParserPath,
} from './locatedMarkdown';

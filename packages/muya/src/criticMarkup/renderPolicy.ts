import type { TSourceRange } from '../mappedText';

/**
 * Final renderers deliberately cap semantic CriticMarkup nesting. The grammar
 * and canonical document remain lossless at arbitrary supported parser depth;
 * only the recursive Markdown/DOM presentation layer applies this ceiling.
 *
 * Sixty-four semantic wrappers are far beyond a plausible review document and
 * leave ample call-stack headroom for Markdown wrappers around CriticMarkup.
 */
export const CRITIC_MARKUP_RENDER_DEPTH_LIMIT = 64;

export const CRITIC_MARKUP_RENDER_LIMIT_CODE
    = 'critic-markup-render-depth-limit' as const;

export interface ICriticMarkupRenderLimitDiagnostic {
    code: typeof CRITIC_MARKUP_RENDER_LIMIT_CODE;
    depth: number;
    limit: number;
    range: TSourceRange;
    message: string;
}

export function criticMarkupRenderLimitDiagnostic(
    depth: number,
    range: TSourceRange,
): ICriticMarkupRenderLimitDiagnostic {
    return {
        code: CRITIC_MARKUP_RENDER_LIMIT_CODE,
        depth,
        limit: CRITIC_MARKUP_RENDER_DEPTH_LIMIT,
        range,
        message: `CriticMarkup nested beyond ${CRITIC_MARKUP_RENDER_DEPTH_LIMIT} render levels is shown as literal source.`,
    };
}

export function exceedsCriticMarkupRenderDepth(depth: number): boolean {
    return depth >= CRITIC_MARKUP_RENDER_DEPTH_LIMIT;
}

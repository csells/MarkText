import type {
    CriticMarkupRenderLimitToken,
    ISyntaxRenderOptions,
} from '../types';
import type Renderer from './index';
import { CLASS_NAMES } from '../../config';

/**
 * Keep over-budget source editable and visible while surfacing why it was not
 * expanded into another recursive semantic wrapper.
 */
export default function criticMarkupRenderLimit(
    this: Renderer,
    { h, block, token }: ISyntaxRenderOptions,
) {
    const limit = token as CriticMarkupRenderLimitToken;
    return [h(
        `span.${CLASS_NAMES.MU_WARN}.mu-critic-render-limit`,
        {
            attrs: {
                'data-critic-diagnostic': limit.diagnostic.code,
                'role': 'note',
                'title': limit.diagnostic.message,
            },
        },
        this.highlight(
            h,
            block,
            limit.range.start,
            limit.range.end,
            limit,
        ),
    )];
}

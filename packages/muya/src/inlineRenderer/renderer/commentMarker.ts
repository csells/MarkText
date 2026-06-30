import type { CommentMarkerToken, ISyntaxRenderOptions } from '../types';
import type Renderer from './index';
import { CLASS_NAMES } from '../../config';

export default function commentMarker(
    this: Renderer,
    { h, token }: ISyntaxRenderOptions & { token: CommentMarkerToken },
) {
    return [
        h(
            `span.${CLASS_NAMES.MU_HIDE}.${CLASS_NAMES.MU_REMOVE}.${CLASS_NAMES.MU_COMMENT_MARKER}`,
            {
                attrs: {
                    spellcheck: 'false',
                },
                dataset: {
                    id: token.markerId,
                    kind: token.markerKind,
                },
            },
            token.raw,
        ),
    ];
}

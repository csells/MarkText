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
                    // Atomic, non-editable island: the browser cannot place a
                    // caret inside the hidden marker, so native arrow
                    // navigation steps straight past its zero-size
                    // `<!--MC:id-->` text instead of parking an invisible caret
                    // there. Timing-independent (no reliance on cancelling the
                    // key's default action). Cross-block placement lands past
                    // the marker via arrowHandler's boundary clamp; the marker
                    // text still counts toward block offsets.
                    contenteditable: 'false',
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

import type { CommentMarkerToken, ISyntaxRenderOptions } from '../types';
import type Renderer from './index';

// Marker-shaped bytes in LIVE block text are literal text the user typed —
// clean state means real markers never reach the renderer (they live as
// anchors). One coordinate space (editing-invariants.md): typed bytes render
// visibly, exactly like any other text. The token type itself stays for the
// serialized-bytes consumers (file-level analysis, source mode).
export default function commentMarker(
    this: Renderer,
    { h, block, token }: ISyntaxRenderOptions & { token: CommentMarkerToken },
) {
    const { start, end } = token.range;

    return [h('span.mu-plain-text', this.highlight(h, block, start, end, token))];
}

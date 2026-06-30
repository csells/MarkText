import type Format from '../../block/base/format';
import type { H, IHighlight, Token } from '../types';
import type Renderer from './index';
import { union } from '../../utils';

// change text to highlight vnode
export default function highlight(
    this: Renderer,
    h: H,
    block: Format,
    rStart: number,
    rEnd: number,
    token: Token,
) {
    const { text } = block;
    const { highlights } = token;
    let result = [];
    const clippedHighlights: IHighlight[] = [];

    if (highlights) {
        for (const light of highlights) {
            const un = union({ start: rStart, end: rEnd }, light);
            if (un)
                clippedHighlights.push(un);
        }
    }

    if (clippedHighlights.length) {
        const boundaries = [...new Set([
            rStart,
            rEnd,
            ...clippedHighlights.flatMap(light => [light.start, light.end]),
        ])].sort((a, b) => a - b);

        for (let i = 0; i < boundaries.length - 1; i++) {
            const start = boundaries[i];
            const end = boundaries[i + 1];
            const segmentHighlights = clippedHighlights.filter(light =>
                light.start < end && light.end > start,
            );

            if (start === end)
                continue;

            const classNames = this.getHighlightClassNames(segmentHighlights);
            if (classNames.length)
                result.push(h(`span.${classNames.join('.')}`, text.substring(start, end)));
            else
                result.push(text.substring(start, end));
        }
    }
    else {
        result = [text.substring(rStart, rEnd)];
    }

    return result;
}

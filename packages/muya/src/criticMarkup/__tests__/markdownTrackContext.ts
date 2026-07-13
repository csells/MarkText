import type { ICriticMarkupTrackContext } from '../trackChanges';
import { plainMarkdown } from '../../state/markdownSourceMap';
import { parseCriticMarkupContextDocument } from '../../utils/marked/criticMarkupDocument';

function documentFor(source: string) {
    return parseCriticMarkupContextDocument(plainMarkdown(source), {
        math: true,
        superSubScript: true,
    });
}

/** Fresh Markdown-aware documents for low-level Track Changes unit tests. */
export function markdownTrackContext(
    before: string,
    proposed: string,
): ICriticMarkupTrackContext {
    return {
        beforeDocument: documentFor(before),
        proposedDocument: documentFor(proposed),
        createDocument: documentFor,
    };
}

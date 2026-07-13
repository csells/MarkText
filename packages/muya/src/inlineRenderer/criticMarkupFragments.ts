import type { TBlockPath } from '../block/types';
import type { Muya } from '../muya';
import type { ICriticMarkupDocumentFragmentInput } from './types';
import { markdownStatePath } from '../state/markdownSourceMap';

function pathContains(
    parent: readonly (string | number)[],
    child: readonly (string | number)[],
): boolean {
    return parent.length <= child.length
        && parent.every((component, index) => child[index] === component);
}

/**
 * Select renderer inputs from the one revision-cached document model. This is
 * deliberately only an adapter: it never scans source or classifies Markdown.
 */
export function criticMarkupFragmentsForPath(
    muya: Muya,
    path: TBlockPath,
): readonly ICriticMarkupDocumentFragmentInput[] {
    if (muya.options.criticMarkupProjection !== 'marked')
        return [];

    const document = muya.editor.criticMarkupDocument.get();
    const statePath = markdownStatePath(path);
    return document.fragmentsForPath(statePath).filter(({ item }) =>
        !item.structuralFragments.some(fragment =>
            pathContains(fragment.path, statePath)));
}

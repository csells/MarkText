import type Content from '../block/base/content';
import type { ISearchQueryOptions } from '../utils/search';

export interface ISearchOption extends ISearchQueryOptions {
    selectHighlight?: boolean;
    highlightIndex?: number;
}

// `replace` takes every search option plus the one that decides how many
// matches it rewrites.
export interface IReplaceOption extends ISearchOption {
    isSingle?: boolean;
}

export interface IMatch {
    start: number;
    end: number;
    block: Content;
    match: string;
    subMatches: (string | undefined)[];
}

import type Content from '../block/base/content';
import type { ISearchQueryOptions } from '../utils/search';

export interface ISearchOption extends ISearchQueryOptions {
    selectHighlight?: boolean;
    highlightIndex?: number;
}

export interface IMatch {
    start: number;
    end: number;
    block: Content;
    match: string;
    subMatches: string[];
}

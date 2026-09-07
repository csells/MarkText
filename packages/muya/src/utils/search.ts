export interface ISearchQueryOptions {
    readonly isCaseSensitive?: boolean;
    readonly isWholeWord?: boolean;
    readonly isRegexp?: boolean;
}

export interface IRegexMatch {
    readonly match: string;
    readonly subMatches: readonly string[];
}

export function matchString(text: string, value: string, options: ISearchQueryOptions) {
    const { isCaseSensitive, isWholeWord, isRegexp } = options;

    const SPECIAL_CHAR_REG = /[[\]\\^$.|?*+()/]/g;

    let SEARCH_REG = null;
    let regStr = value;
    let flag = 'g';

    if (!isCaseSensitive)
        flag += 'i';

    if (!isRegexp) {
        regStr = value.replace(SPECIAL_CHAR_REG, (p) => {
            return p === '\\' ? '\\\\' : `\\${p}`;
        });
    }

    if (isWholeWord)
        regStr = `\\b${regStr}\\b`;

    try {
    // Add try catch expression because not all string can generate a valid RegExp. for example `\`.
        SEARCH_REG = new RegExp(regStr, flag);

        // matchAll advances after empty matches, so a valid query such as ^
        // cannot leave the renderer looping on the same offset.
        return Array.from(text.matchAll(SEARCH_REG), match => ({
            match: match[0],
            subMatches: match.slice(1),
            index: match.index,
        }));
    }
    catch {
        return [];
    }
}

export function buildRegexValue(match: IRegexMatch, value: string) {
    const groups = value.match(/(?<!\\)\$\d/g);

    if (Array.isArray(groups) && groups.length) {
        for (const group of groups) {
            const index = Number.parseInt(group.replace(/^\$/, ''));
            if (index === 0)
                value = value.replace(group, match.match);
            else if (index > 0 && index <= match.subMatches.length)
                value = value.replace(group, match.subMatches[index - 1] ?? '');
        }
    }

    return value;
}

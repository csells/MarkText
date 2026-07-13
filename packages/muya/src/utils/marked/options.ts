export const MARKDOWN_BLOCK_NESTING_LIMIT = 128;

export const DEFAULT_OPTIONS = {
    breaks: false,
    criticMarkup: true,
    criticMarkupProjection: 'marked' as const,
    footnote: false,
    math: true,
    isGitlabCompatibilityEnabled: true,
    maxBlockNesting: MARKDOWN_BLOCK_NESTING_LIMIT,
    frontMatter: true,
    gfm: true,
    pedantic: false,
    superSubScript: true,
};

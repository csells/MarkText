/**
 * Set to '1' by the E2E harness on every launch. The renderer then makes Muya
 * throw when a bound Core document view reaches its legacy Markdown parser or
 * serializer, and reports each reach on the console with the prefix below.
 */
export const LEGACY_MARKDOWN_GUARD_ENV = 'MARKTEXT_E2E_LEGACY_MARKDOWN_GUARD'

/** The console prefix the harness collects; any such line fails the run. */
export const LEGACY_MARKDOWN_REACH_PREFIX = '[marktext:legacy-markdown-reach]'

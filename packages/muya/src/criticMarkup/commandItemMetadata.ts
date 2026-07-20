const PARSER_CONTENT_EMPTY = new WeakMap<object, boolean>();

/** Attach parser-only facts without widening the exported command item API. */
export function markParserOwnedCommandItemContent(
    item: object,
    isEmpty: boolean,
): void {
    PARSER_CONTENT_EMPTY.set(item, isEmpty);
}

/** Undefined identifies a handcrafted consumer item with no parser metadata. */
export function parserOwnedCommandItemContentIsEmpty(
    item: object,
): boolean | undefined {
    return PARSER_CONTENT_EMPTY.get(item);
}

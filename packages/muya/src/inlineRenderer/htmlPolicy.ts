// Preserve the existing GFM tag filter in native and document-owned presentations.
export function isInlineHtmlTagAllowed(tag: string): boolean {
    return !/title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext/i.test(tag);
}

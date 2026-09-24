// Preserve the existing GFM tag filter in native and document-owned presentations.
export const isInlineHtmlTagAllowed = (tag: string): boolean =>
    !/title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext/i.test(tag);

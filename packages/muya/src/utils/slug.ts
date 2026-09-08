// Unicode-aware like GitHub, so CJK and accented headings keep an anchor (#5292).
export function generateGithubSlug(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

/** Allocate unique heading anchors within one document, retaining explicit IDs. */
export function createHeadingIdAllocator(reservedIds: Iterable<string> = []): (text: string) => string {
    const seen = new Set(reservedIds);
    return (text) => {
        const base = generateGithubSlug(text) || 'heading';
        let slug = base;
        let n = 1;
        while (seen.has(slug))
            slug = `${base}-${n++}`;
        seen.add(slug);
        return slug;
    };
}

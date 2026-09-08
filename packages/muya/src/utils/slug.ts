// The regex uses ASCII `\w`, so CJK and emoji collapse to hyphens. A
// Unicode-aware variant would be a separate, opt-in change.
export function generateGithubSlug(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
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

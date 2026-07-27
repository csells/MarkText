export function escapeHTML(value: string): string {
    return value.replace(
        /[&<>'"]/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '\'': '&#39;',
            '"': '&quot;',
        })[character] ?? character,
    );
}

export function unescapeHTML(value: string): string {
    return value.replace(
        /&amp;|&lt;|&gt;|&quot;|&#39;/g,
        entity => ({
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&#39;': '\'',
            '&quot;': '"',
        })[entity] ?? entity,
    );
}

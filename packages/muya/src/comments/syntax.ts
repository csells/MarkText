export const COMMENT_METADATA_DATA_URI_PREFIX = 'data:application/json;base64,';
export const COMMENT_MARKER_PATTERN = '<!--MC:(~?)(\\w[\\w-]*)-->';
export const COMMENT_MARKER_REGEXP = new RegExp(`^${COMMENT_MARKER_PATTERN}`);
export const COMMENT_MARKER_SEARCH_REGEXP = new RegExp(COMMENT_MARKER_PATTERN);
export const COMMENT_METADATA_DEFINITION_REGEXP = new RegExp(
    `^ {0,3}\\[MC:([^\\]\\s]+)\\]:\\s*(${COMMENT_METADATA_DATA_URI_PREFIX.replace(/\//g, '\\/')}\\S+)\\s*$`,
);

export type TCommentMarkerKind = 'open' | 'close';

export interface IParsedCommentMarker {
    raw: string;
    id: string;
    kind: TCommentMarkerKind;
}

export interface IParsedCommentMetadataDefinition {
    id: string;
    dataUri: string;
}

export function parseCommentMarker(src: string): IParsedCommentMarker | null {
    const match = COMMENT_MARKER_REGEXP.exec(src);
    if (!match)
        return null;

    return {
        raw: match[0],
        id: match[2],
        kind: match[1] === '~' ? 'close' : 'open',
    };
}

export function parseCommentMetadataDefinition(text: string): IParsedCommentMetadataDefinition | null {
    const match = COMMENT_METADATA_DEFINITION_REGEXP.exec(text);
    if (!match)
        return null;

    return {
        id: match[1],
        dataUri: match[2],
    };
}

export function isCommentMetadataReference(label: string, href: string): boolean {
    return /^MC:[^\]\s]+$/.test(label) && href.startsWith(COMMENT_METADATA_DATA_URI_PREFIX);
}

export function maskCommentSyntaxForSearch(text: string): string {
    if (parseCommentMetadataDefinition(text))
        return ' '.repeat(text.length);

    return text.replace(
        new RegExp(COMMENT_MARKER_PATTERN, 'g'),
        match => ' '.repeat(match.length),
    );
}

export function stripCommentSyntaxForClipboard(text: string): string {
    if (parseCommentMetadataDefinition(text))
        return '';

    const withoutMarkers = text.replace(new RegExp(COMMENT_MARKER_PATTERN, 'g'), '');
    const lines = withoutMarkers.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? [];
    const withoutMetadata = lines
        .filter((line) => {
            const content = line.replace(/(?:\r\n|\n|\r)$/u, '');
            return !parseCommentMetadataDefinition(content);
        })
        .join('');

    return withoutMetadata
        .replace(/(?:\r\n|\n|\r){3,}/gu, '\n\n')
        .replace(/(?:\r\n|\n|\r){2,}$/u, '\n');
}

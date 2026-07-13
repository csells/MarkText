import type { Token } from './types';

/** Return every recursively tokenized payload owned by an inline token. */
export function tokenChildGroups(token: Token): Token[][] {
    if (token.type === 'critic_document_fragment') {
        return token.segments.flatMap(segment =>
            segment.kind === 'content' ? [segment.children] : []);
    }

    if ('children' in token && Array.isArray(token.children))
        return [token.children];

    return [];
}

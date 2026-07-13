import type { IHighlight, Token } from './types';
import escapeCharactersMap from '../config/escapeCharacter';
import { union } from '../utils';
import { tokenChildGroups } from './tokenChildren';

export function applyHighlights(
    tokens: Token[],
    highlights: IHighlight[],
): void {
    for (const token of tokens) {
        for (const light of highlights) {
            const highlight = union(token.range, light);
            if (highlight) {
                if (token.highlights && Array.isArray(token.highlights))
                    token.highlights.push(highlight);
                else
                    token.highlights = [highlight];
            }
        }
        tokenChildGroups(token).forEach(children =>
            applyHighlights(children, highlights));
    }
}

function rebuildWrapperToken(token: Token): string {
    switch (token.type) {
        case 'strong':
        case 'em':
        case 'del':
            return token.marker + generator(token.children, true) + token.marker;
        case 'html_tag':
            if (token.openTag != null && token.closeTag != null && token.children != null)
                return token.openTag + generator(token.children, true) + token.closeTag;
            return token.raw;
        case 'critic_document_fragment': {
            let result = '';
            let cursor = token.range.start;
            for (const segment of token.segments) {
                const segmentStart = segment.localRange.start - token.range.start;
                result += token.raw.slice(
                    cursor - token.range.start,
                    segmentStart,
                );
                result += segment.kind === 'content'
                    ? generator(segment.children, true)
                    : token.raw.slice(
                            segmentStart,
                            segment.localRange.end - token.range.start,
                        );
                cursor = segment.localRange.end;
            }
            return result + token.raw.slice(cursor - token.range.start);
        }
        default:
            return token.raw;
    }
}

export function generator(tokens: Token[], rebuildWrappers = false): string {
    return tokens.map(token =>
        rebuildWrappers ? rebuildWrapperToken(token) : token.raw).join('');
}

function intrinsicPlainText(token: Token): string | null {
    switch (token.type) {
        case 'text':
        case 'inline_code':
        case 'inline_math':
        case 'emoji':
        case 'super_sub_script':
        case 'footnote_identifier':
        case 'critic_markup_render_limit':
            return token.content;
        case 'image':
        case 'reference_image':
            return token.alt;
        case 'soft_line_break':
        case 'hard_line_break':
            return ' ';
        default:
            return null;
    }
}

function containerPlainText(token: Token): string | null {
    switch (token.type) {
        case 'strong':
        case 'em':
        case 'del':
        case 'link':
        case 'reference_link':
            return tokensToPlainText(token.children);
        case 'critic_document_fragment':
            return token.segments
                .filter(segment =>
                    segment.kind === 'content'
                    && segment.arm !== 'old'
                    && segment.arm !== 'comment')
                .map(segment => segment.kind === 'content'
                    ? tokensToPlainText(segment.children)
                    : '')
                .join('');
        case 'html_tag':
            return token.children
                ? tokensToPlainText(token.children)
                : token.content ?? '';
        default:
            return null;
    }
}

function syntaxPlainText(token: Token): string | null {
    switch (token.type) {
        case 'backlash':
            return token.raw.replace(/^\\/, '');
        case 'html_escape':
            return escapeCharactersMap[token.escapeCharacter] ?? token.raw;
        case 'auto_link':
            return token.raw.replace(/^<|>$/g, '');
        case 'auto_link_extension':
            return token.raw;
        default:
            return null;
    }
}

/** Return reader-facing text with Markdown and CriticMarkup syntax removed. */
export function tokensToPlainText(tokens: Token[]): string {
    return tokens.map(token =>
        intrinsicPlainText(token)
        ?? containerPlainText(token)
        ?? syntaxPlainText(token)
        ?? '').join('');
}

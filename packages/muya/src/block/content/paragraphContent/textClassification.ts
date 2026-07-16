import type { CodeEmojiMathToken, HTMLTagToken, ImageToken, LinkToken, ReferenceLinkToken, Token } from '../../../inlineRenderer/types';
import type { Nullable } from '../../../types';
import { HTML_TAGS, VOID_HTML_TAGS } from '../../../config';
import { isLengthEven } from '../../../utils';

/**
 * Paragraph text classification: Enter-time block conversion matching and
 * end-of-format hit tests shared by the enter/backspace handlers.
 */

const HTML_BLOCK_REG = /^<([a-z\d-]+)(?=\s|>)[^<>]*>$/i;
const CODE_BLOCK_REG = /(^ {0,3}`{3,})([^` ]*)/;
const MATH_BLOCK_REG = /^\$\$/;
// eslint-disable-next-line regexp/no-super-linear-backtracking
const TABLE_BLOCK_REG = /^\|.*?(\\*)\|.*?(\\*)\|/;

type BlockConversion
    = | { kind: 'math' }
        | { kind: 'code'; lang: string }
        | { kind: 'table' }
        | { kind: 'html'; tagName: string };

// Single source of truth for "what block, if any, does this paragraph text
// convert into on Enter". Shared by the enterHandler guard (to decide whether
// to convert in place) and `_enterConvert` (to perform it), so the match rules
// can never drift between the two.
export function matchBlockConversion(text: string): BlockConversion | null {
    if (MATH_BLOCK_REG.test(text))
        return { kind: 'math' };

    const codeBlockToken = text.match(CODE_BLOCK_REG);
    if (codeBlockToken)
        return { kind: 'code', lang: codeBlockToken[2] };

    const tableMatch = TABLE_BLOCK_REG.exec(text);
    if (tableMatch && isLengthEven(tableMatch[1]) && isLengthEven(tableMatch[2]))
        return { kind: 'table' };

    const htmlMatch = HTML_BLOCK_REG.exec(text);
    const tagName = htmlMatch && htmlMatch[1] && HTML_TAGS.find(t => t === htmlMatch[1]);
    if (tagName && VOID_HTML_TAGS.every(tag => tag !== tagName))
        return { kind: 'html', tagName };

    return null;
}

export const BOTH_SIDES_FORMATS = [
    'strong',
    'em',
    'inline_code',
    'image',
    'link',
    'reference_image',
    'reference_link',
    'emoji',
    'del',
    'html_tag',
    'inline_math',
];

export interface IEndFormatHit {
    offset: number;
}

type TEndFormatHandler = (token: Token, offset: number) => Nullable<IEndFormatHit>;

function endHitStrongLike(token: Token, offset: number): Nullable<IEndFormatHit> {
    const { end } = token.range;
    const { marker } = token as CodeEmojiMathToken;
    if (marker && offset === end - marker.length)
        return { offset: marker.length };

    return null;
}

function endHitImageLink(token: Token, offset: number): Nullable<IEndFormatHit> {
    const { end } = token.range;
    const { backlash } = token as ImageToken;
    const srcAndTitle = (token as ImageToken).srcAndTitle;
    const hrefAndTitle = (token as LinkToken).hrefAndTitle;
    const linkTitleLen = (srcAndTitle || hrefAndTitle).length;
    const secondLashLen
        = backlash && backlash.second ? backlash.second.length : 0;
    if (offset === end - 3 - (linkTitleLen + secondLashLen))
        return { offset: 2 };
    if (offset === end - 1)
        return { offset: 1 };

    return null;
}

function endHitReference(token: Token, offset: number): Nullable<IEndFormatHit> {
    const { end } = token.range;
    const { backlash, isFullLink, label } = token as ReferenceLinkToken;
    const labelLen = label ? label.length : 0;
    const secondLashLen
        = backlash && backlash.second ? backlash.second.length : 0;
    if (isFullLink) {
        if (offset === end - 3 - labelLen - secondLashLen)
            return { offset: 2 };
        if (offset === end - 1)
            return { offset: 1 };
        return null;
    }
    if (offset === end - 1)
        return { offset: 1 };

    return null;
}

function endHitHtmlTag(token: Token, offset: number): Nullable<IEndFormatHit> {
    const { end } = token.range;
    const { closeTag } = token as HTMLTagToken;
    if (closeTag && offset === end - closeTag.length)
        return { offset: closeTag.length };

    return null;
}

export const END_FORMAT_HANDLERS: Record<string, TEndFormatHandler> = {
    strong: endHitStrongLike,
    em: endHitStrongLike,
    inline_code: endHitStrongLike,
    emoji: endHitStrongLike,
    del: endHitStrongLike,
    inline_math: endHitStrongLike,
    image: endHitImageLink,
    link: endHitImageLink,
    reference_image: endHitReference,
    reference_link: endHitReference,
    html_tag: endHitHtmlTag,
};

export function parseTableHeader(text: string) {
    const rowHeader = [];
    const len = text.length;
    let i;

    for (i = 0; i < len; i++) {
        const char = text[i];
        if (/^[^|]$/.test(char))
            rowHeader[rowHeader.length - 1] += char;

        if (/\\/.test(char))
            rowHeader[rowHeader.length - 1] += text[++i];

        if (/\|/.test(char) && i !== len - 1)
            rowHeader.push('');
    }

    return rowHeader;
}

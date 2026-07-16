/**
 * Parser-owned block spacing: validation and re-serialization of the
 * whitespace trivia (blockPrefix/blockSeparatorAfter) captured between
 * blocks, plus the generated blank line separating loose siblings.
 */
import type { TTrackedMarkdown } from './markdownSourceMap';
import { concatMarkdown, plainMarkdown } from './markdownSourceMap';

export function assertBlockSpacing(
    value: string | undefined,
    field: 'blockPrefix' | 'blockSeparatorAfter',
): void {
    if (value !== undefined && !/^[ \t\r\n]*$/.test(value)) {
        throw new TypeError(
            `State source trivia ${field} must be whitespace.`,
        );
    }
}

/** Restore parent syntax around parser-view whitespace lines. */
export function serializeBlockSpacing(
    value: string,
    indent: string,
): TTrackedMarkdown {
    if (!value || !indent)
        return plainMarkdown(value);

    const parts: TTrackedMarkdown[] = [];
    let cursor = 0;
    while (cursor < value.length) {
        const newline = value.indexOf('\n', cursor);
        if (newline === -1) {
            parts.push(plainMarkdown(
                `${indent}${value.slice(cursor)}`,
            ));
            break;
        }
        const hasCarriageReturn = newline > cursor
            && value[newline - 1] === '\r';
        const contentEnd = hasCarriageReturn ? newline - 1 : newline;
        const content = value.slice(cursor, contentEnd);
        const lineIndent = content
            ? indent
            : indent.replace(/ +$/, '');
        parts.push(plainMarkdown(
            `${lineIndent}${content}${hasCarriageReturn ? '\r\n' : '\n'}`,
        ));
        cursor = newline + 1;
    }
    return concatMarkdown(parts);
}

export function insertLineBreak(result: TTrackedMarkdown[], indent: string) {
    if (!result.length)
        return;
    // Blank lines inside a list item should be empty, not carry the
    // item's indent as trailing whitespace. For blockquote-style indents
    // like `> ` we keep the `>` so the quote stays continuous — only
    // strip the trailing run of plain spaces.
    result.push(plainMarkdown(`${indent.replace(/ +$/, '')}\n`));
}
